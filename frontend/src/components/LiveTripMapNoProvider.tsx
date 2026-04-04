/**
 * LiveTripMapNoProvider.tsx
 * Fetches /api/trips/:id/live-state on an interval and renders the Mapbox-based LiveTripMap.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import LiveTripMap, {
  type ConvoyMember,
  type TripCheckpoint,
  type MapPin,
  type LiveTripMapProps,
} from "./LiveTripMap";

// Named exports expected by `App.tsx` (kept lightweight).
export type MapTheme = "light" | "dark";
const MAP_THEME_KEY = "trip-sync-live-map-theme";
export function readLiveMapStoredTheme(): MapTheme {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(MAP_THEME_KEY) === "dark" ? "dark" : "light";
}

export type LiveUserGeo = {
  lat: number;
  lng: number;
  accuracyM?: number;
  headingDeg?: number | null;
  speedMps?: number | null;
};

export type LiveTripMapRef = {
  flyTo?: (_opts: { lat: number; lng: number; zoom?: number }) => void;
  togglePitch?: () => void;
  fitConvoy?: () => void;
  recenterOnUser?: (_at?: { lat: number; lng: number }) => void;
  toggleHeadingUp?: () => void;
  toggleTraffic?: () => void;
  setTrafficVisible?: (_visible: boolean) => void;
  zoomBy?: (_delta: number) => void;
  resetNorth?: () => void;
  getBearing?: () => number;
  getFollowUser?: () => boolean;
} | null;

interface LiveState {
  members: ConvoyMember[];
  checkpoints: TripCheckpoint[];
  mapPins: MapPin[];
}

const PEER_LOCATION_STALE_MS = 45_000;

function convoyMemberLocationFresh(m: ConvoyMember): boolean {
  const raw = m.locationUpdatedAt;
  if (raw == null || raw === "") return true;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= PEER_LOCATION_STALE_MS;
}

type Props = Omit<LiveTripMapProps, "members" | "checkpoints" | "mapPins"> & {
  pollIntervalMs?: number;
};

export default function LiveTripMapNoProvider({
  tripId,
  userId,
  pollIntervalMs = 1200,
  ...rest
}: Props) {
  const [liveState, setLiveState] = useState<LiveState>({
    members: [],
    checkpoints: [],
    mapPins: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [staleTick, setStaleTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLiveState = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/live-state?user_id=${userId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as LiveState;
      setLiveState(data);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("live-state fetch failed:", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [tripId, userId]);

  useEffect(() => {
    fetchLiveState();
    intervalRef.current = setInterval(fetchLiveState, pollIntervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchLiveState, pollIntervalMs]);

  useEffect(() => {
    const t = setInterval(() => setStaleTick((x) => x + 1), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const socket = io("/", { transports: ["websocket", "polling"] });
    const tid = Number(tripId);
    const joinTripRoom = () => {
      socket.emit("join-trip", tid);
    };
    if (socket.connected) joinTripRoom();
    socket.on("connect", joinTripRoom);

    socket.on(
      "location-updated",
      (payload: { userId: number; lat: number; lng: number; speed?: number | null }) => {
        setLiveState((prev) => {
          const kmh =
            payload.speed != null && Number.isFinite(payload.speed)
              ? Number((payload.speed * 3.6).toFixed(1))
              : undefined;
          const idx = prev.members.findIndex((m) => m.userId === payload.userId);
          if (idx >= 0) {
            return {
              ...prev,
              members: prev.members.map((m) =>
                m.userId === payload.userId
                  ? {
                      ...m,
                      lat: payload.lat,
                      lng: payload.lng,
                      speed: kmh != null ? kmh : m.speed,
                      locationUpdatedAt: new Date().toISOString(),
                    }
                  : m,
              ),
            };
          }
          return {
            ...prev,
            members: [
              ...prev.members,
              {
                id: `m${payload.userId}`,
                userId: payload.userId,
                name: `Rider ${payload.userId}`,
                avatar: `rider-${payload.userId}`,
                status: "on-way" as const,
                role: "member",
                muted: false,
                blocked: false,
                speed: kmh ?? 0,
                distanceCovered: 0,
                checkpoints: 0,
                xpGained: 0,
                lat: payload.lat,
                lng: payload.lng,
                locationUpdatedAt: new Date().toISOString(),
              },
            ],
          };
        });
      },
    );
    return () => {
      socket.disconnect();
    };
  }, [tripId]);

  // Best-effort location push (non-critical).
  const pushLocationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const myPositionRef = useRef<{ lat: number; lng: number; speed: number } | null>(null);

  useEffect(() => {
    pushLocationRef.current = setInterval(async () => {
      const pos = myPositionRef.current;
      if (!pos) return;
      try {
        await fetch(`/api/trips/${tripId}/location`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            lat: pos.lat,
            lng: pos.lng,
            speed_mps: pos.speed / 3.6,
          }),
        });
      } catch {
        // silent
      }
    }, 2000);
    return () => {
      if (pushLocationRef.current) clearInterval(pushLocationRef.current);
    };
  }, [tripId, userId]);

  const handleLocationUpdate = useCallback(
    (lat: number, lng: number, speed: number) => {
      myPositionRef.current = { lat, lng, speed };
      rest.onLocationUpdate?.(lat, lng, speed);
    },
    [rest],
  );

  const membersForMap = useMemo(() => {
    void staleTick;
    return liveState.members.filter(
      (m) =>
        convoyMemberLocationFresh(m) &&
        Number.isFinite(m.lat) &&
        Number.isFinite(m.lng) &&
        (Math.abs(m.lat) > 1e-5 || Math.abs(m.lng) > 1e-5),
    );
  }, [liveState.members, staleTick]);

  if (loading) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          minHeight: 300,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a14",
          borderRadius: 16,
          color: "rgba(255,255,255,0.5)",
          fontSize: 14,
          fontFamily: "system-ui, sans-serif",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 20 }}>🗺</span> Loading live trip…
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          minHeight: 300,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a14",
          borderRadius: 16,
          color: "rgba(255,255,255,0.6)",
          fontSize: 14,
          fontFamily: "system-ui, sans-serif",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 28 }}>⚠️</span>
        <span>Could not load trip: {error}</span>
        <button
          onClick={fetchLiveState}
          style={{
            marginTop: 8,
            padding: "8px 20px",
            borderRadius: 20,
            background: "#1a73e8",
            color: "white",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <LiveTripMap
      {...rest}
      tripId={tripId}
      userId={userId}
      members={membersForMap}
      checkpoints={liveState.checkpoints}
      mapPins={liveState.mapPins}
      onLocationUpdate={handleLocationUpdate}
    />
  );
}
