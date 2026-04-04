/**
 * Voice REST API — uses same stub Bearer token as backend/lib/permissions (base64 JSON).
 */

const apiBase = () =>
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") || "";

function authHeaders() {
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem("voiceAuthToken") : null;
  if (raw) return { Authorization: `Bearer ${raw}` };
  return {};
}

/** Build token: { userId, displayName, role, tripId } — role uses backend names (co_admin not co-admin). */
export function setVoiceAuthToken(userId, displayName, role, tripId) {
  const r = String(role || "member")
    .toLowerCase()
    .replace(/-/g, "_");
  const payload = {
    userId: String(userId),
    displayName: displayName || String(userId),
    role: r === "admin" ? "organizer" : r,
    tripId: String(tripId),
  };
  const token = btoa(JSON.stringify(payload));
  if (typeof localStorage !== "undefined") localStorage.setItem("voiceAuthToken", token);
}

export async function fetchIceServers() {
  const base = apiBase();
  const url = base ? `${base}/api/signal/ice` : "/api/signal/ice";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ICE ${res.status}`);
  return res.json();
}

async function postVoice(path, body) {
  const base = apiBase();
  const url = base ? `${base}${path}` : path;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

export function muteParticipant(targetUserId, mute) {
  return postVoice("/api/voice/mute", { targetUserId: String(targetUserId), mute: Boolean(mute) });
}

export function kickParticipant(targetUserId, block = false) {
  return postVoice("/api/voice/kick", { targetUserId: String(targetUserId), block: Boolean(block) });
}

export function assignRole(targetUserId, newRole) {
  return postVoice("/api/voice/role", { targetUserId: String(targetUserId), newRole });
}

export function switchMode(mode) {
  return postVoice("/api/voice/mode", { mode: mode === "staff" ? "staff" : "all" });
}
