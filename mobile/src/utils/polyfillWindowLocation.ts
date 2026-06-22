/**
 * polyfillWindowLocation.ts
 * Unconditional polyfill for window.location — must be imported FIRST before any Clerk
 * or OAuth module is loaded. In React Native production builds with Hermes,
 * Clerk's internal code can access window.location.href synchronously at module
 * initialization time, before any conditional polyfill has a chance to run.
 *
 * This file makes assignments unconditionally and is imported at the TOP of index.ts,
 * before any other imports (except react-native-gesture-handler which is needed for
 * the gesture system and does not interact with window.location).
 */
(function polyfillNow(): void {
  // Unconditionally assign window.location — harmless if already defined,
  // prevents 'Cannot read property href of undefined' crash in Clerk/OAuth.
  try {
    if (typeof window !== "undefined") {
      const loc: Location = {
        href: "",
        origin: "",
        protocol: "",
        host: "",
        hostname: "",
        port: "",
        pathname: "/",
        search: "",
        hash: "",
        ancestorOrigins: [] as unknown as DOMStringList,
        assign: () => {},
        replace: () => {},
        reload: () => {},
        toString: () => "",
      };
      if (!(window as any).location) {
        (window as any).location = loc;
      }
    }
  } catch (_) {
    // Ignore — if window is truly undefined, nothing can be done.
  }
})();