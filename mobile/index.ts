//index.ts
// Polyfill window.location unconditionally BEFORE any Clerk/OAuth modules load.
// In production Hermes builds, Clerk accesses window.location.href at module init time,
// and if the polyfill runs too late (inside a conditional after imports), it crashes.
import "./src/utils/polyfillWindowLocation";

import "react-native-gesture-handler";
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
