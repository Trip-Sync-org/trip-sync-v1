const DEFAULT_INTERVAL_MS = 9 * 60 * 1000;

/**
 * Keeps backend warm for non-serverless hosts that may sleep.
 * No-op unless VITE_ENABLE_KEEPALIVE=true.
 * Uses same-origin `/api/health` so frontend rewrites can proxy to backend.
 */
export function startBackendKeepAlive(): void {
  if (typeof window === "undefined") return;
  if (import.meta.env.VITE_ENABLE_KEEPALIVE !== "true") return;

  const url = "/api/health";

  const ping = async () => {
    try {
      await fetch(url, {
        method: "GET",
        cache: "no-store",
      });
    } catch {
      // silent by design
    }
  };

  void ping();
  window.setInterval(() => {
    if (document.visibilityState === "visible") {
      void ping();
    }
  }, DEFAULT_INTERVAL_MS);
}

