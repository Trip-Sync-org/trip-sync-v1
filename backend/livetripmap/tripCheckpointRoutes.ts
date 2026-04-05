// @ts-nocheck — imports JS modules without declarations
import type { Express } from "express";
import type { Server } from "socket.io";
import { isTripStaffRole } from "../lib/permissions.js";
import { emitCheckpointsUpdated, emitToPrivileged, emitMapPinReviewedToUser } from "../lib/realtime.js";

export type TripCheckpointSocketBridge = {
  getIo: () => Server | null;
  tripRiders: Map<number, Map<number, string>>;
  tripUserRoles: Map<number, Map<number, string>>;
};

export type TripCheckpointRoutesContext = {
  supabase: any;
  getTripById: (tripId: number) => Promise<any | null>;
  getUserById: (userId: number) => Promise<any | null>;
  toFiniteNumber: (v: unknown) => number | null;
  isValidLatLng: (lat: number, lng: number) => boolean;
  isMissingTableError: (message: string) => boolean;
  socketBridge: TripCheckpointSocketBridge | null;
};

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function getRouteSegmentMidpoints(routeCoords: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const a = routeCoords[i];
    const b = routeCoords[i + 1];
    if (!a || !b) continue;
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}

/** Start, end, and segment midpoints — used to test 50 km corridor along the polyline. */
function getRouteFilterReferencePoints(routeCoords: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  if (routeCoords.length === 0) return out;
  out.push(routeCoords[0]);
  if (routeCoords.length >= 2) {
    out.push(routeCoords[routeCoords.length - 1]);
    for (const m of getRouteSegmentMidpoints(routeCoords)) out.push(m);
  }
  return out;
}

function normalizeTripRole(
  r: unknown,
): "organizer" | "co_admin" | "moderator" | "member" | null {
  const s = String(r || "")
    .toLowerCase()
    .replace(/-/g, "_");
  if (s === "organizer") return "organizer";
  if (s === "co_admin" || s === "coadmin") return "co_admin";
  if (s === "moderator") return "moderator";
  if (s === "member") return "member";
  return null;
}

export function registerTripCheckpointRoutes(app: Express, ctx: TripCheckpointRoutesContext): void {
  const { supabase, getTripById, getUserById, toFiniteNumber, isValidLatLng, isMissingTableError } =
    ctx;

  async function resolveTripParticipantRole(
    tripId: number,
    userId: number,
  ): Promise<"organizer" | "co_admin" | "moderator" | "member" | null> {
    const trip = await getTripById(tripId);
    if (!trip) return null;
    if (Number((trip as { organizer_id?: unknown }).organizer_id) === userId) {
      return "organizer";
    }
    const { data: booking } = await supabase
      .from("bookings")
      .select("id")
      .eq("trip_id", tripId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!booking) return null;

    const { data: tm } = await supabase
      .from("trip_members")
      .select("role")
      .eq("trip_id", String(tripId))
      .eq("user_id", String(userId))
      .maybeSingle();

    const tr = normalizeTripRole((tm as { role?: unknown } | null)?.role);
    if (tr) return tr;
    return "member";
  }

  async function requireTripMember(tripId: number, userId: number) {
    const role = await resolveTripParticipantRole(tripId, userId);
    if (!role) return { ok: false as const, status: 403, error: "Not a trip participant" };
    return { ok: true as const, role };
  }

  async function requireTripStaff(tripId: number, userId: number) {
    const m = await requireTripMember(tripId, userId);
    if (!m.ok) return m;
    if (!isTripStaffRole(m.role)) {
      return { ok: false as const, status: 403, error: "Organizer, co-admin, or moderator only" };
    }
    return { ok: true as const, role: m.role };
  }

  function emitCpUpdated(tripId: number, extra?: { action?: string; checkpoint?: unknown }) {
    const io = ctx.socketBridge?.getIo() ?? null;
    emitCheckpointsUpdated(io, tripId, {
      tripId: Number(tripId),
      ...extra,
    });
  }

  function emitPinRequested(tripId: number, payload: Record<string, unknown>) {
    const io = ctx.socketBridge?.getIo() ?? null;
    emitToPrivileged(io, tripId, "map_pin:requested", payload);
  }

  function checkpointNameDescFromPinReason(raw: unknown): { name: string; description: string | null } {
    const s = String(raw ?? "").trim();
    if (!s) return { name: "Map pin", description: null };
    const nl = s.indexOf("\n");
    if (nl === -1) return { name: s.slice(0, 200), description: null };
    const first = s.slice(0, nl).trim();
    const rest = s.slice(nl + 1).trim();
    return {
      name: (first || "Map pin").slice(0, 200),
      description: rest ? rest.slice(0, 2000) : null,
    };
  }

  async function insertCheckpointFromMapPin(
    tripId: number,
    createdBy: number,
    name: string,
    description: string | null,
    lat: number,
    lng: number,
  ) {
    const { data: existing } = await supabase
      .from("trip_checkpoints")
      .select("order_index")
      .eq("trip_id", tripId)
      .order("order_index", { ascending: false })
      .limit(1);

    const nextOrder =
      existing && existing.length
        ? Number((existing[0] as { order_index?: unknown }).order_index ?? 0) + 1
        : 1;

    return supabase
      .from("trip_checkpoints")
      .insert({
        trip_id: tripId,
        source: "map_pin",
        name: name.slice(0, 200),
        description: description,
        latitude: lat,
        longitude: lng,
        order_index: nextOrder,
        created_by: createdBy,
        nearby_attraction_id: null,
      })
      .select("*")
      .single();
  }

  function emitPinReviewed(tripId: number, requesterUserId: number, payload: Record<string, unknown>) {
    const io = ctx.socketBridge?.getIo() ?? null;
    const sockId = ctx.socketBridge?.tripRiders.get(tripId)?.get(requesterUserId);
    if (sockId) emitMapPinReviewedToUser(io, sockId, payload);
  }

  // ─── A. Nearby attractions (per trip) ─────────────────────────────────────

  app.post("/api/trips/:tripId/nearby-attractions", async (req, res) => {
    const tripId = Number(req.params.tripId);
    const { user_id, name, description, latitude, longitude, lat, lng, images, trip_id } =
      req.body ?? {};
    const userId = toFiniteNumber(user_id);
    if (!Number.isFinite(tripId) || userId === null) {
      return res.status(400).json({ error: "trip id and a numeric user_id are required" });
    }
    const nameTrim = String(name ?? "").trim().slice(0, 200);
    if (!nameTrim) {
      return res.status(400).json({ error: "name is required" });
    }
    const staff = await requireTripStaff(tripId, userId);
    if (!staff.ok) return res.status(staff.status).json({ error: staff.error });

    const latNum = toFiniteNumber(latitude ?? lat);
    const lngNum = toFiniteNumber(longitude ?? lng);
    if (latNum === null || lngNum === null || !isValidLatLng(latNum, lngNum)) {
      return res.status(400).json({ error: "valid latitude and longitude are required" });
    }

    const imgs = Array.isArray(images) ? images.filter((x: unknown) => typeof x === "string").slice(0, 5) : [];
    console.log("POST nearby-attractions: saving with images count:", imgs.length, "tripId:", tripId);

    const row: Record<string, unknown> = {
      name: nameTrim,
      description: String(description ?? "").trim().slice(0, 2000) || null,
      lat: latNum,
      lng: lngNum,
      created_by: userId,
      images: imgs,
      trip_id: toFiniteNumber(trip_id) ?? tripId,
    };

    const { data, error } = await supabase.from("nearby_attractions").insert(row).select("*").single();
    if (error) {
      if (isMissingTableError(error.message)) {
        return res.status(503).json({ error: "nearby_attractions table missing" });
      }
      console.error("nearby_attractions insert:", error.message);
      return res.status(500).json({ error: error.message || "Failed to save" });
    }
    return res.json(data);
  });

  app.get("/api/trips/:tripId/nearby-attractions/route-suggestions", async (req, res) => {
    const tripId = Number(req.params.tripId);
    const userId = Number(req.query.user_id);
    const raw = String(req.query.routeCoords || "").trim();
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user_id query are required" });
    }
    const m = await requireTripMember(tripId, userId);
    if (!m.ok) return res.status(m.status).json({ error: m.error });

    let routeCoords: [number, number][] = [];
    try {
      const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
      if (Array.isArray(parsed)) {
        routeCoords = parsed
          .map((p) => {
            if (!Array.isArray(p) || p.length < 2) return null;
            const la = Number(p[0]);
            const ln = Number(p[1]);
            if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
            return [la, ln] as [number, number];
          })
          .filter((x): x is [number, number] => x != null);
      }
    } catch {
      return res.status(400).json({ error: "invalid routeCoords JSON" });
    }

    const { data: rows, error } = await supabase
      .from("nearby_attractions")
      .select("id, name, description, lat, lng, images, created_at")
      .limit(2000);

    if (error) {
      if (isMissingTableError(error.message)) return res.json([]);
      console.error("route-suggestions:", error.message);
      return res.status(500).json({ error: "Failed to load attractions" });
    }

    const list = rows ?? [];
    const picked = new Map<string, { row: (typeof list)[0]; dStart: number }>();

    const startLat = routeCoords[0]?.[0];
    const startLon = routeCoords[0]?.[1];
    if (startLat == null || startLon == null) {
      return res.json([]);
    }

    const refPts = getRouteFilterReferencePoints(routeCoords);

    for (const row of list) {
      const plat = Number((row as { lat?: unknown }).lat);
      const plng = Number((row as { lng?: unknown }).lng);
      if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;

      let near = false;
      for (const [rlat, rlng] of refPts) {
        if (haversineMeters(rlat, rlng, plat, plng) <= 50_000) {
          near = true;
          break;
        }
      }
      if (!near) continue;

      const id = String((row as { id?: unknown }).id);
      const dStart = haversineMeters(startLat, startLon, plat, plng);
      const prev = picked.get(id);
      if (!prev || dStart < prev.dStart) picked.set(id, { row, dStart });
    }

    const out = Array.from(picked.values())
      .sort((a, b) => a.dStart - b.dStart)
      .map((x) => x.row);

    return res.json(out);
  });

  /** Same geometry logic as trip route-suggestions, for create-event before a trip exists (organizer only). */
  app.get("/api/maps/community-route-suggestions", async (req, res) => {
    const userId = Number(req.query.user_id);
    const raw = String(req.query.routeCoords || "").trim();
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: "user_id query is required" });
    }
    const actor = await getUserById(userId);
    if (!actor || actor.role !== "organizer") {
      return res.status(403).json({ error: "Organizers only" });
    }

    let routeCoords: [number, number][] = [];
    try {
      const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
      if (Array.isArray(parsed)) {
        routeCoords = parsed
          .map((p) => {
            if (!Array.isArray(p) || p.length < 2) return null;
            const la = Number(p[0]);
            const ln = Number(p[1]);
            if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
            return [la, ln] as [number, number];
          })
          .filter((x): x is [number, number] => x != null);
      }
    } catch {
      return res.status(400).json({ error: "invalid routeCoords JSON" });
    }

    const { data: rows, error } = await supabase
      .from("nearby_attractions")
      .select("id, name, description, lat, lng, images, created_at")
      .limit(2000);

    if (error) {
      if (isMissingTableError(error.message)) return res.json([]);
      console.error("community-route-suggestions:", error.message);
      return res.status(500).json({ error: "Failed to load attractions" });
    }

    const list = rows ?? [];
    const picked = new Map<string, { row: (typeof list)[0]; dStart: number }>();
    const startLat = routeCoords[0]?.[0];
    const startLon = routeCoords[0]?.[1];
    if (startLat == null || startLon == null) {
      return res.json([]);
    }

    const refPts = getRouteFilterReferencePoints(routeCoords);

    for (const row of list) {
      const plat = Number((row as { lat?: unknown }).lat);
      const plng = Number((row as { lng?: unknown }).lng);
      if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;
      let near = false;
      for (const [rlat, rlng] of refPts) {
        if (haversineMeters(rlat, rlng, plat, plng) <= 50_000) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      const id = String((row as { id?: unknown }).id);
      const dStart = haversineMeters(startLat, startLon, plat, plng);
      const prev = picked.get(id);
      if (!prev || dStart < prev.dStart) picked.set(id, { row, dStart });
    }

    const out = Array.from(picked.values())
      .sort((a, b) => a.dStart - b.dStart)
      .map((x) => x.row);
    return res.json(out);
  });

  // ─── B. Checkpoints ────────────────────────────────────────────────────────

  app.get("/api/trips/:tripId/checkpoints", async (req, res) => {
    const tripId = Number(req.params.tripId);
    const userId = Number(req.query.user_id);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user_id are required" });
    }
    const m = await requireTripMember(tripId, userId);
    if (!m.ok) return res.status(m.status).json({ error: m.error });

    const { data, error } = await supabase
      .from("trip_checkpoints")
      .select("*")
      .eq("trip_id", tripId)
      .order("order_index", { ascending: true });

    if (error) {
      if (isMissingTableError(error.message)) return res.json([]);
      console.error("trip_checkpoints list:", error.message);
      return res.status(500).json({ error: "Failed to load checkpoints" });
    }
    return res.json(data ?? []);
  });

  app.post("/api/trips/:tripId/checkpoints", async (req, res) => {
    const tripId = Number(req.params.tripId);
    const {
      user_id,
      name,
      description,
      latitude,
      longitude,
      source,
      nearby_attraction_id,
    } = req.body ?? {};
    const userId = Number(user_id);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user_id are required" });
    }
    const staff = await requireTripStaff(tripId, userId);
    if (!staff.ok) return res.status(staff.status).json({ error: staff.error });

    const latNum = toFiniteNumber(latitude);
    const lngNum = toFiniteNumber(longitude);
    if (latNum === null || lngNum === null || !isValidLatLng(latNum, lngNum)) {
      return res.status(400).json({ error: "valid latitude and longitude are required" });
    }

    const src = String(source || "manual").toLowerCase();
    const allowed = ["manual", "nearby_attraction", "map_pin"];
    if (!allowed.includes(src)) {
      return res.status(400).json({ error: "invalid source" });
    }

    const { data: existing } = await supabase
      .from("trip_checkpoints")
      .select("order_index")
      .eq("trip_id", tripId)
      .order("order_index", { ascending: false })
      .limit(1);

    const nextOrder =
      existing && existing.length
        ? Number((existing[0] as { order_index?: unknown }).order_index ?? 0) + 1
        : 1;

    const row = {
      trip_id: tripId,
      name: String(name || "Checkpoint").trim().slice(0, 200),
      description: String(description ?? "").trim().slice(0, 2000) || null,
      latitude: latNum,
      longitude: lngNum,
      source: src,
      nearby_attraction_id: nearby_attraction_id ? String(nearby_attraction_id) : null,
      order_index: nextOrder,
      created_by: userId,
    };

    const { data, error } = await supabase.from("trip_checkpoints").insert(row).select("*").single();
    if (error) {
      if (isMissingTableError(error.message)) {
        return res.status(503).json({ error: "Run sql/checkpoints_and_pins_schema.sql in Supabase." });
      }
      console.error("trip_checkpoints insert:", error.message);
      return res.status(400).json({ error: error.message || "Failed to create checkpoint" });
    }
    emitCpUpdated(tripId, { action: "added", checkpoint: data });
    return res.json(data);
  });

  app.delete("/api/trips/:tripId/checkpoints/:checkpointId", async (req, res) => {
    const tripId = Number(req.params.tripId);
    const checkpointId = String(req.params.checkpointId);
    const userId = Number(req.query.user_id ?? (req.body as { user_id?: unknown } | undefined)?.user_id);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user_id are required" });
    }
    const staff = await requireTripStaff(tripId, userId);
    if (!staff.ok) return res.status(staff.status).json({ error: staff.error });

    const { error: delErr } = await supabase.from("trip_checkpoints").delete().eq("id", checkpointId).eq("trip_id", tripId);
    if (delErr) {
      console.error("trip_checkpoints delete:", delErr.message);
      return res.status(400).json({ error: delErr.message || "Delete failed" });
    }

    const { data: rest } = await supabase
      .from("trip_checkpoints")
      .select("id")
      .eq("trip_id", tripId)
      .order("order_index", { ascending: true });

    const ids = (rest ?? []).map((r: { id: string }, i: number) => ({ id: r.id, order_index: i + 1 }));
    for (const u of ids) {
      await supabase.from("trip_checkpoints").update({ order_index: u.order_index }).eq("id", u.id);
    }

    emitCpUpdated(tripId, { action: "changed" });
    return res.json({ ok: true });
  });

  app.patch("/api/trips/:tripId/checkpoints/reorder", async (req, res) => {
    const tripId = Number(req.params.tripId);
    const { user_id, orderedIds } = req.body ?? {};
    const userId = Number(user_id);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user_id are required" });
    }
    const staff = await requireTripStaff(tripId, userId);
    if (!staff.ok) return res.status(staff.status).json({ error: staff.error });

    const ids = Array.isArray(orderedIds) ? orderedIds.map((x: unknown) => String(x)) : [];
    let i = 1;
    for (const cid of ids) {
      await supabase.from("trip_checkpoints").update({ order_index: i }).eq("id", cid).eq("trip_id", tripId);
      i += 1;
    }
    emitCpUpdated(tripId, { action: "changed" });
    return res.json({ ok: true });
  });

  // ─── C. Map pin requests (table: map_pin_requests — not trip_map_pins) ─────

  app.post("/api/trips/:tripId/map-pin-requests", async (req, res) => {
    try {
      const tripId = Number(req.params.tripId);
      const { user_id, latitude, longitude, reason, label } = req.body ?? {};
      const userId = toFiniteNumber(user_id);
      if (!Number.isFinite(tripId) || userId === null) {
        return res.status(400).json({ error: "trip id and a numeric user_id are required" });
      }
      const m = await requireTripMember(tripId, userId);
      if (!m.ok) return res.status(m.status).json({ error: m.error });

      const latNum = toFiniteNumber(latitude);
      const lngNum = toFiniteNumber(longitude);
      if (latNum === null || lngNum === null || !isValidLatLng(latNum, lngNum)) {
        return res.status(400).json({ error: "valid latitude and longitude are required" });
      }
      const labelTrim = String(label ?? "").trim();
      const reasonTrim = String(reason ?? "").trim();
      if (!labelTrim && !reasonTrim) {
        return res.status(400).json({ error: "label or reason is required" });
      }
      const reasonStored = labelTrim ? `${labelTrim}\n${reasonTrim}` : reasonTrim;

      const actor = await getUserById(userId);
      const fallbackName = String(actor?.name || `User ${userId}`);
      const { data: tmRow } = await supabase
        .from("trip_members")
        .select("display_name")
        .eq("trip_id", String(tripId))
        .eq("user_id", String(userId))
        .maybeSingle();
      const tripDn = String((tmRow as { display_name?: string } | null)?.display_name ?? "").trim();
      const displayName = tripDn || fallbackName;
      const staff = isTripStaffRole(m.role);

      if (staff) {
        const nowIso = new Date().toISOString();
        console.log("Inserting map_pin_request (staff auto):", { tripId, userId, lat: latNum, lng: lngNum });
        const { data: pinRow, error: insErr } = await supabase
          .from("map_pin_requests")
          .insert({
            trip_id: tripId,
            requested_by: userId,
            latitude: latNum,
            longitude: lngNum,
            reason: reasonStored.slice(0, 2000),
            status: "approved",
            reviewed_by: userId,
            reviewed_at: nowIso,
          })
          .select("*")
          .single();

        if (insErr) {
          if (isMissingTableError(insErr.message)) {
            return res.status(503).json({ error: "Run sql/checkpoints_and_pins_schema.sql in Supabase." });
          }
          console.error("Map pin insert error (staff request row):", {
            message: insErr.message,
            code: insErr.code,
            details: insErr.details,
            hint: insErr.hint,
            tripId: req.params.tripId,
            userId,
            body: req.body,
          });
          return res.status(500).json({
            error: "Could not submit pin request",
            details: insErr.message,
          });
        }

        const { name: cpName, description: cpDesc } = checkpointNameDescFromPinReason(reasonStored);
        const { data: cpRow, error: cpErr } = await insertCheckpointFromMapPin(
          tripId,
          userId,
          cpName,
          cpDesc,
          latNum,
          lngNum,
        );

        if (cpErr) {
          console.error("Map pin insert error (staff checkpoint):", {
            message: cpErr.message,
            code: cpErr.code,
            details: cpErr.details,
            hint: cpErr.hint,
            tripId: req.params.tripId,
            userId,
          });
          return res.status(500).json({
            error: "Could not submit pin request",
            details: cpErr.message || "Failed to create checkpoint",
          });
        }

        emitCpUpdated(tripId, { action: "added", checkpoint: cpRow });
        return res.json({
          status: "approved",
          autoApproved: true,
          checkpoint: cpRow,
          request: pinRow,
        });
      }

      const sinceIso = new Date(Date.now() - 10_000).toISOString();
      const { data: dupPending } = await supabase
        .from("map_pin_requests")
        .select("id")
        .eq("trip_id", tripId)
        .eq("requested_by", userId)
        .eq("status", "pending")
        .gt("created_at", sinceIso)
        .limit(1)
        .maybeSingle();

      if (dupPending) {
        return res.status(409).json({ error: "duplicate", message: "Request already submitted" });
      }

      console.log("Inserting map_pin_request (pending):", { tripId, userId, lat: latNum, lng: lngNum });
      const { data, error } = await supabase
        .from("map_pin_requests")
        .insert({
          trip_id: tripId,
          requested_by: userId,
          latitude: latNum,
          longitude: lngNum,
          reason: reasonStored.slice(0, 2000),
          status: "pending",
        })
        .select("*")
        .single();

      if (error) {
        if (isMissingTableError(error.message)) {
          return res.status(503).json({ error: "Run sql/checkpoints_and_pins_schema.sql in Supabase." });
        }
        console.error("Map pin insert error:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          tripId: req.params.tripId,
          userId,
          body: req.body,
        });
        return res.status(500).json({
          error: "Could not submit pin request",
          details: error.message,
        });
      }

      if (!data) {
        console.error("Map pin insert error: no row returned", { tripId, userId });
        return res.status(500).json({
          error: "Could not submit pin request",
          details: "No row returned from database",
        });
      }

      const pinId = String((data as { id?: unknown }).id ?? "");
      emitPinRequested(tripId, {
        pinId,
        requestedBy: { userId, displayName },
        lat: latNum,
        lng: lngNum,
        reason: reasonTrim,
        label: labelTrim || "Map pin",
        tripId,
      });
      return res.json({
        status: "pending",
        message: "Awaiting approval",
        pinId,
        request: data,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Map pin request handler error:", message, err);
      return res.status(500).json({
        error: "Could not submit pin request",
        details: message,
      });
    }
  });

  app.patch("/api/trips/:tripId/map-pin-requests/:pinId/review", async (req, res) => {
    const tripId = Number(req.params.tripId);
    const pinId = String(req.params.pinId);
    const { user_id, action } = req.body ?? {};
    const userId = Number(user_id);
    if (!Number.isFinite(tripId) || !Number.isFinite(userId)) {
      return res.status(400).json({ error: "trip id and user_id are required" });
    }
    const staff = await requireTripStaff(tripId, userId);
    if (!staff.ok) return res.status(staff.status).json({ error: staff.error });

    const act = String(action || "").toLowerCase();
    if (act !== "approve" && act !== "deny") {
      return res.status(400).json({ error: "action must be approve or deny" });
    }

    const { data: reqRow, error: fetchErr } = await supabase
      .from("map_pin_requests")
      .select("*")
      .eq("id", pinId)
      .eq("trip_id", tripId)
      .maybeSingle();

    if (fetchErr || !reqRow) {
      return res.status(404).json({ error: "Request not found" });
    }

    const nowIso = new Date().toISOString();
    const status = act === "approve" ? "approved" : "denied";

    const { error: upErr } = await supabase
      .from("map_pin_requests")
      .update({
        status,
        reviewed_by: userId,
        reviewed_at: nowIso,
      })
      .eq("id", pinId)
      .eq("trip_id", tripId);

    if (upErr) {
      console.error("map_pin review:", upErr.message);
      return res.status(400).json({ error: upErr.message || "Update failed" });
    }

    const requesterId = Number((reqRow as { requested_by?: unknown }).requested_by);
    const plat = Number((reqRow as { latitude?: unknown }).latitude);
    const plng = Number((reqRow as { longitude?: unknown }).longitude);
    const rawReason = (reqRow as { reason?: unknown }).reason;

    let checkpointName = "Map pin";
    if (act === "approve") {
      const { name: cpName, description: cpDesc } = checkpointNameDescFromPinReason(rawReason);
      checkpointName = cpName;
      const { data: cpRow, error: insErr } = await insertCheckpointFromMapPin(
        tripId,
        requesterId,
        cpName,
        cpDesc,
        plat,
        plng,
      );

      if (insErr) {
        console.error("checkpoint from pin:", insErr.message);
        return res.status(400).json({ error: insErr.message || "Failed to create checkpoint" });
      }
      const approvedName = String((cpRow as { name?: unknown })?.name ?? cpName);
      res.json({ ok: true, status: "approved", checkpoint: cpRow });
      setImmediate(() => {
        emitCpUpdated(tripId, { action: "added", checkpoint: cpRow });
        emitPinReviewed(tripId, requesterId, {
          pinId,
          status: "approved",
          checkpointName: approvedName,
        });
      });
      return;
    }

    res.json({ ok: true, status: "denied" });
    setImmediate(() => {
      emitPinReviewed(tripId, requesterId, { pinId, status: "denied" });
    });
  });
}
