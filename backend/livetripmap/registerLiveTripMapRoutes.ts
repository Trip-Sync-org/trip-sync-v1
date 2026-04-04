import type { Express } from "express";

const inMemoryAlertsByTrip = new Map<
  number,
  Array<{
    id: string;
    trip_id: number;
    user_id: number;
    actor_name: string;
    kind: string;
    reason: string | null;
    details: string | null;
    created_at: string;
  }>
>();

export type LiveTripMapRoutesContext = {
  supabase: any;
  getTripById: (tripId: number) => Promise<any | null>;
  getUserById: (userId: number) => Promise<any | null>;
  toFiniteNumber: (v: unknown) => number | null;
  isValidLatLng: (lat: number, lng: number) => boolean;
  isMissingTableError: (message: string) => boolean;
  toMemberRole: (role: unknown) => "organizer" | "co-admin" | "moderator" | "member";
  toPinType: (type: unknown) => "parking" | "fuel" | "attraction" | "hazard" | "road-damage";
  getHasTripMapPinsTable: () => boolean | null;
  setHasTripMapPinsTable: (v: boolean | null) => void;
};

export function registerLiveTripMapRoutes(app: Express, ctx: LiveTripMapRoutesContext): void {
  let hasTripAlertsTable: boolean | null = null;
  // Map API proxy routes (provider-neutral fallbacks)
  app.get("/api/maps/geocode", async (req, res) => {
    const query = String(req.query.query || req.query.q || "").trim();
    if (!query) return res.status(400).json({ error: "query is required" });

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

  /** Reverse geocode (lat/lng -> place). Used by mobile current location. */
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

      const row = (await response.json()) as {
        display_name?: string;
        lat?: string | number;
        lon?: string | number;
      };

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
    const oLat = ctx.toFiniteNumber(origin?.lat);
    const oLng = ctx.toFiniteNumber(origin?.lng);
    const dLat = ctx.toFiniteNumber(destination?.lat);
    const dLng = ctx.toFiniteNumber(destination?.lng);

    if (
      oLat === null ||
      oLng === null ||
      dLat === null ||
      dLng === null ||
      !ctx.isValidLatLng(oLat, oLng) ||
      !ctx.isValidLatLng(dLat, dLng)
    ) {
      return res.status(400).json({ error: "Valid origin and destination are required" });
    }

    const allowedProfile = ["driving", "walking", "cycling"].includes(profile) ? profile : "driving";

    const waypointCoords = Array.isArray(waypoints)
      ? waypoints
          .map((w: any) => {
            const lat = ctx.toFiniteNumber(w?.lat);
            const lng = ctx.toFiniteNumber(w?.lng);
            if (lat === null || lng === null || !ctx.isValidLatLng(lat, lng)) return null;
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
        ? (data as { routes: Array<{ geometry?: unknown; distance?: number; duration?: number }> }).routes.map(
            (r) => ({
              geometry: r.geometry,
              distance: Number(r.distance ?? 0),
              duration: Number(r.duration ?? 0),
            }),
          )
        : [];

      return res.json({ routes });
    } catch (error) {
      console.error("Route request failed:", error);
      return res.status(500).json({ error: "Route request failed" });
    }
  });

  // Live trip map endpoints
  app.get("/api/trips/:id/live-access", async (req, res) => {
    const tripId = Number(req.params.id);
    const userId = Number(req.query.user_id);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user id are required" });
    }

    const actor = await ctx.getUserById(userId);
    if (!actor) return res.status(404).json({ error: "User not found" });

    const trip = await ctx.getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const tripStatus = String(trip.status || "").toLowerCase();
    const tripStarted = ["active", "live", "started", "ongoing"].includes(tripStatus);

    if (actor.role === "organizer" && Number(trip.organizer_id) === userId) {
      return res.json({ allowed: true, reason: "organizer", trip_started: tripStarted, can_start: true });
    }

    if (actor.role !== "user") {
      return res.status(403).json({ allowed: false, error: "Invalid role for trip access" });
    }

    const { data: booking } = await ctx.supabase
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

    const trip = await ctx.getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const actor = await ctx.getUserById(userId);
    if (!actor) return res.status(404).json({ error: "User not found" });

    const isOrganizer = actor.role === "organizer" && Number(trip.organizer_id) === userId;
    if (!isOrganizer) {
      const { data: booking } = await ctx.supabase
        .from("bookings")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!booking) return res.status(403).json({ error: "Book the trip before going live" });
    }

    const { data: organizerRow } = await ctx.supabase
      .from("users")
      .select("id, name, role")
      .eq("id", Number(trip.organizer_id))
      .maybeSingle();

    const { data: bookings } = await ctx.supabase.from("bookings").select("user_id, status").eq("trip_id", tripId);

    const participantIds = Array.from(
      new Set([
        Number(trip.organizer_id),
        ...((bookings ?? []).map((b: any) => Number(b.user_id)).filter(Number.isFinite) as number[]),
      ]),
    );

    const { data: users } = await ctx.supabase
      .from("users")
      .select("id, name, role")
      .in("id", participantIds.length ? participantIds : [-1]);

    const { data: locations, error: locErr } = await ctx.supabase
      .from("trip_participant_locations")
      .select("user_id, lat, lng, speed_mps, updated_at")
      .eq("trip_id", tripId);

    if (locErr && !ctx.isMissingTableError(locErr.message)) {
      console.warn("trip_participant_locations read:", locErr.message);
    }

    const usersById = new Map<number, any>((users ?? []).map((u: any) => [Number(u.id), u]));
    if (organizerRow && !usersById.has(Number(organizerRow.id))) {
      usersById.set(Number(organizerRow.id), organizerRow);
    }

    const locByUserId = new Map<number, any>((locations ?? []).map((l: any) => [Number(l.user_id), l]));

    const members = Array.from(usersById.values()).map((u: any) => {
      const numericId = Number(u.id);
      const loc = locByUserId.get(numericId);
      const isTripOwner = numericId === Number(trip.organizer_id);
      const booking = (bookings ?? []).find((b: any) => Number(b.user_id) === numericId);

      const rawLat = loc?.lat != null && Number.isFinite(Number(loc.lat)) ? Number(loc.lat) : 0;
      const rawLng = loc?.lng != null && Number.isFinite(Number(loc.lng)) ? Number(loc.lng) : 0;
      const hasRealLocation =
        (Math.abs(rawLat) > 1e-5 || Math.abs(rawLng) > 1e-5) && ctx.isValidLatLng(rawLat, rawLng);
      const status = hasRealLocation
        ? "arrived"
        : String(booking?.status || "").toLowerCase() === "cancelled"
          ? "absent"
          : "on-way";

      const speedMps = Number(loc?.speed_mps);
      const speedKmh = Number.isFinite(speedMps) ? speedMps * 3.6 : 0;

      const updatedAtIso =
        hasRealLocation && loc?.updated_at != null ? String(loc.updated_at) : null;

      return {
        id: `m${numericId}`,
        userId: numericId,
        name: String(u.name || `User ${numericId}`),
        avatar: String(u.name || `user-${numericId}`).toLowerCase().replace(/\s+/g, "-"),
        status,
        role: isTripOwner ? "organizer" : ctx.toMemberRole(u.role),
        muted: false,
        blocked: false,
        speed: Number(speedKmh.toFixed(1)),
        distanceCovered: 0,
        checkpoints: 0,
        xpGained: 0,
        lat: hasRealLocation ? rawLat : 0,
        lng: hasRealLocation ? rawLng : 0,
        locationUpdatedAt: updatedAtIso,
      };
    });

    const { data: checkpointsRaw, error: cpErr } = await ctx.supabase
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
    const hasPinsTable = ctx.getHasTripMapPinsTable();
    if (hasPinsTable !== false) {
      const { data: pinsRaw, error: pinsErr } = await ctx.supabase
        .from("trip_map_pins")
        .select("id, type, lat, lng, label, added_by")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: true });

      if (pinsErr) {
        if (ctx.isMissingTableError(pinsErr.message)) {
          ctx.setHasTripMapPinsTable(false);
        } else {
          console.warn("trip_map_pins read:", pinsErr.message);
        }
      } else {
        ctx.setHasTripMapPinsTable(true);
        mapPins = (pinsRaw ?? []).map((p: any) => ({
          id: String(p.id),
          type: ctx.toPinType(p.type),
          lat: Number(p.lat) || 0,
          lng: Number(p.lng) || 0,
          label: String(p.label || "Map pin"),
          addedBy: String(p.added_by || "Rider"),
        }));
      }
    }

    return res.json({ members, checkpoints, mapPins });
  });

  /**
   * Persist GPS without Socket.IO (mobile/web can POST when websockets are unavailable,
   * e.g. serverless or flaky networks). Same auth rules as GET live-state.
   */
  app.post("/api/trips/:id/location", async (req, res) => {
    const tripId = Number(req.params.id);
    const { user_id, lat, lng, speed_mps } = req.body ?? {};
    const userId = Number(user_id);
    const latNum = ctx.toFiniteNumber(lat);
    const lngNum = ctx.toFiniteNumber(lng);
    const speedMps = ctx.toFiniteNumber(speed_mps);

    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user_id are required" });
    }
    if (latNum == null || lngNum == null || !ctx.isValidLatLng(latNum, lngNum)) {
      return res.status(400).json({ error: "valid lat and lng are required" });
    }

    const trip = await ctx.getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const actor = await ctx.getUserById(userId);
    if (!actor) return res.status(404).json({ error: "User not found" });

    const isOrganizer = actor.role === "organizer" && Number(trip.organizer_id) === userId;
    if (!isOrganizer) {
      const { data: booking } = await ctx.supabase
        .from("bookings")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!booking) return res.status(403).json({ error: "Book the trip before sharing location" });
    }

    const nowIso = new Date().toISOString();
    const { error: upErr } = await ctx.supabase.from("trip_participant_locations").upsert(
      {
        trip_id: tripId,
        user_id: userId,
        lat: latNum,
        lng: lngNum,
        speed_mps: speedMps,
        updated_at: nowIso,
      },
      { onConflict: "trip_id,user_id" },
    );

    if (upErr) {
      if (ctx.isMissingTableError(upErr.message)) {
        return res.status(503).json({
          error: "trip_participant_locations table missing — run sql/004_trip_participant_locations.sql in Supabase.",
        });
      }
      console.error("POST /location upsert:", upErr.message);
      return res.status(500).json({ error: "Failed to save location" });
    }

    return res.json({ ok: true, updated_at: nowIso });
  });

  app.post("/api/trips/:id/map-pins", async (req, res) => {
    const tripId = Number(req.params.id);
    const { user_id, type, label, lat, lng } = req.body ?? {};
    const userId = Number(user_id);

    const latNum = ctx.toFiniteNumber(lat);
    const lngNum = ctx.toFiniteNumber(lng);

    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user id are required" });
    }
    if (!String(label || "").trim()) {
      return res.status(400).json({ error: "Pin label is required" });
    }
    if (latNum == null || lngNum == null || !ctx.isValidLatLng(latNum, lngNum)) {
      return res.status(400).json({ error: "Valid lat/lng required" });
    }

    const trip = await ctx.getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });

    const actor = await ctx.getUserById(userId);
    if (!actor) return res.status(404).json({ error: "User not found" });

    const isTripOrganizer = actor.role === "organizer" && Number(trip.organizer_id) === userId;
    if (!isTripOrganizer) {
      const { data: booking } = await ctx.supabase
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
      type: ctx.toPinType(type),
      label: String(label).trim(),
      lat: latNum,
      lng: lngNum,
      added_by: req.body?.added_by ? String(req.body.added_by) : undefined,
    };

    const { data, error } = await ctx.supabase.from("trip_map_pins").insert(row).select("*").single();
    if (error || !data) {
      if (error && ctx.isMissingTableError(error.message)) {
        ctx.setHasTripMapPinsTable(false);
        return res.status(500).json({
          error: "trip_map_pins table is missing. Create it in Supabase to enable persisted map pins.",
        });
      }
      console.error("Supabase map pin insert error:", error?.message);
      return res.status(400).json({ error: "Failed to add map pin" });
    }

    ctx.setHasTripMapPinsTable(true);
    return res.json({
      id: String(data.id),
      type: ctx.toPinType(data.type),
      lat: Number(data.lat) || 0,
      lng: Number(data.lng) || 0,
      label: String(data.label || "Map pin"),
      addedBy: String(data.added_by || req.body?.added_by || "Rider"),
    });
  });

  // Alerts API for serverless-safe mobile/web alert flow.
  app.post("/api/trips/:id/alerts", async (req, res) => {
    const tripId = Number(req.params.id);
    const userId = Number(req.body?.user_id);
    const kind = String(req.body?.kind || "").trim();
    const reason = req.body?.reason == null ? null : String(req.body.reason).trim();
    const details = req.body?.details == null ? null : String(req.body.details).trim();
    const actorName = String(req.body?.actor_name || "").trim();
    if (!Number.isFinite(tripId) || !Number.isFinite(userId) || !kind) {
      return res.status(400).json({ error: "trip id, user id and kind are required" });
    }

    const trip = await ctx.getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const actor = await ctx.getUserById(userId);
    if (!actor) return res.status(404).json({ error: "User not found" });

    const isTripOrganizer = actor.role === "organizer" && Number(trip.organizer_id) === userId;
    if (!isTripOrganizer) {
      const { data: booking } = await ctx.supabase
        .from("bookings")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!booking) return res.status(403).json({ error: "Only participants can send alerts" });
    }

    const nowIso = new Date().toISOString();
    const alertRow = {
      id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      trip_id: tripId,
      user_id: userId,
      actor_name: actorName || String(actor.name || `User ${userId}`),
      kind,
      reason,
      details,
      created_at: nowIso,
    };

    // Always keep a memory fallback (useful when DB table is missing).
    const memList = inMemoryAlertsByTrip.get(tripId) ?? [];
    memList.unshift(alertRow);
    inMemoryAlertsByTrip.set(tripId, memList.slice(0, 200));

    if (hasTripAlertsTable !== false) {
      const { error } = await ctx.supabase.from("trip_alerts").insert({
        trip_id: tripId,
        user_id: userId,
        actor_name: alertRow.actor_name,
        kind,
        reason,
        details,
      });
      if (error) {
        if (ctx.isMissingTableError(error.message)) {
          hasTripAlertsTable = false;
        } else {
          console.warn("trip_alerts insert:", error.message);
        }
      } else {
        hasTripAlertsTable = true;
      }
    }

    return res.json(alertRow);
  });

  app.get("/api/trips/:id/alerts", async (req, res) => {
    const tripId = Number(req.params.id);
    const userId = Number(req.query.user_id);
    const since = String(req.query.since || "").trim();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user id are required" });
    }

    const trip = await ctx.getTripById(tripId);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    const actor = await ctx.getUserById(userId);
    if (!actor) return res.status(404).json({ error: "User not found" });

    const isTripOrganizer = actor.role === "organizer" && Number(trip.organizer_id) === userId;
    if (!isTripOrganizer) {
      const { data: booking } = await ctx.supabase
        .from("bookings")
        .select("id")
        .eq("trip_id", tripId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!booking) return res.status(403).json({ error: "Only participants can view alerts" });
    }

    if (hasTripAlertsTable !== false) {
      let q = ctx.supabase
        .from("trip_alerts")
        .select("id, trip_id, user_id, actor_name, kind, reason, details, created_at")
        .eq("trip_id", tripId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (since) q = q.gt("created_at", since);
      const { data, error } = await q;
      if (!error) {
        hasTripAlertsTable = true;
        return res.json({ alerts: data ?? [] });
      }
      if (ctx.isMissingTableError(error.message)) {
        hasTripAlertsTable = false;
      } else {
        console.warn("trip_alerts read:", error.message);
      }
    }

    const mem = inMemoryAlertsByTrip.get(tripId) ?? [];
    const filtered = since ? mem.filter((a) => a.created_at > since) : mem;
    return res.json({ alerts: filtered.slice(0, limit) });
  });
}

