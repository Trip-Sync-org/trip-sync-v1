//types.ts
export type User = {
  id: string;
  authUserId?: string;
  name: string;
  email: string;
  role: "user" | "organizer";
  roles?: string[];
  activeRole?: string;
  level?: number;
  xp?: number;
  avatar_url?: string | null;
};

export type TripListItem = {
  id: number;
  name?: string;
  theme?: string;
  date?: string;
  price?: number;
  max_participants?: number;
  joined_count?: number;
  status?: string;
  banner_url?: string;
  gallery?: MediaItemData[] | null;
};

export type CheckpointSource = "manual" | "nearby_attraction" | "map_pin";

/** Row from `trip_checkpoints` / checkpoint APIs */
export type TripCheckpoint = {
  id: string;
  trip_id?: number;
  source: CheckpointSource;
  nearby_attraction_id?: string | null;
  name: string;
  description?: string | null;
  latitude: number;
  longitude: number;
  order_index: number;
  created_by?: string | null;
  created_at?: string;
};

export type MediaItemData = {
  url: string;
  type: "image" | "video";
  thumbnailUrl?: string | null;
};

export type NearbyAttraction = {
  id: string;
  name: string;
  description?: string | null;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  images?: string[] | null;
  media?: MediaItemData[] | null;
  trip_id?: number | null;
  created_at?: string;
};

export type MapPinRequest = {
  id: string;
  trip_id: number;
  requested_by: number;
  latitude: number;
  longitude: number;
  reason: string;
  status: "pending" | "approved" | "denied";
  reviewed_by?: number | null;
  reviewed_at?: string | null;
  created_at?: string;
};