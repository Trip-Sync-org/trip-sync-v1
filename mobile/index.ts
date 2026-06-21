//index.ts
import "react-native-gesture-handler";

// Browser API polyfills for Clerk OAuth internals
try {
  if (typeof window !== "undefined") {
    if (!(window as any).location) (window as any).location = { href: "", origin: "", protocol: "", host: "", hostname: "", pathname: "/", search: "", hash: "" };
    if (typeof (window as any).CustomEvent === "undefined") {
      (window as any).CustomEvent = class {
        type: string; detail: any; bubbles = false; cancelable = false; defaultPrevented = false;
        constructor(type: string, opts?: any) { this.type = type; this.detail = opts?.detail ?? null; this.bubbles = opts?.bubbles ?? false; this.cancelable = opts?.cancelable ?? false; }
        preventDefault() { this.defaultPrevented = true; } stopPropagation() {} stopImmediatePropagation() {}
      };
    }
    if (typeof (window as any).dispatchEvent === "undefined") {
      const _ls = new Map();
      (window as any).addEventListener = (t: string, l: Function) => { if (!_ls.has(t)) _ls.set(t, new Set()); _ls.get(t)!.add(l); };
      (window as any).removeEventListener = (t: string, l: Function) => _ls.get(t)?.delete(l);
      (window as any).dispatchEvent = (e: any) => { _ls.get(e.type)?.forEach((l: Function) => l(e)); return true; };
    }
  }
} catch (_) {}
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
