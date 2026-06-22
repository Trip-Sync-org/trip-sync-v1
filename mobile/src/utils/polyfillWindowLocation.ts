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
 *
 * NOTE: No TS types (Location, DOMStringList) since they don't exist in RN's type env.
 */
(function polyfillNow(): void {
  try {
    if (typeof window !== "undefined") {
      var w: any = window;
      if (!w.location) {
        w.location = {
          href: "",
          origin: "",
          protocol: "",
          host: "",
          hostname: "",
          port: "",
          pathname: "/",
          search: "",
          hash: "",
          ancestorOrigins: [],
          assign: function () {},
          replace: function () {},
          reload: function () {},
          toString: function () { return ""; },
        };
      }
    }
  } catch (_) {
    // Ignore — if window is truly undefined, nothing can be done.
  }
})();