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

/** Same server as API (PayU surl/furl, webhooks). Defaults to EXPO_PUBLIC_API_URL. */
export const BACKEND_PUBLIC_URL = (
  process.env.EXPO_PUBLIC_BACKEND_URL ?? process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
