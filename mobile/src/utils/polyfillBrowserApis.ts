/**
 * Polyfills browser-only APIs that Clerk's OAuth internals need.
 * Must be called BEFORE startSSOFlow() or startOAuthFlow().
 * Safe to call multiple times (idempotent — checks if already polyfilled).
 */
export function polyfillBrowserApis(): void {
  try {
    if (typeof window === "undefined") return;
    if (!(window as any).location) {
      (window as any).location = { href: "", origin: "", protocol: "", host: "", hostname: "", pathname: "/", search: "", hash: "" };
    }
    if (typeof (window as any).CustomEvent === "undefined") {
      (window as any).CustomEvent = class {
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
      const _ls = new Map();
      (window as any).addEventListener = (t: string, l: Function) => {
        if (!_ls.has(t)) _ls.set(t, new Set());
        _ls.get(t)!.add(l);
      };
      (window as any).removeEventListener = (t: string, l: Function) => _ls.get(t)?.delete(l);
      (window as any).dispatchEvent = (e: any) => { _ls.get(e.type)?.forEach((l: Function) => l(e)); return true; };
    }
  } catch (_) { /* ignore */ }
}