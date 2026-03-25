import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { networkInterfaces } from "os";
import { createSupabaseServerClient } from "./src/lib/supabaseServerClient";

/** Non-loopback IPv4 addresses — use these on your phone (same Wi‑Fi), not `localhost`. */
function lanIPv4Urls(port: number): string[] {
  const urls: string[] = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      const fam = net.family as string | number;
      const isV4 = fam === "IPv4" || fam === 4 || String(fam) === "4";
      if (isV4 && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return urls;
}

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load `.env` from the repo root (same folder as `server.ts`), not from a random cwd — fixes wrong SUPABASE_* when the shell cwd differs.
dotenv.config({ path: path.join(__dirname, ".env"), override: true });
console.log(
  "[env] Using SUPABASE_URL:",
  process.env.SUPABASE_URL || "(missing — check .env next to server.ts)"
);

async function startServer() {
  const supabase = createSupabaseServerClient();
  const mapboxSecretToken = process.env.MAPBOX_SECRET_TOKEN;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  app.use(express.json());

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  function toFiniteNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function isValidLatLng(lat: number, lng: number): boolean {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  /** UI sends labels like "Mon, 23 Feb" — coerce to YYYY-MM-DD for Postgres date. */
  function normalizeTripDateForDb(input: unknown): string | null {
    if (input == null || input === "") return null;
    const s = String(input).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const y = new Date().getFullYear();
    const candidates = [`${s} ${y}`, `${s}, ${y}`, s];
    for (const c of candidates) {
      const t = Date.parse(c);
      if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    }
    return null;
  }

  /** Avoid UTC vs local midnight bugs for Postgres `date` / YYYY-MM-DD strings. */
  function startOfTodayLocal(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function parseTripDateLocalOnly(input: unknown): Date | null {
    if (input == null || input === "") return null;
    const s = String(input).trim();
    const m = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const dt = new Date(y, mo, d);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    const dt = new Date(t);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  function tripScopeFromDate(tripDate: unknown): "today" | "upcoming" | "past" {
    const normalized = parseTripDateLocalOnly(tripDate);
    if (!normalized) return "upcoming";
    const today = startOfTodayLocal();
    const a = normalized.getTime();
    const b = today.getTime();
    if (a === b) return "today";
    if (a < b) return "past";
    return "upcoming";
  }

  function isMissingTableError(message?: string): boolean {
    return Boolean(message && /Could not find the table/i.test(message));
  }

  async function getUserById(userId: number) {
    if (!Number.isFinite(userId)) return null;
    const { data } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", userId)
      .single();
    return data ?? null;
  }

  async function resolveUserNumericId(
    input: unknown,
    roleHint?: "user" | "organizer",
  ): Promise<number | null> {
    if (input == null || input === "") return null;
    const numeric = Number(input);
    if (Number.isFinite(numeric)) return numeric;
    const raw = String(input).trim();
    if (!raw) return null;

    const { data: byAuthUser } = await supabase
      .from("users")
      .select("id, role")
      .eq("auth_user_id", raw)
      .limit(2);
    if (byAuthUser?.length) {
      if (roleHint) {
        const m = byAuthUser.find((r: { role?: string }) => r.role === roleHint);
        if (m?.id != null) return Number(m.id);
      }
      return Number(byAuthUser[0].id);
    }

    const { data: byEmailRows, error: emailErr } = await supabase
      .from("users")
      .select("id, role")
      .eq("email", raw);
    if (emailErr) {
      console.warn("resolveUserNumericId email lookup:", emailErr.message);
      return null;
    }
    const rows = byEmailRows ?? [];
    if (!rows.length) return null;
    if (roleHint) {
      const m = rows.find((r: { role?: string }) => r.role === roleHint);
      if (m?.id != null) return Number(m.id);
    }
    return Number(rows[0].id);
  }

  async function getTripById(tripId: number) {
    if (!Number.isFinite(tripId)) return null;
    const { data } = await supabase
      .from("trips")
      .select("id, organizer_id, max_participants, status, date")
      .eq("id", tripId)
      .single();
    return data ?? null;
  }

  const reviewMemoryStore = new Map<number, any[]>();
  let hasTripReviewsTable: boolean | null = null;

  // Mapbox API proxy routes
  app.get("/api/maps/geocode", async (req, res) => {
    if (!mapboxSecretToken) {
      return res.status(500).json({ error: "MAPBOX_SECRET_TOKEN is missing" });
    }

    const query = String(req.query.query || req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const limit = Math.min(8, Math.max(1, Number(req.query.limit || 5)));
    const encoded = encodeURIComponent(query);
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?limit=${limit}&autocomplete=true&access_token=${mapboxSecretToken}`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const body = await response.text();
        console.error("Mapbox geocode error:", response.status, body);
        return res.status(502).json({ error: "Mapbox geocoding failed" });
      }
      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error("Mapbox geocode request failed:", error);
      return res.status(500).json({ error: "Geocoding request failed" });
    }
  });

  app.post("/api/maps/route", async (req, res) => {
    if (!mapboxSecretToken) {
      return res.status(500).json({ error: "MAPBOX_SECRET_TOKEN is missing" });
    }

    const { origin, destination, profile = "driving", waypoints = [] } = req.body ?? {};
    const oLat = toFiniteNumber(origin?.lat);
    const oLng = toFiniteNumber(origin?.lng);
    const dLat = toFiniteNumber(destination?.lat);
    const dLng = toFiniteNumber(destination?.lng);
    if (
      oLat === null ||
      oLng === null ||
      dLat === null ||
      dLng === null ||
      !isValidLatLng(oLat, oLng) ||
      !isValidLatLng(dLat, dLng)
    ) {
      return res.status(400).json({ error: "Valid origin and destination are required" });
    }

    const allowedProfile = ["driving", "walking", "cycling"].includes(profile)
      ? profile
      : "driving";

    const waypointCoords = Array.isArray(waypoints)
      ? waypoints
          .map((w) => {
            const lat = toFiniteNumber(w?.lat);
            const lng = toFiniteNumber(w?.lng);
            if (lat === null || lng === null || !isValidLatLng(lat, lng)) {
              return null;
            }
            return `${lng},${lat}`;
          })
          .filter(Boolean)
      : [];

    const coordString = [`${oLng},${oLat}`, ...waypointCoords, `${dLng},${dLat}`].join(";");
    const url = `https://api.mapbox.com/directions/v5/mapbox/${allowedProfile}/${coordString}?geometries=geojson&overview=full&steps=true&access_token=${mapboxSecretToken}`;

    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        const body = await response.text();
        console.error("Mapbox directions error:", response.status, body);
        return res.status(502).json({ error: "Mapbox directions failed" });
      }
      const data = await response.json();
      return res.json(data);
    } catch (error) {
      console.error("Mapbox route request failed:", error);
      return res.status(500).json({ error: "Route request failed" });
    }
  });

  // Auth API (Supabase)
  app.post("/api/auth/signup", async (req, res) => {
    const { email, password, name, role } = req.body;
    if (!["user", "organizer"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    console.log("Signup attempt:", { email, name, role });

    try {
      // Create auth user
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
        });

      if (signUpError || !signUpData.user) {
        console.error("Supabase signup error:", signUpError);
        const raw = signUpError?.message || "";
        const networkFail =
          /fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(raw) ||
          String(signUpError?.cause || "").includes("ENOTFOUND");
        let errorMsg = raw || "Unable to sign up user";
        if (networkFail) {
          errorMsg =
            "Cannot reach Supabase Auth (DNS/network). The server is not using the same Supabase project URL + service_role key as in your Dashboard. " +
            "Stop the dev server, fix `.env`, remove any Windows User/System env vars named SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY, then start `npm run dev` again.";
        }
        return res.status(400).json({
          error: errorMsg,
          code: signUpError?.code,
        });
      }

      const authUser = signUpData.user;

      // Create profile row in public.users (matches current app schema)
      const { data: userRow, error: userError } = await supabase
        .from("users")
        .insert({ email, name, role })
        .select()
        .single();

      if (userError) {
        console.error("Supabase users insert error:", userError);
        return res.status(400).json({
          error: userError.message || "Unable to create user profile",
          code: userError.code,
          hint: userError.hint,
        });
      }

      console.log("Signup success:", userRow.id, authUser.id);
      res.json({ ...userRow, auth_user_id: authUser.id });
    } catch (e: any) {
      console.error("Signup error details:", e);
      res.status(400).json({ error: "Signup failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password, role } = req.body;
    if (!["user", "organizer"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    console.log("Login attempt:", { email, role });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      console.log("Login failed:", error?.message);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const { data: userRow, error: profileError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .eq("role", role)
      .single();

    if (profileError || !userRow) {
      console.log("Login failed: role mismatch or profile missing");
      return res
        .status(401)
        .json({ error: "Invalid credentials or role mismatch" });
    }

    console.log("Login success:", userRow.id);
    res.json({
      ...userRow,
      auth_user_id: data.user.id,
      access_token: data.session?.access_token,
    });
  });

  // Sync authenticated Supabase user into public.users (for OAuth like Google)
  app.post("/api/auth/sync", async (req, res) => {
    const { email, name, role, auth_user_id } = req.body;

    const emailTrim =
      typeof email === "string" ? email.trim() : String(email ?? "").trim();
    if (!emailTrim) {
      return res.status(400).json({ error: "Email is required" });
    }

    const safeName =
      typeof name === "string" && name.trim().length > 0
        ? name.trim()
        : emailTrim.split("@")[0] || "User";

    const desiredRole = role === "organizer" ? "organizer" : "user";

    try {
      if (auth_user_id) {
        const authLookup = await supabase
          .from("users")
          .select("*")
          .eq("auth_user_id", auth_user_id)
          .maybeSingle();
        if (authLookup.error) {
          console.warn("auth sync: auth_user_id lookup skipped:", authLookup.error.message);
        } else if (authLookup.data) {
          const byAuth = authLookup.data;
          if (safeName && safeName !== byAuth.name) {
            const { data: updated } = await supabase
              .from("users")
              .update({ name: safeName })
              .eq("id", byAuth.id)
              .select()
              .single();
            return res.json(updated ?? byAuth);
          }
          return res.json(byAuth);
        }
      }

      const { data: exact } = await supabase
        .from("users")
        .select("*")
        .eq("email", emailTrim)
        .eq("role", desiredRole)
        .maybeSingle();
      if (exact) {
        if (safeName && safeName !== exact.name) {
          const { data: updated } = await supabase
            .from("users")
            .update({ name: safeName })
            .eq("id", exact.id)
            .select()
            .single();
          return res.json(updated ?? exact);
        }
        return res.json(exact);
      }

      const { data: emailRows } = await supabase
        .from("users")
        .select("*")
        .eq("email", emailTrim);
      if (emailRows && emailRows.length === 1) {
        const row = emailRows[0];
        if (safeName && safeName !== row.name) {
          const { data: updated } = await supabase
            .from("users")
            .update({ name: safeName })
            .eq("id", row.id)
            .select()
            .single();
          return res.json(updated ?? row);
        }
        return res.json(row);
      }
      if (emailRows && emailRows.length > 1) {
        const pick =
          emailRows.find((r: { role?: string }) => r.role === desiredRole) ?? emailRows[0];
        if (safeName && safeName !== pick.name) {
          const { data: updated } = await supabase
            .from("users")
            .update({ name: safeName })
            .eq("id", pick.id)
            .select()
            .single();
          return res.json(updated ?? pick);
        }
        return res.json(pick);
      }

      const insertPayload: Record<string, unknown> = {
        email: emailTrim,
        name: safeName,
        role: desiredRole,
      };
      if (auth_user_id) insertPayload.auth_user_id = auth_user_id;

      const { data: inserted, error: insErr } = await supabase
        .from("users")
        .insert(insertPayload)
        .select()
        .single();

      if (insErr) {
        const { data: existingByEmail } = await supabase
          .from("users")
          .select("*")
          .eq("email", emailTrim)
          .maybeSingle();
        if (existingByEmail) {
          const patch: Record<string, unknown> = {};
          if (safeName && safeName !== existingByEmail.name) patch.name = safeName;
          if (auth_user_id && existingByEmail.auth_user_id !== auth_user_id)
            patch.auth_user_id = auth_user_id;
          if (Object.keys(patch).length > 0) {
            const { data: merged } = await supabase
              .from("users")
              .update(patch)
              .eq("id", existingByEmail.id)
              .select()
              .single();
            return res.json(merged ?? existingByEmail);
          }
          return res.json(existingByEmail);
        }
        const { data: retry, error: retryErr } = await supabase
          .from("users")
          .insert({ email: emailTrim, name: safeName, role: desiredRole })
          .select()
          .single();
        if (retryErr || !retry) {
          console.error(
            "Supabase auth sync insert error:",
            insErr.message,
            insErr.code,
            insErr.details,
            retryErr?.message
          );
          return res.status(400).json({
            error: insErr.message || retryErr?.message || "Failed to sync user profile",
          });
        }
        return res.json(retry);
      }

      return res.json(inserted);
    } catch (e: any) {
      console.error("Auth sync error:", e);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  // Trips API (Supabase)
  app.get("/api/trips", async (req, res) => {
    const { theme, privacy } = req.query;

    let query = supabase.from("trips").select("*");

    if (privacy) {
      query = query.eq("privacy", privacy);
    } else {
      // Treat legacy rows with NULL privacy as public so existing trips appear.
      query = query.or("privacy.eq.public,privacy.is.null");
    }

    if (theme) {
      query = query.eq("theme", theme);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Supabase get trips error:", error.message);
      return res.status(500).json({ error: "Failed to fetch trips" });
    }

    const enriched = await Promise.all(
      (data ?? []).map(async (trip: any) => {
        const { count: joinedCount } = await supabase
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("trip_id", Number(trip.id));
        return {
          ...trip,
          joined_count: joinedCount ?? 0,
        };
      })
    );

    res.json(enriched);
  });

  app.get("/api/trips/:id", async (req, res) => {
    const tripId = Number(req.params.id);
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .single();

    if (tripError || !trip) {
      return res.status(404).json({ error: "Trip not found" });
    }

    const { data: checkpoints, error: cpError } = await supabase
      .from("checkpoints")
      .select("*")
      .eq("trip_id", tripId);

    if (cpError) {
      console.error("Supabase checkpoints error:", cpError.message);
      return res.status(500).json({ error: "Failed to fetch checkpoints" });
    }

    const { count: joinedCount } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("trip_id", tripId);

    let dbReviews: any[] | null = null;
    let reviewError: any = null;
    if (hasTripReviewsTable !== false) {
      const response = await supabase
        .from("trip_reviews")
        .select("*")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false });
      dbReviews = response.data;
      reviewError = response.error;
      if (reviewError && isMissingTableError(reviewError.message)) {
        hasTripReviewsTable = false;
      } else if (!reviewError) {
        hasTripReviewsTable = true;
      }
    }
    const fallbackReviews = reviewMemoryStore.get(tripId) ?? [];
    const reviews = reviewError
      ? isMissingTableError(reviewError.message)
        ? fallbackReviews
        : []
      : dbReviews ?? fallbackReviews;

    if (reviewError && !isMissingTableError(reviewError.message)) {
      console.error("Supabase get reviews error:", reviewError.message);
    }

    res.json({
      ...trip,
      joined_count: joinedCount ?? 0,
      reviews,
      checkpoints: checkpoints ?? [],
    });
  });

  app.post("/api/trips", async (req, res) => {
    const {
      organizer_id,
      name,
      description,
      theme,
      date,
      time,
      duration,
      price,
      max_participants,
      meetup_lat,
      meetup_lng,
      start_lat,
      start_lng,
      end_lat,
      end_lng,
      start_place_name,
      start_place_address,
      end_place_name,
      end_place_address,
      privacy,
      banner_url,
      start_location,
      end_location,
      prerequisites,
      terms,
      tags,
    } = req.body;

    const dateNormalized = normalizeTripDateForDb(date);
    const organizerIdResolved = await resolveUserNumericId(organizer_id, "organizer");
    if (!Number.isFinite(organizerIdResolved ?? NaN)) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }

    const { data, error } = await supabase
      .from("trips")
      .insert({
        organizer_id: organizerIdResolved,
        name,
        description,
        theme,
        date: dateNormalized,
        time,
        duration,
        price,
        max_participants,
        meetup_lat,
        meetup_lng,
        start_lat,
        start_lng,
        end_lat,
        end_lng,
        start_place_name,
        start_place_address,
        end_place_name,
        end_place_address,
        privacy,
        banner_url,
        start_location,
        end_location,
        prerequisites,
        terms,
        tags: typeof tags === "string" ? tags : JSON.stringify(tags),
      })
      .select()
      .single();

    if (error || !data) {
      console.error("Supabase create trip error:", error?.message, error);
      return res.status(400).json({
        error: error?.message || "Failed to create trip",
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
      });
    }

    res.json({
      id: data.id ?? data.trip_id ?? null,
      trip_id: data.trip_id ?? data.id ?? null,
    });
  });

  app.patch("/api/trips/:id/status", async (req, res) => {
    const tripId = Number(req.params.id);
    const { status, user_id } = req.body;
    const userId = Number(user_id);

    const allowedStatus = ["upcoming", "active", "completed", "cancelled"];
    if (!allowedStatus.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const actor = await getUserById(userId);
    if (!actor || actor.role !== "organizer") {
      return res.status(403).json({ error: "Only organizers can update trip status" });
    }

    const trip = await getTripById(tripId);
    if (!trip) {
      return res.status(404).json({ error: "Trip not found" });
    }
    if (Number(trip.organizer_id) !== userId) {
      return res.status(403).json({ error: "You can only update your own trip" });
    }

    const { error } = await supabase
      .from("trips")
      .update({ status })
      .eq("id", tripId);

    if (error) {
      console.error("Supabase update trip status error:", error.message);
      return res.status(400).json({ error: "Failed to update status" });
    }

    res.json({ success: true });
  });

  // Bookings API (Supabase)
  app.post("/api/bookings", async (req, res) => {
    const { trip_id, user_id } = req.body;
    const tripId = Number(trip_id);
    const userId = await resolveUserNumericId(user_id, "user");

    if (!Number.isFinite(tripId) || !Number.isFinite(userId ?? NaN)) {
      return res.status(400).json({ error: "trip_id and user_id are required" });
    }

    const actor = await getUserById(Number(userId));
    if (!actor || actor.role !== "user") {
      return res.status(403).json({ error: "Only explorer accounts can join trips" });
    }

    const trip = await getTripById(tripId);
    if (!trip) {
      return res.status(404).json({ error: "Trip not found" });
    }
    if (Number(trip.organizer_id) === Number(userId)) {
      return res.status(400).json({ error: "Organizer cannot join their own trip" });
    }
    if (trip.status === "completed" || trip.status === "cancelled") {
      return res.status(400).json({ error: "Trip is closed for joining" });
    }

    const { data: existingBooking } = await supabase
      .from("bookings")
      .select("id")
      .eq("trip_id", tripId)
      .eq("user_id", Number(userId))
      .maybeSingle();
    if (existingBooking) {
      return res.status(200).json({ id: existingBooking.id, already_joined: true });
    }

    const { count: joinedCount } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("trip_id", tripId);
    const maxParticipants = Number(trip.max_participants ?? 0);
    if (maxParticipants > 0 && (joinedCount ?? 0) >= maxParticipants) {
      return res.status(400).json({ error: "Trip is full" });
    }

    const { data, error } = await supabase
      .from("bookings")
      .insert({
        trip_id: tripId,
        user_id: Number(userId),
        status: "confirmed",
        payment_status: "paid",
      })
      .select()
      .single();

    if (error || !data) {
      console.error("Supabase create booking error:", error?.message);
      return res.status(400).json({ error: "Failed to create booking" });
    }

    res.json({ id: data.id });
  });

  app.get("/api/users/:id/bookings", async (req, res) => {
    const userId = await resolveUserNumericId(req.params.id, "user");
    if (!Number.isFinite(userId ?? NaN)) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const { data, error } = await supabase
      .from("bookings_with_trip")
      .select("*")
      .eq("user_id", Number(userId));

    if (!error) {
      return res.json(data ?? []);
    }

    console.warn("Supabase user bookings view error, falling back:", error.message);

    const { data: baseBookings, error: baseError } = await supabase
      .from("bookings")
      .select("id, trip_id, user_id, status, payment_status, created_at")
      .eq("user_id", Number(userId))
      .order("created_at", { ascending: false });

    if (baseError) {
      console.error("Supabase user bookings fallback error:", baseError.message);
      return res.status(500).json({ error: "Failed to fetch bookings" });
    }

    const tripIds = Array.from(new Set((baseBookings ?? []).map((b: any) => Number(b.trip_id)).filter(Number.isFinite)));
    if (tripIds.length === 0) {
      return res.json([]);
    }

    const { data: trips, error: tripsError } = await supabase
      .from("trips")
      .select("*")
      .in("id", tripIds);

    if (tripsError) {
      console.error("Supabase bookings trips fallback error:", tripsError.message);
      return res.status(500).json({ error: "Failed to fetch bookings" });
    }

    const tripsById = new Map<number, any>((trips ?? []).map((t: any) => [Number(t.id), t]));
    const merged = (baseBookings ?? []).map((b: any) => {
      const t = tripsById.get(Number(b.trip_id)) ?? {};
      return {
        ...b,
        trip_id: Number(b.trip_id),
        trip_name: t.name,
        trip_theme: t.theme,
        trip_date: t.date,
        trip_time: t.time,
        trip_duration: t.duration,
        trip_price: t.price,
        trip_status: t.status,
        trip_start_location: t.start_location,
        trip_end_location: t.end_location,
        trip_max_participants: t.max_participants,
        privacy: t.privacy,
        banner_url: t.banner_url,
        organizer_name: t.organizer_name ?? "Organizer",
      };
    });

    return res.json(merged);
  });

  app.get("/api/organizers/:id/events", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    if (!Number.isFinite(organizerId ?? NaN)) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }

    const { data: trips, error } = await supabase
      .from("trips")
      .select("*")
      .eq("organizer_id", Number(organizerId))
      .order("date", { ascending: true });

    if (error) {
      console.error("Supabase organizer events error:", error.message);
      return res.status(500).json({ error: "Failed to fetch organizer events" });
    }

    const mapped = await Promise.all((trips ?? []).map(async (t: any) => {
      const scope = tripScopeFromDate(t?.date);

      const { count: joinedCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("trip_id", Number(t.id));

      return {
        ...t,
        joined_count: joinedCount ?? 0,
        scope,
      };
    }));

    return res.json(mapped);
  });

  app.get("/api/trips/:id/live-access", async (req, res) => {
    const tripId = Number(req.params.id);
    const userId = Number(req.query.user_id);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user id are required" });
    }

    const actor = await getUserById(userId);
    if (!actor) {
      return res.status(404).json({ error: "User not found" });
    }
    const trip = await getTripById(tripId);
    if (!trip) {
      return res.status(404).json({ error: "Trip not found" });
    }

    if (actor.role === "organizer" && Number(trip.organizer_id) === userId) {
      return res.json({ allowed: true, reason: "organizer" });
    }

    if (actor.role !== "user") {
      return res.status(403).json({ allowed: false, error: "Invalid role for trip access" });
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("id")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!booking) {
      return res.status(403).json({ allowed: false, error: "Book the trip before going live" });
    }

    return res.json({ allowed: true, reason: "booked" });
  });

  app.get("/api/trips/:id/reviews", async (req, res) => {
    const tripId = Number(req.params.id);
    if (!Number.isFinite(tripId)) {
      return res.status(400).json({ error: "Invalid trip id" });
    }

    if (hasTripReviewsTable === false) {
      return res.json(reviewMemoryStore.get(tripId) ?? []);
    }

    const { data, error } = await supabase
      .from("trip_reviews")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error.message)) {
        hasTripReviewsTable = false;
        return res.json(reviewMemoryStore.get(tripId) ?? []);
      }
      console.error("Supabase get reviews error:", error.message);
      return res.status(500).json({ error: "Failed to fetch reviews" });
    }

    return res.json(data ?? []);
  });

  app.post("/api/trips/:id/reviews", async (req, res) => {
    const tripId = Number(req.params.id);
    const { user_id, rating, text } = req.body ?? {};
    const userId = Number(user_id);
    const ratingNum = Number(rating);

    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user id are required" });
    }
    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "rating must be between 1 and 5" });
    }
    if (!String(text || "").trim()) {
      return res.status(400).json({ error: "review text is required" });
    }

    const actor = await getUserById(userId);
    if (!actor) return res.status(404).json({ error: "User not found" });

    const trip = await getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const isOrganizer = actor.role === "organizer" && Number(trip.organizer_id) === userId;
    if (!isOrganizer) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!booking) {
        return res.status(403).json({ error: "Only participants can review this trip" });
      }
    }

    const payload = {
      trip_id: tripId,
      user_id: userId,
      rating: ratingNum,
      text: String(text).trim(),
      created_at: new Date().toISOString(),
    };

    if (hasTripReviewsTable === false) {
      const next = {
        id: `mem-${Date.now()}`,
        ...payload,
      };
      const prev = reviewMemoryStore.get(tripId) ?? [];
      reviewMemoryStore.set(tripId, [next, ...prev]);
      return res.json(next);
    }

    const { data, error } = await supabase
      .from("trip_reviews")
      .insert(payload)
      .select()
      .single();

    if (error) {
      if (isMissingTableError(error.message)) {
        hasTripReviewsTable = false;
        const next = {
          id: `mem-${Date.now()}`,
          ...payload,
        };
        const prev = reviewMemoryStore.get(tripId) ?? [];
        reviewMemoryStore.set(tripId, [next, ...prev]);
        return res.json(next);
      }
      console.error("Supabase create review error:", error.message);
      return res.status(400).json({ error: "Failed to submit review" });
    }

    return res.json(data);
  });

  // Trip messages (Group Chat) API
  app.get("/api/trips/:id/messages", async (req, res) => {
    const tripId = Number(req.params.id);

    const { data, error } = await supabase
      .from("trip_messages")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("Supabase get messages error:", error.message);
      return res.status(500).json({ error: "Failed to fetch messages" });
    }

    res.json(data ?? []);
  });

  app.post("/api/trips/:id/messages", async (req, res) => {
    const tripId = Number(req.params.id);
    const { user_id, message } = req.body;

    if (!user_id || !message) {
      return res
        .status(400)
        .json({ error: "user_id and message are required" });
    }

    const { data, error } = await supabase
      .from("trip_messages")
      .insert({ trip_id: tripId, user_id, message })
      .select()
      .single();

    if (error || !data) {
      console.error("Supabase create message error:", error?.message);
      return res.status(400).json({ error: "Failed to send message" });
    }

    res.json(data);
  });

  // Real-time Socket Logic
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join-trip", (tripId) => {
      socket.join(`trip-${tripId}`);
      console.log(`Socket ${socket.id} joined trip-${tripId}`);
    });

    socket.on("update-location", async ({ tripId, userId, lat, lng, accuracy, speed, heading, recordedAt }) => {
      const latNum = toFiniteNumber(lat);
      const lngNum = toFiniteNumber(lng);
      const tripIdNum = Number(tripId);
      const userIdNum = Number(userId);
      if (
        !Number.isFinite(tripIdNum) ||
        !Number.isFinite(userIdNum) ||
        latNum === null ||
        lngNum === null ||
        !isValidLatLng(latNum, lngNum)
      ) {
        return;
      }

      io.to(`trip-${tripIdNum}`).emit("location-updated", {
        userId: userIdNum,
        lat: latNum,
        lng: lngNum,
        accuracy,
        speed,
        heading,
        recordedAt: recordedAt || new Date().toISOString(),
      });

      const payload = {
        trip_id: tripIdNum,
        user_id: userIdNum,
        lat: latNum,
        lng: lngNum,
        accuracy_m: toFiniteNumber(accuracy),
        speed_mps: toFiniteNumber(speed),
        heading_deg: toFiniteNumber(heading),
        recorded_at: recordedAt ? new Date(recordedAt).toISOString() : new Date().toISOString(),
      };

      await supabase
        .from("trip_participant_locations")
        .upsert(payload, { onConflict: "trip_id,user_id" });

      await supabase.from("trip_location_events").insert(payload);
    });

    socket.on("send-message", ({ tripId, userId, message }) => {
      io.to(`trip-${tripId}`).emit("new-message", { userId, message, timestamp: new Date() });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected");
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    // Bind HMR to the same HTTP server so phones on Wi‑Fi use the LAN IP (not localhost).
    // Without this, @vite/client tries ws://localhost and the app fails to load on mobile.
    const vite = await createViteServer({
      root: __dirname,
      configFile: path.join(__dirname, "vite.config.ts"),
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr:
          process.env.DISABLE_HMR === "true"
            ? false
            : {
                server: httpServer,
              },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    const lan = lanIPv4Urls(PORT);
    if (lan.length > 0) {
      console.log(
        "\n  Phone / tablet: connect to the SAME Wi‑Fi as this PC, then open (not localhost on the phone):",
      );
      for (const u of lan) console.log(`    → ${u}`);
      console.log(
        "  • Mobile data (5G/4G) cannot reach these private IPs — turn Wi‑Fi on and join the same network as this computer.",
      );
      console.log(
        "  • If it still times out: Windows Firewall → allow Node.js on Private networks, and disable router “AP/client isolation” or use the main SSID (not guest Wi‑Fi).\n",
      );
    } else {
      console.log(
        "\n  (No LAN IPv4 found — connect Wi‑Fi and restart, or use USB tethering / adb reverse.)\n",
      );
    }
  });
}

startServer();
