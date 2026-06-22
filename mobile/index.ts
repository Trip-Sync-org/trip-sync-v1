//index.ts
// IMPORTANT: react-native-gesture-handler MUST be the first import in the app.
// Then polyfill window.location before Clerk/OAuth modules load.
import "react-native-gesture-handler";

// Polyfill window.location BEFORE any Clerk/OAuth modules load.
// In production Hermes builds, Clerk accesses window.location.href at module init time,
// and if the polyfill runs too late (inside a conditional after imports), it crashes.
import "./src/utils/polyfillWindowLocation";

import { registerGlobals } from "@livekit/react-native";
try {
  registerGlobals();
  console.log("[livekit] registerGlobals() succeeded");
} catch (e) {
  console.error("[livekit] registerGlobals() FAILED:", e);
}

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
