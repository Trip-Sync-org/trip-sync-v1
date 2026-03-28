import { API_BASE_URL } from "../config";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${p}`;
}

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

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(path);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e: unknown) {
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
  }
}
