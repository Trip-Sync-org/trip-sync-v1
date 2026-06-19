//index.ts
import "react-native-gesture-handler";

// LiveKit WebRTC globals — MUST be called before any LiveKit or WebRTC code runs.
// Without this, @livekit/react-native throws "WebRTC isn't detected, have you called registerGlobals?"
import { registerGlobals } from "@livekit/react-native";
try {
  registerGlobals();
  console.log("[livekit] registerGlobals() succeeded");
} catch (e) {
  console.error("[livekit] registerGlobals() FAILED:", e);
  if (__DEV__) throw e;
}

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
