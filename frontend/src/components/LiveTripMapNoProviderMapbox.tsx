/**
 * LiveTripMapNoProviderMapbox.tsx
 * Clean Mapbox wrapper: polls live-state and renders `./LiveTripMap`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import LiveTripMap, {
  type ConvoyMember,
  type TripCheckpoint,
  type MapPin,
  type LiveTripMapProps,
} from "./LiveTripMap";

// Exports expected by `App.tsx`
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

type Props = Omit<LiveTripMapProps, "members" | "checkpoints" | "mapPins"> & {
  pollIntervalMs?: number;
};

export default function LiveTripMapNoProviderMapbox({
  tripId,
  userId,
  pollIntervalMs = 5000,
  ...rest
}: Props) {
  const [liveState, setLiveState] = useState<LiveState>({ members: [], checkpoints: [], mapPins: [] });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLiveState = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/live-state?user_id=${userId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setLiveState((await res.json()) as LiveState);
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

  if (loading) {
    return (
      <div style={{ width: "100%", height: "100%", minHeight: 300, display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a14", borderRadius: 16, color: "rgba(255,255,255,0.5)", fontSize: 14, fontFamily: "system-ui, sans-serif", gap: 10 }}>
        <span style={{ fontSize: 20 }}>🗺</span> Loading live trip…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ width: "100%", height: "100%", minHeight: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a0a14", borderRadius: 16, color: "rgba(255,255,255,0.6)", fontSize: 14, fontFamily: "system-ui, sans-serif", gap: 8 }}>
        <span style={{ fontSize: 28 }}>⚠️</span>
        <span>Could not load trip: {error}</span>
        <button onClick={fetchLiveState} style={{ marginTop: 8, padding: "8px 20px", borderRadius: 20, background: "#1a73e8", color: "white", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
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
      members={liveState.members}
      checkpoints={liveState.checkpoints}
      mapPins={liveState.mapPins}
    />
  );
}

