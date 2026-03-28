/** Mirrors web `App.tsx` trip normalization for bookings / marketplace parity. */

export type Trip = {
  id: string;
  name: string;
  theme?: string;
  banner?: string;
  banner_url?: string;
  date?: string;
  time?: string;
  duration?: string;
  price?: number;
  isFree?: boolean;
  meetupPoint?: string;
  endLocation?: string;
  maxParticipants?: number;
  joinedCount?: number;
  organizer?: string;
  privacy?: string;
  status?: string;
  rating?: number;
  meetupLat?: number;
  meetupLng?: number;
  endLat?: number;
  endLng?: number;
};

function asNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeTripFromApi(raw: Record<string, unknown>): Trip {
  return {
    id: String(raw?.trip_id ?? raw?.id ?? ""),
    name: String(raw?.trip_name ?? raw?.name ?? "Untitled Trip"),
    theme: String(raw?.trip_theme ?? raw?.theme ?? "Adventure"),
    banner_url: raw?.banner_url ? String(raw.banner_url) : undefined,
    date: raw?.trip_date ? String(raw.trip_date) : raw?.date ? String(raw.date) : undefined,
    time: raw?.trip_time ? String(raw.trip_time) : raw?.time ? String(raw.time) : undefined,
    duration: raw?.trip_duration ? String(raw.trip_duration) : raw?.duration ? String(raw.duration) : undefined,
    price: asNum(raw?.trip_price ?? raw?.price ?? raw?.amount_paid) ?? 0,
    isFree: (asNum(raw?.trip_price ?? raw?.price ?? raw?.amount_paid) ?? 0) <= 0,
    meetupPoint: raw?.trip_start_location
      ? String(raw.trip_start_location)
      : raw?.start_location
        ? String(raw.start_location)
        : undefined,
    endLocation: raw?.trip_end_location
      ? String(raw.trip_end_location)
      : raw?.end_location
        ? String(raw.end_location)
        : undefined,
    maxParticipants: asNum(raw?.trip_max_participants ?? raw?.max_participants),
    joinedCount: asNum(raw?.joined_count) ?? asNum(raw?.participant_count) ?? 0,
    organizer: raw?.organizer_name ? String(raw.organizer_name) : "Organizer",
    privacy: raw?.privacy ? String(raw.privacy) : undefined,
    status: raw?.trip_status
      ? String(raw.trip_status)
      : raw?.status
        ? String(raw.status)
        : raw?.booking_status
          ? String(raw.booking_status)
          : undefined,
    rating: asNum(raw?.rating),
    meetupLat: asNum(raw?.meetup_lat ?? raw?.meetupLat),
    meetupLng: asNum(raw?.meetup_lng ?? raw?.meetupLng),
    endLat: asNum(raw?.end_lat ?? raw?.endLat),
    endLng: asNum(raw?.end_lng ?? raw?.endLng),
    banner:
      (typeof raw?.banner === "string" && raw.banner) ||
      (raw?.banner_url ? String(raw.banner_url).replace(/\W/g, "").slice(-20) : undefined) ||
      `trip-${raw?.trip_id ?? raw?.id ?? "x"}`,
  };
}

export function parseDateOnlyLocal(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = String(s).trim().slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(String(s));
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfTodayLocal(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function tripDateVsToday(dateStr: string | undefined): "today" | "future" | "past" | "unknown" {
  const d = parseDateOnlyLocal(dateStr);
  if (!d) return "unknown";
  const t0 = startOfTodayLocal().getTime();
  const t1 = d.getTime();
  if (t1 === t0) return "today";
  if (t1 < t0) return "past";
  return "future";
}

export function isBookingCancelledOrCompleted(t: Trip): boolean {
  const s = String(t.status || "").toLowerCase();
  return s === "cancelled" || s === "canceled" || s === "completed" || s === "refunded";
}

export function isPrivateTrip(t: Trip): boolean {
  return String(t.privacy || "").toLowerCase() === "private";
}
