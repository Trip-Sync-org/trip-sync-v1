/**
 * API base URL for the Trip-Sync Express server (run `npm run dev` in repo root).
 *
 * - iOS Simulator: http://localhost:3000
 * - Android Emulator: http://10.0.2.2:3000
 * - Physical device: http://<your PC LAN IP>:3000
 *
 * Set EXPO_PUBLIC_API_URL in mobile/.env (see .env.example).
 */
export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

/** Mappls Web SDK token (used inside mobile live map WebView) */
export const MAPPLS_MAP_TOKEN =
  process.env.EXPO_PUBLIC_MAPPLS_MAP_TOKEN?.trim() ||
  process.env.VITE_MAPPLS_MAP_TOKEN?.trim() ||
  "ekxxaggusljbiffcwzwvrezpnjrlqymitetk";

/** Mappls Cloud key (optional for REST calls) */
export const MAPPLS_API_KEY =
  process.env.EXPO_PUBLIC_MAPPLS_API_KEY?.trim() ||
  process.env.VITE_MAPPLS_API_KEY?.trim() ||
  "";
