import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'user' | 'organizer';
  level: number;
  xp: number;
  carbon_saved: number;
  wallet_balance: number;
}

export interface Trip {
  id: number;
  organizer_id: number;
  name: string;
  description: string;
  theme: string;
  date: string;
  time: string;
  duration: string;
  price: number;
  max_participants: number;
  meetup_lat: number;
  meetup_lng: number;
  privacy: 'public' | 'private';
  status: 'upcoming' | 'active' | 'completed';
  banner_url?: string;
  start_location?: string;
  end_location?: string;
  prerequisites?: string;
  terms?: string;
  tags?: string; // JSON stringified array
}
