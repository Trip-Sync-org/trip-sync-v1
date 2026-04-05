import { API_BASE_URL } from "../config";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${p}`;
}

/** True for fetch AbortError / user abort — often benign if the server already processed the request. */
export function isAbortLikeError(e: unknown): boolean {
  if (e == null) return false;
  if (typeof e === "object") {
    const name = (e as { name?: string }).name;
    if (name === "AbortError") return true;
  }
  try {
    if (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") {
      return true;
    }
  } catch {
    /* DOMException may not exist in some RN runtimes */
  }
  const msg = e instanceof Error ? e.message : String(e);
  return /\b(abort|canceled|cancelled)\b/i.test(msg);
}

export type ApiFetchOptions = RequestInit & {
  /** When true, do not attach the client-side timeout AbortController (avoids spurious aborts on slow responses). */
  skipApiTimeout?: boolean;
};

const API_FETCH_TIMEOUT_MS = 30000;

export async function readApiErrorMessage(res: Response): Promise<string> {
  try {
    const text = (await res.clone().text()).trim();
    if (text.startsWith("{")) {
      const j = JSON.parse(text) as {
        error?: unknown;
        details?: unknown;
        hint?: unknown;
      };
      const parts = [j.error, j.details, j.hint].filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      );
      if (parts.length) return parts.join(" — ");
    }
    if (text.length > 0 && text.length < 500) return text.slice(0, 300);
  } catch {
    /* ignore */
  }
  return `Request failed (HTTP ${res.status})`;
}

export async function apiFetch(path: string, init?: ApiFetchOptions): Promise<Response> {
  const skipApiTimeout = init?.skipApiTimeout === true;
  const { skipApiTimeout: _skip, ...restInit } = init ?? {};
  const url = apiUrl(path);
  const useInternalAbort = !restInit.signal && !skipApiTimeout;
  const controller = useInternalAbort ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), API_FETCH_TIMEOUT_MS) : null;
  try {
    return await fetch(url, {
      ...restInit,
      signal: restInit.signal ?? controller?.signal,
      headers: {
        "Content-Type": "application/json",
        ...(restInit.headers ?? {}),
      },
    });
  } catch (e: unknown) {
    if (isAbortLikeError(e)) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    const msg = e instanceof Error ? e.message : String(e);
    const isNetwork =
      msg === "Network request failed" ||
      msg.includes("Failed to fetch") ||
      msg.includes("NetworkError");
    if (isNetwork) {
      throw new Error(
        [
          "Cannot reach the API server.",
          `Trying: ${API_BASE_URL}`,
          "On a real phone, set EXPO_PUBLIC_API_URL in mobile/.env to http://<YOUR_PC_LAN_IP>:3000 (not localhost). PC and phone must be on the same Wi‑Fi. Run npm run dev at the repo root.",
        ].join(" "),
      );
    }
    throw e;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
