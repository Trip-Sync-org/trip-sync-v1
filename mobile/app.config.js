/**
 * Expo loads `.env` before evaluating this file. We mirror the Mapbox token into `extra`
 * so the app can read it at runtime via `expo-constants` — avoiding Metro's stale
 * inlined `process.env.EXPO_PUBLIC_*` after `.env` edits without a full cache clear.
 */
const appJson = require("./app.json");

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra || {}),
      mapboxPublicToken: (process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN || "").trim(),
    },
  },
};
