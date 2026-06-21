//index.ts
import "react-native-gesture-handler";

// Clerk SDK internally accesses browser APIs (window.location, CustomEvent) for OAuth.
// Polyfill them for React Native before Clerk initializes.
if (typeof window !== "undefined") {
  if (!window.location) {
    (window as any).location = {
      href: "tripsync://",
      origin: "tripsync://",
      protocol: "tripsync:",
      host: "",
      hostname: "",
      pathname: "/",
      search: "",
      hash: "",
    };
  }
  if (typeof (window as any).CustomEvent === "undefined") {
    (window as any).CustomEvent = class CustomEvent {
      type: string;
      detail: any;
      bubbles: boolean;
      cancelable: boolean;
      defaultPrevented = false;
      constructor(type: string, options?: { detail?: any; bubbles?: boolean; cancelable?: boolean }) {
        this.type = type;
        this.detail = options?.detail ?? null;
        this.bubbles = options?.bubbles ?? false;
        this.cancelable = options?.cancelable ?? false;
      }
      preventDefault() { this.defaultPrevented = true; }
      stopPropagation() {}
      stopImmediatePropagation() {}
    };
  }
  if (typeof (window as any).dispatchEvent === "undefined") {
    const eventListeners = new Map<string, Set<Function>>();
    (window as any).addEventListener = (type: string, listener: Function) => {
      if (!eventListeners.has(type)) eventListeners.set(type, new Set());
      eventListeners.get(type)!.add(listener);
    };
    (window as any).removeEventListener = (type: string, listener: Function) => {
      eventListeners.get(type)?.delete(listener);
    };
    (window as any).dispatchEvent = (event: any) => {
      const listeners = eventListeners.get(event.type);
      if (listeners) listeners.forEach(l => l(event));
      return true;
    };
  }
}

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
