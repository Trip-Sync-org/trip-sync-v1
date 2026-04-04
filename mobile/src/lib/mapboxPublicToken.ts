/**
 * Mapbox GL JS may only use a public default token (pk.*).
 * Prefer `expo-constants` `extra` (set in app.config.js) — it tracks `.env` better than
 * Metro-inlined `process.env.EXPO_PUBLIC_*` after you edit mobile/.env.
 */
import Constants from "expo-constants";

function normalizeRawToken(raw: string): string {
  let t = raw.trim();
  // Strip UTF-8 BOM
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1).trim();
  // Some editors/dotenv parsers leave wrapping quotes in the value
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/** Runtime token: extra (app.config.js) first, then env fallback. */
export function getMapboxPublicToken(): string {
  const extra = Constants.expoConfig?.extra as { mapboxPublicToken?: string } | undefined;
  const fromExtra = normalizeRawToken(extra?.mapboxPublicToken ?? "");
  if (fromExtra) return fromExtra;
  return normalizeRawToken(process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ?? "");
}

export function mapboxTokenConfigError(token: string | undefined): string | null {
  const t = normalizeRawToken(token ?? "");
  if (!t) {
    return "Set EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN in mobile/.env to your Mapbox public token (starts with pk.). Restart Expo after editing.";
  }
  if (t.startsWith("sk.")) {
    return "Mapbox default public token required (pk.…), not a secret token (sk.…). In mobile/.env keep a single EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN line copied from VITE_MAPBOX_PUBLIC_TOKEN — remove duplicate lines so sk. does not override pk.";
  }
  if (!t.startsWith("pk.")) {
    return "EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN must be a public Mapbox token (starts with pk.).";
  }
  return null;
}
