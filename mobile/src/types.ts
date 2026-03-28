export type User = {
  id: string;
  name: string;
  email: string;
  role: "user" | "organizer";
  level?: number;
  xp?: number;
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
};
