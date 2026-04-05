import type { TripCheckpoint } from "../types";

const R = 6371000;

/** Great-circle distance in meters (same result as `haversineDistance`; atan2 form). */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineMeters(lat1, lon1, lat2, lon2);
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function insertCheckpointByDistance(
  checkpoints: TripCheckpoint[],
  newCheckpoint: TripCheckpoint,
  routeStartLat: number,
  routeStartLon: number,
): TripCheckpoint[] {
  const dist = (c: TripCheckpoint) =>
    haversineDistance(routeStartLat, routeStartLon, c.latitude, c.longitude);
  const next: TripCheckpoint[] = [...checkpoints, newCheckpoint].sort((a, b) => dist(a) - dist(b));
  return next.map((c, i) => ({ ...c, order_index: i + 1 }));
}

export function getRouteSegmentMidpoints(routeCoords: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const a = routeCoords[i];
    const b = routeCoords[i + 1];
    if (!a || !b) continue;
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}
