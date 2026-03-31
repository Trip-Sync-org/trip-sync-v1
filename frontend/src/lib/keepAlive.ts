const DEFAULT_INTERVAL_MS = 9 * 60 * 1000;

/**
 * Keeps backend warm for non-serverless hosts that may sleep.
 * No-op unless VITE_ENABLE_KEEPALIVE=true and VITE_BACKEND_URL is set.
 */
export function startBackendKeepAlive(): void {
  if (typeof window === "undefined") return;
  if (import.meta.env.VITE_ENABLE_KEEPALIVE !== "true") return;

  const rawBase = String(import.meta.env.VITE_BACKEND_URL || "").trim();
  if (!rawBase) return;
  const base = rawBase.replace(/\/$/, "");
  const url = `${base}/api/health`;

  const ping = async () => {
    try {
      await fetch(url, {
        method: "GET",
        mode: "cors",
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

