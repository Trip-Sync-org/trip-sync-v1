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
const repoRoot = path.resolve(__dirname, "..");
const isVercelRuntime = process.env.VERCEL === "1" || process.env.VERCEL === "true";
// Load `.env` from the repo root (same folder as `server.ts`), not from a random cwd — fixes wrong SUPABASE_* when the shell cwd differs.
dotenv.config({ path: path.join(repoRoot, ".env"), override: true });
console.log(
  "[env] Using SUPABASE_URL:",
  process.env.SUPABASE_URL || "(missing — check .env next to server.ts)"
);

type StartServerOptions = {
  listen?: boolean;
};

async function startServer(options: StartServerOptions = {}): Promise<express.Express> {
  const shouldListen = options.listen ?? !isVercelRuntime;
  const supabase = createSupabaseServerClient();
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

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "trip-sync", api: "express" });
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

  /** Extra hint when PostgREST returns an RLS error (usually wrong API key or RLS enabled with no policy). */
  function supabaseRlsHint(message?: string): string | undefined {
    if (!message || !/row-level security/i.test(message)) return undefined;
    return (
      "In Supabase SQL Editor run: ALTER TABLE public.organizer_coupons DISABLE ROW LEVEL SECURITY; " +
      "Also confirm .env has SUPABASE_SERVICE_ROLE_KEY (service_role JWT from Dashboard → Settings → API, not the anon key), then restart npm run dev."
    );
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
      .select("id, organizer_id, max_participants, status, date, price")
      .eq("id", tripId)
      .single();
    return data ?? null;
  }

  /** Coerce UI strings (e.g. "Dec 31, 2025") to YYYY-MM-DD for Postgres `date`. */
  function normalizeCouponExpiryForDb(input: unknown): string | null {
    if (input == null || input === "") return null;
    const s = String(input).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const y = new Date().getFullYear();
    const candidates = [`${s}, ${y}`, `${s} ${y}`, s];
    for (const c of candidates) {
      const t = Date.parse(c);
      if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    }
    return null;
  }

  function isOrganizerCouponRowValidNow(coupon: {
    active?: boolean | null;
    expiry_date?: string | null;
    used_count?: number | null;
    usage_limit?: number | null;
  }): boolean {
    if (!coupon.active) return false;
    const used = Number(coupon.used_count ?? 0);
    const limit = Number(coupon.usage_limit ?? 0);
    if (!Number.isFinite(limit) || limit < 1) return false;
    if (used >= limit) return false;
    const exp = coupon.expiry_date;
    if (exp == null || exp === "") return true;
    const expDate = parseTripDateLocalOnly(exp);
    if (!expDate) return true;
    const today = startOfTodayLocal();
    return expDate.getTime() >= today.getTime();
  }

  async function validateOrganizerCouponForTrip(
    tripId: number,
    codeRaw: string,
    participantsIn: number,
  ): Promise<
    | {
        ok: true;
        coupon: {
          id: number;
          code: string;
          discount_pct: number;
          used_count: number;
          usage_limit: number;
        };
        base_amount: number;
        discount_amount: number;
      }
    | { ok: false; error: string; status: number }
  > {
    const code = String(codeRaw || "").trim().toUpperCase();
    if (!code) {
      return { ok: false, error: "Coupon code is required", status: 400 };
    }
    const trip = await getTripById(tripId);
    if (!trip) {
      return { ok: false, error: "Trip not found", status: 404 };
    }
    const price = Number((trip as { price?: unknown }).price ?? 0);
    const participants = Math.min(50, Math.max(1, Math.floor(Number(participantsIn) || 1)));
    const baseAmount = Math.round(price * participants);
    if (price <= 0 || baseAmount <= 0) {
      return { ok: false, error: "Coupons apply to paid trips only", status: 400 };
    }

    const { data: coupon, error } = await supabase
      .from("organizer_coupons")
      .select(
        "id, code, organizer_id, discount_pct, usage_limit, used_count, expiry_date, active",
      )
      .eq("organizer_id", Number((trip as { organizer_id?: unknown }).organizer_id))
      .eq("code", code)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error.message)) {
        return {
          ok: false,
          error:
            "Coupon system is not configured. Run the organizer_coupons SQL migration in Supabase.",
          status: 503,
        };
      }
      console.error("coupon lookup:", error.message);
      return { ok: false, error: "Failed to validate coupon", status: 500 };
    }
    if (!coupon) {
      return { ok: false, error: "Invalid or expired coupon", status: 400 };
    }
    if (!isOrganizerCouponRowValidNow(coupon)) {
      return { ok: false, error: "Invalid or expired coupon", status: 400 };
    }
    const pct = Number((coupon as { discount_pct?: unknown }).discount_pct ?? 0);
    const discountAmount = Math.round((baseAmount * pct) / 100);
    return {
      ok: true,
      coupon: {
        id: Number((coupon as { id?: unknown }).id),
        code: String((coupon as { code?: unknown }).code),
        discount_pct: pct,
        used_count: Number((coupon as { used_count?: unknown }).used_count ?? 0),
        usage_limit: Number((coupon as { usage_limit?: unknown }).usage_limit ?? 0),
      },
      base_amount: baseAmount,
      discount_amount: discountAmount,
    };
  }

  async function incrementOrganizerCouponUsage(couponId: number): Promise<boolean> {
    const { data, error } = await supabase.rpc("increment_organizer_coupon_usage", {
      p_coupon_id: couponId,
    });
    if (!error && data === true) return true;
    if (
      error &&
      /does not exist|schema cache|function public\.increment_organizer_coupon_usage/i.test(
        String(error.message),
      )
    ) {
      const { data: row } = await supabase
        .from("organizer_coupons")
        .select("used_count, usage_limit, active, expiry_date")
        .eq("id", couponId)
        .single();
      if (!row || !isOrganizerCouponRowValidNow(row)) return false;
      const prev = Number((row as { used_count?: unknown }).used_count ?? 0);
      const { error: upErr } = await supabase
        .from("organizer_coupons")
        .update({ used_count: prev + 1 })
        .eq("id", couponId)
        .eq("used_count", prev);
      return !upErr;
    }
    if (error) console.warn("incrementOrganizerCouponUsage rpc:", error.message);
    return false;
  }

  async function assertOrganizerAccess(organizerId: number) {
    const actor = await getUserById(organizerId);
    if (!actor) return { ok: false as const, status: 404, error: "User not found" };
    if (actor.role !== "organizer") {
      return { ok: false as const, status: 403, error: "Only organizers are allowed" };
    }
    return { ok: true as const };
  }

  let hasTripReviewsTable: boolean | null = null;
  let hasTripMapPinsTable: boolean | null = null;

  function toMemberRole(role: unknown): "organizer" | "co-admin" | "moderator" | "member" {
    const r = String(role || "").toLowerCase();
    if (r === "organizer") return "organizer";
    if (r === "co-admin") return "co-admin";
    if (r === "moderator") return "moderator";
    return "member";
  }

  function toPinType(type: unknown): "parking" | "fuel" | "attraction" | "hazard" | "road-damage" {
    const t = String(type || "").toLowerCase();
    if (t === "parking" || t === "fuel" || t === "attraction" || t === "hazard" || t === "road-damage") {
      return t;
    }
    return "hazard";
  }

  // Map API proxy routes (provider-neutral fallbacks)
  app.get("/api/maps/geocode", async (req, res) => {
    const query = String(req.query.query || req.query.q || "").trim();
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const limit = Math.min(8, Math.max(1, Number(req.query.limit || 5)));
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=${limit}`;

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Trip-Sync/1.0 (maps geocode)" },
      });
      if (!response.ok) {
        const body = await response.text();
        console.error("Geocode error:", response.status, body);
        return res.status(502).json({ error: "Geocoding failed" });
      }
      const rows = (await response.json()) as Array<{
        place_id?: string | number;
        display_name?: string;
        lon?: string | number;
        lat?: string | number;
      }>;
      const features = rows.map((r, i) => ({
        id: String(r.place_id ?? i),
        place_name: String(r.display_name ?? "Unknown"),
        center: [Number(r.lon), Number(r.lat)],
      }));
      return res.json({ features });
    } catch (error) {
      console.error("Geocode request failed:", error);
      return res.status(500).json({ error: "Geocoding request failed" });
    }
  });

  /** Reverse geocode (lat/lng → place). Used by mobile “current location”. */
  app.get("/api/maps/reverse", async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Trip-Sync/1.0 (maps reverse)" },
      });
      if (!response.ok) {
        const body = await response.text();
        console.error("Reverse geocode error:", response.status, body);
        return res.status(502).json({ error: "Reverse geocoding failed" });
      }
      const row = (await response.json()) as { display_name?: string; lat?: string | number; lon?: string | number };
      return res.json({
        features: [
          {
            id: "reverse-0",
            place_name: String(row.display_name ?? "Current location"),
            center: [Number(row.lon), Number(row.lat)],
          },
        ],
      });
    } catch (error) {
      console.error("Reverse geocode request failed:", error);
      return res.status(500).json({ error: "Reverse geocoding request failed" });
    }
  });

  app.post("/api/maps/route", async (req, res) => {
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
    const osrmProfile = allowedProfile === "walking" ? "foot" : allowedProfile === "cycling" ? "bike" : "car";
    const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${coordString}?geometries=geojson&overview=full&steps=true`;

    try {
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        const body = await response.text();
        console.error("Directions error:", response.status, body);
        return res.status(502).json({ error: "Directions failed" });
      }
      const data = await response.json();
      const routes = Array.isArray((data as { routes?: unknown[] }).routes)
        ? (data as { routes: Array<{ geometry?: unknown; distance?: number; duration?: number }> }).routes.map((r) => ({
            geometry: r.geometry,
            distance: Number(r.distance ?? 0),
            duration: Number(r.duration ?? 0),
          }))
        : [];
      return res.json({ routes });
    } catch (error) {
      console.error("Route request failed:", error);
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
        const code = String(signUpError?.code || "");
        const status = Number(signUpError?.status || 0);
        const networkFail =
          /fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(raw) ||
          String(signUpError?.cause || "").includes("ENOTFOUND");
        let errorMsg = raw || "Unable to sign up user";
        let httpStatus = 400;
        let retryAfterSeconds: number | undefined;
        if (networkFail) {
          errorMsg =
            "Cannot reach Supabase Auth (DNS/network). The server is not using the same Supabase project URL + service_role key as in your Dashboard. " +
            "Stop the dev server, fix `.env`, remove any Windows User/System env vars named SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY, then start `npm run dev` again.";
        }
        if (status === 429 || /rate limit/i.test(raw) || code === "over_email_send_rate_limit") {
          httpStatus = 429;
          retryAfterSeconds = 60;
          errorMsg =
            "Too many signup attempts for this email right now. Please wait about 1 minute and try again.";
        }
        return res.status(httpStatus).json({
          error: errorMsg,
          code: signUpError?.code,
          retry_after_seconds: retryAfterSeconds,
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
    const reviews = reviewError
      ? []
      : dbReviews ?? [];

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

  /**
   * Turn-by-turn style driving polyline (meetup/start → end) via OSRM public demo.
   * For production, swap to a managed directions provider, Valhalla, or self-hosted OSRM.
   */
  app.get("/api/trips/:id/driving-route", async (req, res) => {
    const tripId = Number(req.params.id);
    if (!Number.isFinite(tripId)) {
      return res.status(400).json({ error: "Invalid trip id" });
    }
    const { data: trip, error } = await supabase
      .from("trips")
      .select("meetup_lat, meetup_lng, start_lat, start_lng, end_lat, end_lng")
      .eq("id", tripId)
      .maybeSingle();
    if (error || !trip) {
      return res.status(404).json({ error: "Trip not found" });
    }
    const row = trip as Record<string, unknown>;
    const sLat = toFiniteNumber(row.meetup_lat) ?? toFiniteNumber(row.start_lat);
    const sLng = toFiniteNumber(row.meetup_lng) ?? toFiniteNumber(row.start_lng);
    const eLat = toFiniteNumber(row.end_lat);
    const eLng = toFiniteNumber(row.end_lng);

    const start = sLat != null && sLng != null ? { lat: sLat, lng: sLng } : null;
    const end = eLat != null && eLng != null ? { lat: eLat, lng: eLng } : null;

    if (!start || !end || !isValidLatLng(start.lat, start.lng) || !isValidLatLng(end.lat, end.lng)) {
      return res.json({
        coordinates: [] as { latitude: number; longitude: number }[],
        start,
        end,
        distanceMeters: null as number | null,
        durationSeconds: null as number | null,
        message: "Add meetup and end locations to the trip to compute the convoy route.",
      });
    }

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
      const r = await fetch(url);
      if (!r.ok) {
        return res.json({
          coordinates: [],
          start,
          end,
          distanceMeters: null,
          durationSeconds: null,
          message: "Routing service returned an error.",
        });
      }
      const j = (await r.json()) as {
        routes?: Array<{
          distance?: number;
          duration?: number;
          geometry?: { coordinates?: [number, number][] };
        }>;
      };
      const route = j.routes?.[0];
      const rawCoords = route?.geometry?.coordinates;
      const coordinates = Array.isArray(rawCoords)
        ? rawCoords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }))
        : [];
      return res.json({
        coordinates,
        start,
        end,
        distanceMeters: route?.distance ?? null,
        durationSeconds: route?.duration != null ? Math.round(route.duration) : null,
        provider: "osrm",
      });
    } catch (e) {
      console.error("driving-route:", e);
      return res.status(500).json({ error: "Failed to compute route" });
    }
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

    const rawStatus = String(status || "").toLowerCase();
    // Allow client aliases but persist canonical DB values.
    const canonicalStatus =
      rawStatus === "live" || rawStatus === "started" || rawStatus === "ongoing"
        ? "active"
        : rawStatus;
    const allowedStatus = ["upcoming", "active", "completed", "cancelled"];
    if (!allowedStatus.includes(canonicalStatus)) {
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
      .update({ status: canonicalStatus })
      .eq("id", tripId);

    if (error) {
      console.error("Supabase update trip status error:", error.message);
      return res.status(400).json({ error: "Failed to update status" });
    }

    res.json({ success: true, status: canonicalStatus });
  });

  /** Validate an organizer coupon against a trip (same organizer as the trip). */
  app.post("/api/trips/:tripId/coupons/validate", async (req, res) => {
    const tripId = Number(req.params.tripId);
    if (!Number.isFinite(tripId)) {
      return res.status(400).json({ valid: false, error: "Invalid trip id" });
    }
    const code = req.body?.code;
    const participants = Number(req.body?.participants ?? 1);
    const v = await validateOrganizerCouponForTrip(tripId, code, participants);
    if (v.ok === false) {
      return res.status(v.status).json({ valid: false, error: v.error });
    }
    return res.json({
      valid: true,
      coupon_id: v.coupon.id,
      code: v.coupon.code,
      discount_pct: v.coupon.discount_pct,
      base_amount: v.base_amount,
      discount_amount: v.discount_amount,
    });
  });

  // Bookings API (Supabase)
  app.post("/api/bookings", async (req, res) => {
    const { trip_id, user_id, coupon_code, participants: participantsBody } = req.body;
    const tripId = Number(trip_id);
    const userId = await resolveUserNumericId(user_id, "user");
    const participants = Math.min(50, Math.max(1, Math.floor(Number(participantsBody) || 1)));

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

    let couponValidated: Awaited<ReturnType<typeof validateOrganizerCouponForTrip>> | null =
      null;
    const rawCode = typeof coupon_code === "string" ? coupon_code.trim() : "";
    if (rawCode) {
      const v = await validateOrganizerCouponForTrip(tripId, rawCode, participants);
      if (v.ok === false) {
        return res.status(v.status).json({ error: v.error });
      }
      couponValidated = v;
    }

    const insertPayload: Record<string, unknown> = {
      trip_id: tripId,
      user_id: Number(userId),
      status: "confirmed",
      payment_status: "paid",
    };
    if (couponValidated && couponValidated.ok === true) {
      insertPayload.coupon_id = couponValidated.coupon.id;
      insertPayload.discount_amount = couponValidated.discount_amount;
    }

    let { data, error } = await supabase
      .from("bookings")
      .insert(insertPayload)
      .select()
      .single();

    if (
      error &&
      couponValidated &&
      couponValidated.ok === true &&
      /coupon_id|discount_amount|column|schema/i.test(String(error.message))
    ) {
      const retry = await supabase
        .from("bookings")
        .insert({
          trip_id: tripId,
          user_id: Number(userId),
          status: "confirmed",
          payment_status: "paid",
        })
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      console.error("Supabase create booking error:", error?.message);
      return res.status(400).json({ error: "Failed to create booking" });
    }

    if (couponValidated && couponValidated.ok === true) {
      const ok = await incrementOrganizerCouponUsage(couponValidated.coupon.id);
      if (!ok) {
        console.warn(
          "Booking created but coupon usage was not incremented (id:",
          couponValidated.coupon.id,
          ")",
        );
      }
    }

    res.json({
      id: data.id,
      discount_amount:
        couponValidated && couponValidated.ok === true ? couponValidated.discount_amount : 0,
    });
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

  app.get("/api/organizers/:id/dashboard-summary", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    if (!Number.isFinite(organizerId ?? NaN)) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }
    const access = await assertOrganizerAccess(Number(organizerId));
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const { data: trips, error: tripsError } = await supabase
      .from("trips")
      .select("id, status, date, max_participants, price")
      .eq("organizer_id", Number(organizerId));
    if (tripsError) {
      console.error("dashboard-summary trips:", tripsError.message);
      return res.status(500).json({ error: "Failed to fetch summary" });
    }

    const tripIds = (trips ?? []).map((t: any) => Number(t.id)).filter(Number.isFinite);
    const { data: bookings, error: bookingsError } = await supabase
      .from("bookings")
      .select("trip_id, status, payment_status")
      .in("trip_id", tripIds.length ? tripIds : [-1]);
    if (bookingsError) {
      console.error("dashboard-summary bookings:", bookingsError.message);
      return res.status(500).json({ error: "Failed to fetch summary" });
    }

    const joinedByTrip = new Map<number, number>();
    for (const b of bookings ?? []) {
      const id = Number((b as any).trip_id);
      joinedByTrip.set(id, (joinedByTrip.get(id) ?? 0) + 1);
    }

    const totals = {
      totalRevenue: 0,
      participants: 0,
      eventsHosted: (trips ?? []).length,
      successRate: 0,
      activeCoupons: 0,
      expiringCoupons: 0,
    };
    let completedCount = 0;
    for (const t of trips ?? []) {
      const joined = joinedByTrip.get(Number((t as any).id)) ?? 0;
      const price = Number((t as any).price ?? 0);
      totals.participants += joined;
      totals.totalRevenue += Math.max(0, price) * joined;
      if (String((t as any).status || "").toLowerCase() === "completed") completedCount += 1;
    }
    totals.successRate =
      totals.eventsHosted > 0 ? Math.round((completedCount / totals.eventsHosted) * 100) : 0;

    const now = new Date();
    const soon = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);
    const { data: coupons, error: couponsErr } = await supabase
      .from("organizer_coupons")
      .select("id, active, expiry_date")
      .eq("organizer_id", Number(organizerId));
    if (!couponsErr) {
      totals.activeCoupons = (coupons ?? []).filter((c: any) => Boolean(c.active)).length;
      totals.expiringCoupons = (coupons ?? []).filter((c: any) => {
        const exp = Date.parse(String(c.expiry_date || ""));
        return Boolean(c.active) && Number.isFinite(exp) && exp >= now.getTime() && exp <= soon.getTime();
      }).length;
    }

    return res.json(totals);
  });

  app.get("/api/organizers/:id/revenue-by-event", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    if (!Number.isFinite(organizerId ?? NaN)) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }
    const access = await assertOrganizerAccess(Number(organizerId));
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const { data: trips, error } = await supabase
      .from("trips")
      .select("id, name, date, status, price")
      .eq("organizer_id", Number(organizerId))
      .order("date", { ascending: false });
    if (error) {
      console.error("revenue-by-event trips:", error.message);
      return res.status(500).json({ error: "Failed to fetch revenue data" });
    }

    const out = await Promise.all(
      (trips ?? []).map(async (t: any) => {
        const { count: joinedCount } = await supabase
          .from("bookings")
          .select("*", { count: "exact", head: true })
          .eq("trip_id", Number(t.id));
        const joined = Number(joinedCount ?? 0);
        const price = Number(t.price ?? 0);
        const revenue = Math.max(0, price) * joined;
        return {
          id: Number(t.id),
          name: String(t.name || "Untitled Event"),
          participants: joined,
          revenue,
          perPerson: joined > 0 ? Math.round(revenue / joined) : 0,
          status: String(t.status || "upcoming"),
          date: t.date,
        };
      }),
    );
    return res.json(out);
  });

  app.get("/api/organizers/:id/monthly-revenue", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    if (!Number.isFinite(organizerId ?? NaN)) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }
    const access = await assertOrganizerAccess(Number(organizerId));
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const { data: trips, error } = await supabase
      .from("trips")
      .select("id, date, price")
      .eq("organizer_id", Number(organizerId));
    if (error) {
      console.error("monthly-revenue trips:", error.message);
      return res.status(500).json({ error: "Failed to fetch monthly revenue" });
    }

    const monthTotals = Array.from({ length: 12 }, (_, i) => ({ month: i, revenue: 0 }));
    for (const t of trips ?? []) {
      const d = parseTripDateLocalOnly((t as any).date);
      if (!d) continue;
      const month = d.getMonth();
      const { count: joinedCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("trip_id", Number((t as any).id));
      const revenue = Number((t as any).price ?? 0) * Number(joinedCount ?? 0);
      monthTotals[month].revenue += Math.max(0, revenue);
    }
    return res.json(monthTotals);
  });

  app.get("/api/organizers/:id/profile", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    if (!Number.isFinite(organizerId ?? NaN)) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }
    const access = await assertOrganizerAccess(Number(organizerId));
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const { data: organizer, error: orgError } = await supabase
      .from("users")
      .select("id, name, email, phone")
      .eq("id", Number(organizerId))
      .single();
    if (orgError || !organizer) {
      return res.status(404).json({ error: "Organizer profile not found" });
    }

    const { data: trips } = await supabase
      .from("trips")
      .select("id")
      .eq("organizer_id", Number(organizerId));
    const hosted = Number((trips ?? []).length);

    const tripIds = (trips ?? []).map((t: any) => Number(t.id)).filter(Number.isFinite);
    const { data: reviews } = await supabase
      .from("trip_reviews")
      .select("rating")
      .in("trip_id", tripIds.length ? tripIds : [-1]);
    const ratings = (reviews ?? []).map((r: any) => Number(r.rating)).filter(Number.isFinite);
    const avgRating =
      ratings.length > 0
        ? Number((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length).toFixed(1))
        : null;

    return res.json({
      id: Number(organizer.id),
      name: organizer.name,
      email: organizer.email,
      phone: (organizer as any).phone ?? "",
      events_hosted: hosted,
      avg_rating: avgRating,
    });
  });

  app.patch("/api/organizers/:id/profile", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    if (!Number.isFinite(organizerId ?? NaN)) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }
    const access = await assertOrganizerAccess(Number(organizerId));
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const patch: Record<string, unknown> = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) patch.name = req.body.name.trim();
    if (typeof req.body?.phone === "string") patch.phone = req.body.phone.trim();
    if (typeof req.body?.email === "string" && req.body.email.trim()) patch.email = req.body.email.trim();
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "No profile fields provided" });
    }

    const { data, error } = await supabase
      .from("users")
      .update(patch)
      .eq("id", Number(organizerId))
      .select("id, name, email, phone")
      .single();
    if (error || !data) {
      console.error("update organizer profile:", error?.message);
      return res.status(400).json({ error: "Failed to update profile" });
    }
    return res.json(data);
  });

  app.get("/api/organizers/:id/coupons", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    if (!Number.isFinite(organizerId ?? NaN)) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }
    const access = await assertOrganizerAccess(Number(organizerId));
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const { data, error } = await supabase
      .from("organizer_coupons")
      .select("id, code, discount_pct, usage_limit, used_count, expiry_date, active, prefix")
      .eq("organizer_id", Number(organizerId))
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error.message)) {
        return res.json([]);
      }
      console.error("organizer coupons read:", error.message);
      return res.status(500).json({ error: "Failed to fetch coupons" });
    }
    return res.json(data ?? []);
  });

  app.post("/api/organizers/:id/coupons", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    if (!Number.isFinite(organizerId ?? NaN)) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }
    const access = await assertOrganizerAccess(Number(organizerId));
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const code = String(req.body?.code || "").trim().toUpperCase();
    const prefix = String(req.body?.prefix || "").trim().toUpperCase();
    const discountPct = Number(req.body?.discount_pct);
    const usageLimit = Number(req.body?.usage_limit);
    const expiryRaw = String(req.body?.expiry_date || "").trim();
    if (!code) return res.status(400).json({ error: "Coupon code is required" });
    if (!Number.isFinite(discountPct) || discountPct < 1 || discountPct > 100) {
      return res.status(400).json({ error: "discount_pct must be between 1 and 100" });
    }
    if (!Number.isFinite(usageLimit) || usageLimit < 1) {
      return res.status(400).json({ error: "usage_limit must be at least 1" });
    }
    const expiryNormalized = normalizeCouponExpiryForDb(expiryRaw);
    if (expiryRaw && !expiryNormalized) {
      return res.status(400).json({ error: "Invalid expiry_date — use YYYY-MM-DD or e.g. Dec 31, 2026" });
    }

    const { data, error } = await supabase
      .from("organizer_coupons")
      .insert({
        organizer_id: Number(organizerId),
        code,
        prefix,
        discount_pct: discountPct,
        usage_limit: usageLimit,
        used_count: 0,
        expiry_date: expiryNormalized,
        active: true,
      })
      .select("id, code, discount_pct, usage_limit, used_count, expiry_date, active, prefix")
      .single();
    if (error || !data) {
      console.error("organizer coupon create:", error?.message, error?.code, error?.details);
      const rlsHint = supabaseRlsHint(error?.message);
      return res.status(400).json({
        error: "Failed to create coupon",
        details: error?.message ?? null,
        code: error?.code ?? null,
        hint: rlsHint ?? (error as { hint?: string })?.hint ?? null,
      });
    }
    return res.json(data);
  });

  app.patch("/api/organizers/:id/coupons/:couponId", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    const couponId = Number(req.params.couponId);
    if (!Number.isFinite(organizerId ?? NaN) || !Number.isFinite(couponId)) {
      return res.status(400).json({ error: "Invalid organizer/coupon id" });
    }
    const access = await assertOrganizerAccess(Number(organizerId));
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const patch: Record<string, unknown> = {};
    if (typeof req.body?.active === "boolean") patch.active = req.body.active;
    if (typeof req.body?.usage_limit === "number") patch.usage_limit = req.body.usage_limit;
    if (typeof req.body?.discount_pct === "number") patch.discount_pct = req.body.discount_pct;
    if (typeof req.body?.expiry_date === "string") {
      const raw = req.body.expiry_date.trim();
      if (!raw) {
        patch.expiry_date = null;
      } else {
        const n = normalizeCouponExpiryForDb(raw);
        if (!n) return res.status(400).json({ error: "Invalid expiry_date" });
        patch.expiry_date = n;
      }
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "No updates provided" });

    const { data, error } = await supabase
      .from("organizer_coupons")
      .update(patch)
      .eq("id", couponId)
      .eq("organizer_id", Number(organizerId))
      .select("id, code, discount_pct, usage_limit, used_count, expiry_date, active, prefix")
      .single();
    if (error || !data) {
      console.error("organizer coupon patch:", error?.message);
      return res.status(400).json({ error: "Failed to update coupon" });
    }
    return res.json(data);
  });

  app.delete("/api/organizers/:id/coupons/:couponId", async (req, res) => {
    const organizerId = await resolveUserNumericId(req.params.id, "organizer");
    const couponId = Number(req.params.couponId);
    if (!Number.isFinite(organizerId ?? NaN) || !Number.isFinite(couponId)) {
      return res.status(400).json({ error: "Invalid organizer/coupon id" });
    }
    const access = await assertOrganizerAccess(Number(organizerId));
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const { error } = await supabase
      .from("organizer_coupons")
      .delete()
      .eq("id", couponId)
      .eq("organizer_id", Number(organizerId));
    if (error) {
      console.error("organizer coupon delete:", error.message);
      return res.status(400).json({ error: "Failed to delete coupon" });
    }
    return res.json({ success: true });
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

    const tripStatus = String(trip.status || "").toLowerCase();
    const tripStarted =
      tripStatus === "active" ||
      tripStatus === "live" ||
      tripStatus === "started" ||
      tripStatus === "ongoing";

    if (actor.role === "organizer" && Number(trip.organizer_id) === userId) {
      return res.json({ allowed: true, reason: "organizer", trip_started: tripStarted, can_start: true });
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

    return res.json({
      allowed: true,
      reason: "booked",
      trip_started: tripStarted,
      can_start: false,
    });
  });

  app.get("/api/trips/:id/live-state", async (req, res) => {
    const tripId = Number(req.params.id);
    const userId = Number(req.query.user_id);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user id are required" });
    }

    const trip = await getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const actor = await getUserById(userId);
    if (!actor) return res.status(404).json({ error: "User not found" });

    const isOrganizer = actor.role === "organizer" && Number(trip.organizer_id) === userId;
    if (!isOrganizer) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!booking) return res.status(403).json({ error: "Book the trip before going live" });
    }

    const { data: organizerRow } = await supabase
      .from("users")
      .select("id, name, role")
      .eq("id", Number(trip.organizer_id))
      .maybeSingle();

    const { data: bookings } = await supabase
      .from("bookings")
      .select("user_id, status")
      .eq("trip_id", tripId);

    const participantIds = Array.from(
      new Set([
        Number(trip.organizer_id),
        ...((bookings ?? []).map((b: any) => Number(b.user_id)).filter(Number.isFinite)),
      ]),
    );

    const { data: users } = await supabase
      .from("users")
      .select("id, name, role")
      .in("id", participantIds.length ? participantIds : [-1]);

    const { data: locations, error: locErr } = await supabase
      .from("trip_participant_locations")
      .select("user_id, lat, lng, speed_mps")
      .eq("trip_id", tripId);
    if (locErr && !isMissingTableError(locErr.message)) {
      console.warn("trip_participant_locations read:", locErr.message);
    }

    const usersById = new Map<number, any>((users ?? []).map((u: any) => [Number(u.id), u]));
    if (organizerRow && !usersById.has(Number(organizerRow.id))) {
      usersById.set(Number(organizerRow.id), organizerRow);
    }
    const locByUserId = new Map<number, any>(
      (locations ?? []).map((l: any) => [Number(l.user_id), l]),
    );

    const members = Array.from(usersById.values()).map((u: any) => {
      const numericId = Number(u.id);
      const loc = locByUserId.get(numericId);
      const isTripOwner = numericId === Number(trip.organizer_id);
      const booking = (bookings ?? []).find((b: any) => Number(b.user_id) === numericId);

      const status =
        isTripOwner || loc
          ? "arrived"
          : String(booking?.status || "").toLowerCase() === "cancelled"
            ? "absent"
            : "on-way";
      const speedMps = Number(loc?.speed_mps);
      const speedKmh = Number.isFinite(speedMps) ? speedMps * 3.6 : 0;

      return {
        id: `m${numericId}`,
        userId: numericId,
        name: String(u.name || `User ${numericId}`),
        avatar: String(u.name || `user-${numericId}`).toLowerCase().replace(/\s+/g, "-"),
        status,
        role: isTripOwner ? "organizer" : toMemberRole(u.role),
        muted: false,
        blocked: false,
        speed: Number(speedKmh.toFixed(1)),
        distanceCovered: 0,
        checkpoints: 0,
        xpGained: 0,
        lat: Number(loc?.lat) || Number((trip as any).meetup_lat) || 0,
        lng: Number(loc?.lng) || Number((trip as any).meetup_lng) || 0,
      };
    });

    const { data: checkpointsRaw, error: cpErr } = await supabase
      .from("checkpoints")
      .select("*")
      .eq("trip_id", tripId)
      .order("id", { ascending: true });
    if (cpErr) {
      console.error("Supabase checkpoints error:", cpErr.message);
      return res.status(500).json({ error: "Failed to fetch checkpoints" });
    }
    const badges = ["🚀", "🛣️", "🏔️", "🏖️", "📍", "🎯", "🏁"];
    const checkpoints = (checkpointsRaw ?? []).map((cp: any, i: number) => ({
      id: String(cp.id),
      name: String(cp.name || `Checkpoint ${i + 1}`),
      lat: Number(cp.lat) || 0,
      lng: Number(cp.lng) || 0,
      reached: Boolean(cp.reached ?? cp.is_reached ?? cp.completed_at),
      badge: String(cp.badge || badges[i % badges.length]),
      xp: Number(cp.xp ?? 50),
    }));

    let mapPins: any[] = [];
    if (hasTripMapPinsTable !== false) {
      const { data: pinsRaw, error: pinsErr } = await supabase
        .from("trip_map_pins")
        .select("id, type, lat, lng, label, added_by")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: true });
      if (pinsErr) {
        if (isMissingTableError(pinsErr.message)) {
          hasTripMapPinsTable = false;
        } else {
          console.warn("trip_map_pins read:", pinsErr.message);
        }
      } else {
        hasTripMapPinsTable = true;
        mapPins = (pinsRaw ?? []).map((p: any) => ({
          id: String(p.id),
          type: toPinType(p.type),
          lat: Number(p.lat) || 0,
          lng: Number(p.lng) || 0,
          label: String(p.label || "Map pin"),
          addedBy: String(p.added_by || "Rider"),
        }));
      }
    }

    return res.json({ members, checkpoints, mapPins });
  });

  app.post("/api/trips/:id/map-pins", async (req, res) => {
    const tripId = Number(req.params.id);
    const { user_id, type, label, lat, lng } = req.body ?? {};
    const userId = Number(user_id);
    const latNum = toFiniteNumber(lat);
    const lngNum = toFiniteNumber(lng);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user id are required" });
    }
    if (!String(label || "").trim()) {
      return res.status(400).json({ error: "Pin label is required" });
    }
    if (latNum == null || lngNum == null || !isValidLatLng(latNum, lngNum)) {
      return res.status(400).json({ error: "Valid lat/lng required" });
    }

    const trip = await getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const actor = await getUserById(userId);
    if (!actor) return res.status(404).json({ error: "User not found" });

    const isTripOrganizer = actor.role === "organizer" && Number(trip.organizer_id) === userId;
    if (!isTripOrganizer) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!booking) return res.status(403).json({ error: "Only participants can add pins" });
    }

    const row = {
      trip_id: tripId,
      user_id: userId,
      type: toPinType(type),
      label: String(label).trim(),
      lat: latNum,
      lng: lngNum,
      added_by: req.body?.added_by ? String(req.body.added_by) : undefined,
    };
    const { data, error } = await supabase.from("trip_map_pins").insert(row).select("*").single();
    if (error || !data) {
      if (error && isMissingTableError(error.message)) {
        hasTripMapPinsTable = false;
        return res.status(500).json({
          error:
            "trip_map_pins table is missing. Create it in Supabase to enable persisted map pins.",
        });
      }
      console.error("Supabase map pin insert error:", error?.message);
      return res.status(400).json({ error: "Failed to add map pin" });
    }
    hasTripMapPinsTable = true;

    return res.json({
      id: String(data.id),
      type: toPinType(data.type),
      lat: Number(data.lat) || 0,
      lng: Number(data.lng) || 0,
      label: String(data.label || "Map pin"),
      addedBy: String(data.added_by || req.body?.added_by || "Rider"),
    });
  });

  app.get("/api/trips/:id/reviews", async (req, res) => {
    const tripId = Number(req.params.id);
    if (!Number.isFinite(tripId)) {
      return res.status(400).json({ error: "Invalid trip id" });
    }

    if (hasTripReviewsTable === false) {
      return res.status(500).json({
        error: "trip_reviews table is missing. Please create it in Supabase.",
      });
    }

    const { data, error } = await supabase
      .from("trip_reviews")
      .select("*")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error.message)) {
        hasTripReviewsTable = false;
        return res.status(500).json({
          error: "trip_reviews table is missing. Please create it in Supabase.",
        });
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
      return res.status(500).json({
        error: "trip_reviews table is missing. Please create it in Supabase.",
      });
    }

    const { data, error } = await supabase
      .from("trip_reviews")
      .insert(payload)
      .select()
      .single();

    if (error) {
      if (isMissingTableError(error.message)) {
        hasTripReviewsTable = false;
        return res.status(500).json({
          error: "trip_reviews table is missing. Please create it in Supabase.",
        });
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

  /** Community-discovered places (used on live trip + create event checkpoint picker). */
  app.get("/api/nearby-attractions", async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from("nearby_attractions")
        .select("id, name, description, lat, lng, created_at, created_by")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) {
        if (isMissingTableError(error.message)) {
          return res.json({ attractions: [] });
        }
        console.error("nearby_attractions list:", error.message);
        return res.status(500).json({ error: "Failed to list attractions" });
      }
      return res.json({ attractions: data ?? [] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "Failed to list attractions" });
    }
  });

  app.post("/api/nearby-attractions", async (req, res) => {
    const { name, description, lat, lng, user_id } = req.body ?? {};
    if (!String(name || "").trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const latNum = toFiniteNumber(lat);
    const lngNum = toFiniteNumber(lng);
    if (latNum === null || lngNum === null || !isValidLatLng(latNum, lngNum)) {
      return res.status(400).json({ error: "valid lat and lng are required" });
    }
    const uid = Number(user_id);
    const { data, error } = await supabase
      .from("nearby_attractions")
      .insert({
        name: String(name).trim().slice(0, 200),
        description: String(description ?? "").trim().slice(0, 2000) || null,
        lat: latNum,
        lng: lngNum,
        created_by: Number.isFinite(uid) ? uid : null,
      })
      .select()
      .single();
    if (error) {
      if (isMissingTableError(error.message)) {
        return res.status(503).json({
          error: "Database table missing — run sql/nearby_attractions_schema.sql in Supabase SQL editor.",
        });
      }
      console.error("nearby_attractions insert:", error.message);
      return res.status(400).json({ error: error.message || "Failed to save attraction" });
    }
    return res.json(data);
  });

  /** Bulk set checkpoints when creating/editing a trip (organizer only). */
  app.post("/api/trips/:id/checkpoints", async (req, res) => {
    const tripId = Number(req.params.id);
    const { user_id, checkpoints: cps } = req.body ?? {};
    const userId = Number(user_id);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user_id are required" });
    }
    const actor = await getUserById(userId);
    if (!actor || actor.role !== "organizer") {
      return res.status(403).json({ error: "Only organizers can add checkpoints" });
    }
    const trip = await getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    if (Number(trip.organizer_id) !== userId) {
      return res.status(403).json({ error: "You can only edit your own trip" });
    }
    const badges = ["🚀", "🛣️", "🏔️", "🏖️", "📍", "🎯", "🏁"];
    const list = Array.isArray(cps) ? cps : [];
    const rows = list.map((cp: Record<string, unknown>, i: number) => ({
      trip_id: tripId,
      name: String(cp.name ?? `Checkpoint ${i + 1}`).slice(0, 200),
      lat: Number(cp.lat) || 0,
      lng: Number(cp.lng) || 0,
      xp: Number(cp.xp ?? 50),
      badge: String(cp.badge ?? badges[i % badges.length]),
    }));
    if (rows.length === 0) {
      return res.json({ ok: true, inserted: 0 });
    }
    const { error } = await supabase.from("checkpoints").insert(rows);
    if (error) {
      console.error("checkpoints bulk insert:", error.message);
      return res.status(400).json({ error: error.message || "Failed to insert checkpoints" });
    }
    return res.json({ ok: true, inserted: rows.length });
  });

  // Real-time Socket Logic
  if (shouldListen) {
    io.on("connection", (socket) => {
      console.log("User connected:", socket.id);

      socket.on("join-trip", (tripId) => {
        socket.join(`trip-${tripId}`);
        console.log(`Socket ${socket.id} joined trip-${tripId}`);
      });

      socket.on("convoy-action", (payload: { kind?: string; tripId?: number; userId?: number }) => {
        const tripIdNum = Number(payload?.tripId);
        const kind = String(payload?.kind || "").trim();
        if (!Number.isFinite(tripIdNum) || !kind) return;
        const uid = toFiniteNumber(payload?.userId);
        io.to(`trip-${tripIdNum}`).emit("convoy-action", {
          kind,
          tripId: tripIdNum,
          userId: uid,
          at: new Date().toISOString(),
        });
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
  }

  // Vite middleware for development
  if (shouldListen && process.env.NODE_ENV !== "production") {
    // Bind HMR to the same HTTP server so phones on Wi‑Fi use the LAN IP (not localhost).
    // Without this, @vite/client tries ws://localhost and the app fails to load on mobile.
    const vite = await createViteServer({
      root: repoRoot,
      configFile: path.join(repoRoot, "frontend", "vite.config.ts"),
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
    // Vite's dev middleware must not handle `/api/*` — otherwise POST /api/... can 404 before Express routes run.
    app.use((req, res, next) => {
      const p = req.originalUrl.split("?")[0] || req.path || "";
      if (p.startsWith("/api")) {
        return next();
      }
      return vite.middlewares(req, res, next);
    });
  } else if (shouldListen) {
    app.use(express.static(path.resolve(repoRoot, "frontend", "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(repoRoot, "frontend", "dist", "index.html"));
    });
  }

  if (shouldListen) {
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

  return app;
}

let appInitPromise: Promise<express.Express> | null = null;

export async function getServerApp(): Promise<express.Express> {
  if (!appInitPromise) {
    appInitPromise = startServer({ listen: false });
  }
  return appInitPromise;
}

if (!isVercelRuntime) {
  startServer({ listen: true }).catch((error) => {
    console.error("Server bootstrap failed:", error);
    process.exit(1);
  });
}
