//index.ts
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