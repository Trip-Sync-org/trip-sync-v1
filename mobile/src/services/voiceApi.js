/**
 * Voice REST — AsyncStorage token + EXPO_PUBLIC_API_URL
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "../config";

const AUTH_KEY = "voiceAuthToken";

export async function setVoiceAuthToken(userId, displayName, role, tripId) {
  const r = String(role || "member")
    .toLowerCase()
    .replace(/-/g, "_");
  const payload = {
    userId: String(userId),
    displayName: displayName || String(userId),
    role: r === "admin" ? "organizer" : r,
    tripId: String(tripId),
  };
  const token = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  await AsyncStorage.setItem(AUTH_KEY, token);
}

async function authHeaders() {
  const t = await AsyncStorage.getItem(AUTH_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function fetchIceServers() {
  const url = `${API_BASE_URL.replace(/\/$/, "")}/api/signal/ice`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ICE ${res.status}`);
  return res.json();
}

async function postVoice(path, body) {
  const url = `${API_BASE_URL.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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
