//index.ts
import "react-native-gesture-handler";

/** Polyfills required by Clerk's OAuth internals. Needs to run before Clerk init. */
function polyfillBrowserApis() {
  try {
    if (typeof window === "undefined") return;
    (window as any).location = (window as any).location || {
      href: "tripsync://",
      origin: "tripsync://",
      protocol: "tripsync:",
      host: "",
      hostname: "",
      pathname: "/",
      search: "",
      hash: "",
    };
    if (typeof (window as any).CustomEvent === "undefined") {
      (window as any).CustomEvent = class CustomEvent {
        type: string; detail: any; bubbles = false; cancelable = false; defaultPrevented = false;
        constructor(type: string, opts?: any) {
          this.type = type; this.detail = opts?.detail ?? null;
          this.bubbles = opts?.bubbles ?? false; this.cancelable = opts?.cancelable ?? false;
        }
        preventDefault() { this.defaultPrevented = true; }
        stopPropagation() {}
        stopImmediatePropagation() {}
      };
    }
    if (typeof (window as any).dispatchEvent === "undefined") {
      const _listeners = new Map();
      (window as any).addEventListener = (t: string, l: Function) => {
        if (!_listeners.has(t)) _listeners.set(t, new Set());
        _listeners.get(t)!.add(l);
      };
      (window as any).removeEventListener = (t: string, l: Function) => _listeners.get(t)?.delete(l);
      (window as any).dispatchEvent = (e: any) => { _listeners.get(e.type)?.forEach((l: Function) => l(e)); return true; };
    }
  } catch (_) { /* ignore polyfill errors */ }
}
polyfillBrowserApis();
// LiveKit WebRTC globals — MUST be called before any LiveKit or WebRTC code runs.
// Without this, @livekit/react-native throws "WebRTC isn't detected, have you called registerGlobals?"
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
