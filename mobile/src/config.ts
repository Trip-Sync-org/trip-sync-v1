const rawApiUrl = process.env["EXPO_PUBLIC_API_URL"] ?? "";
const rawSocketUrl = process.env["EXPO_PUBLIC_SOCKET_URL"] ?? "";

export const API_BASE_URL = (
  rawApiUrl || "http://localhost:3000"
).replace(/\/+$/, "");

export const BACKEND_PUBLIC_URL = (
  process.env["EXPO_PUBLIC_BACKEND_URL"] ?? rawApiUrl ?? "http://localhost:3000"
).replace(/\/+$/, "");

export const SOCKET_URL = (
  rawSocketUrl || rawApiUrl || "http://localhost:4000"
).replace(/\/+$/, "");

export const SUPABASE_URL = (
  process.env["EXPO_PUBLIC_SUPABASE_URL"] ?? ""
).replace(/^["']|["']$/g, "").trim();

export const SUPABASE_ANON_KEY = (
  process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"] ?? ""
).replace(/^["']|["']$/g, "").trim();

export const MAPBOX_TOKEN = (
  process.env["EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN"] ?? ""
).replace(/^["']|["']$/g, "").trim();

// Debug log (visible in Metro / flipper) so you can verify at runtime
// which URL the APK build is actually using.
if (__DEV__) {
  console.log("[config] API_BASE_URL:", API_BASE_URL);
  console.log("[config] SOCKET_URL:", SOCKET_URL);
}
