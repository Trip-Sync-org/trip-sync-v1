//index.ts
import "react-native-gesture-handler";

// LiveKit WebRTC globals — MUST be called before any LiveKit or WebRTC code runs.
// Without this, @livekit/react-native throws "WebRTC isn't detected, have you called registerGlobals?"
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerGlobals } = require("@livekit/react-native") as typeof import("@livekit/react-native");
  registerGlobals();
} catch (_) {
  // Expo Go does not include native WebRTC — safe to ignore here
}

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
