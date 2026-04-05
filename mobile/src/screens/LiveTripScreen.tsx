import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import type { SupabaseClient } from "@supabase/supabase-js";
import { io, type Socket } from "socket.io-client";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { API_BASE_URL } from "../config";
import { apiFetch, isAbortLikeError, readApiErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { normalizeTripFromApi, type Trip } from "../lib/tripNormalize";
import { fetchWeatherNow, type WeatherNow } from "../lib/weather";
import { useAppTheme } from "../context/ThemeContext";
import { colors } from "../theme";
import { LiveMapView, type LiveMapViewRef, type MapMember, type MapPoint, type UserGeo } from "../components/LiveMapView";
import {
  formatDistance,
  haversineDistance,
} from "../lib/checkpointUtils";
import { supabase } from "../lib/supabase";
import { useConvoyVoice } from "../hooks/useConvoyVoice";
import { useWaitingRoomVoice } from "../voice/useWaitingRoomVoice";

type Props = NativeStackScreenProps<RootStackParamList, "LiveTrip">;

type MemberRole = "organizer" | "admin" | "co-admin" | "moderator" | "member";
type MemberStatus = "arrived" | "on-way" | "absent";

export type LiveMember = {
  id: string;
  userId?: number;
  name: string;
  avatar: string;
  status: MemberStatus;
  role: MemberRole;
  muted: boolean;
  blocked: boolean;
  speed: number;
  distanceCovered: number;
  checkpoints: number;
  xpGained: number;
  lat: number;
  lng: number;
  /** ISO time of last known GPS (API / socket) */
  locationUpdatedAt?: string | null;
};

type Checkpoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  reached: boolean;
  badge: string;
  xp: number;
  /** Server ordering (trip_checkpoints.order_index) — tiebreaker when distances tie */
  order_index?: number;
  /** Per-device distance from local GPS (meters), recalculated client-side */
  clientDistanceM?: number;
  /** True when very close (<50m) and not yet genuinely passed — "you are here" */
  clientIsCurrent?: boolean;
  source?: string;
  description?: string | null;
};

type MapPin = {
  id: string;
  type: string;
  lat: number;
  lng: number;
  label: string;
  addedBy: string;
};

const R_EARTH_KM = 6371;

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatElapsedStrava(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function roleBadgeStyle(role: MemberRole) {
  switch (role) {
    case "admin":
    case "organizer":
      return { color: "#fbbf24", borderColor: "rgba(251,191,36,0.35)", bg: "rgba(251,191,36,0.12)" };
    case "co-admin":
      return { color: "#60a5fa", borderColor: "rgba(96,165,250,0.35)", bg: "rgba(96,165,250,0.12)" };
    case "moderator":
      return { color: "#c084fc", borderColor: "rgba(192,132,252,0.35)", bg: "rgba(192,132,252,0.12)" };
    default:
      return { color: "rgba(255,255,255,0.45)", borderColor: "rgba(255,255,255,0.12)", bg: "rgba(255,255,255,0.06)" };
  }
}

function normalizeRole(role: unknown): MemberRole {
  const r = String(role ?? "").toLowerCase();
  if (r === "admin") return "organizer";
  if (r === "organizer" || r === "co-admin" || r === "moderator" || r === "member") {
    return r;
  }
  return "member";
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasValidMapCoords(m: LiveMember): boolean {
  const lat = toNum(m.lat);
  const lng = toNum(m.lng);
  return lat != null && lng != null && (Math.abs(lat) > 1e-5 || Math.abs(lng) > 1e-5);
}

/** For merge: prefer socket/real-time row when its fix is newer than REST (avoids stale DB overwriting live pins). */
function locationUpdatedAtMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Same DB user can appear twice (REST 0,0 + socket row). Dedupe by user id, keeping the row
 * with a real GPS fix; if both have fixes, keep the newer locationUpdatedAt.
 */
function dedupeMembersForMapPins(rows: LiveMember[]): LiveMember[] {
  const byUid = new Map<number, LiveMember>();
  const noUid: LiveMember[] = [];
  for (const m of rows) {
    const u = memberUserId(m);
    if (!Number.isFinite(u)) {
      noUid.push(m);
      continue;
    }
    const prev = byUid.get(u);
    if (!prev) {
      byUid.set(u, m);
      continue;
    }
    const prevOk = hasValidMapCoords(prev);
    const curOk = hasValidMapCoords(m);
    if (curOk && !prevOk) {
      byUid.set(u, m);
      continue;
    }
    if (!curOk && prevOk) continue;
    const tp = prev.locationUpdatedAt ? Date.parse(prev.locationUpdatedAt) : 0;
    const tc = m.locationUpdatedAt ? Date.parse(m.locationUpdatedAt) : 0;
    if (tc >= tp) byUid.set(u, m);
  }
  return [...byUid.values(), ...noUid];
}

/** Decode ImagePicker `base64` field for Supabase upload (RN `fetch(uri).blob()` often fails on gallery URIs). */
function uint8ArrayFromBase64(b64: string): Uint8Array {
  const raw = (b64.includes(",") ? (b64.split(",").pop() ?? b64) : b64).trim();
  const bin = globalThis.atob(raw);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function uploadAttractionImagesToStorage(
  client: SupabaseClient,
  tripIdNum: number,
  assets: ImagePicker.ImagePickerAsset[],
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < Math.min(5, assets.length); i++) {
    const asset = assets[i];
    const extGuess =
      asset.fileName?.split(".").pop()?.toLowerCase() ||
      asset.uri.split(".").pop()?.split("?")[0]?.toLowerCase() ||
      "jpg";
    const safeExt = ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extGuess) ? extGuess : "jpg";
    const filePath = `attractions/attr-${tripIdNum}-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 10)}.${safeExt}`;
    const contentType =
      asset.mimeType ||
      (safeExt === "png" ? "image/png" : safeExt === "webp" ? "image/webp" : "image/jpeg");

    try {
      let uploadBody: Blob | Uint8Array;
      if (asset.base64 && asset.base64.length > 0) {
        uploadBody = uint8ArrayFromBase64(asset.base64);
        if (__DEV__) console.log("[attraction] upload", i, "via base64", filePath);
      } else {
        if (__DEV__) console.log("[attraction] upload", i, "via fetch", asset.uri?.slice(0, 48));
        const imgRes = await fetch(asset.uri);
        if (!imgRes.ok) continue;
        uploadBody = await imgRes.blob();
      }

      const { data, error } = await client.storage.from("attraction-images").upload(filePath, uploadBody, {
        contentType,
        upsert: false,
      });

      if (__DEV__) console.log("[attraction] upload result:", { path: data?.path, error: error?.message });

      if (error) {
        console.warn("[attraction] storage upload failed:", error.message);
        continue;
      }
      if (data?.path) {
        const { data: pub } = client.storage.from("attraction-images").getPublicUrl(data.path);
        if (pub?.publicUrl) {
          urls.push(pub.publicUrl);
          if (__DEV__) console.log("[attraction] public URL:", pub.publicUrl);
        }
      }
    } catch (e) {
      console.warn("[attraction] upload error:", e);
    }
  }
  return urls;
}

/** Public.users id for API + Socket.IO (`user.id` is string; must never be NaN or live-state/rooms break). */
function appUserNumericId(user: { id: string } | null | undefined): number | null {
  if (!user?.id) return null;
  const s = String(user.id).trim();
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const m = s.match(/^m(\d+)$/i);
  if (m) return Number(m[1]);
  return null;
}

/** REST poll for peer positions (Socket still pushes in parallel). */
const LIVE_STATE_POLL_MS = 350;
const LOCATION_HTTP_POST_MIN_MS = 750;
/** Low-pass filter for map position — reduces GPS jitter without large lag. */
const GPS_SMOOTH_ALPHA = 0.32;

/** Same as older builds: parse `m{userId}` (socket rows include userId). */
function memberUserId(m: LiveMember): number {
  if (m.userId != null && Number.isFinite(Number(m.userId))) return Number(m.userId);
  return Number(String(m.id).replace(/^m/, ""));
}

/**
 * Whether this live-state row is the signed-in user. String `m.id !== localMemberId` alone fails when
 * the API sends numeric ids or the row only has `userId` — then “self” appears as a green peer on the blue dot.
 */
/** One row per DB user id — fixes duplicate list entries when `id` mixes `4` vs `m4`. */
function canonicalMemberIdStr(m: LiveMember): string {
  const u = memberUserId(m);
  return Number.isFinite(u) ? `m${u}` : String(m.id);
}

function liveMemberRowIsSelf(m: LiveMember, selfUid: number | null, localMid: string | null): boolean {
  if (selfUid != null) {
    const row = memberUserId(m);
    if (Number.isFinite(row) && row === selfUid) return true;
  }
  if (localMid != null) {
    if (m.id === localMid || String(m.id) === localMid) return true;
    const digits = String(m.id).replace(/^m/i, "");
    if (selfUid != null && digits === String(selfUid)) return true;
  }
  return false;
}

/** When peers are within ~45m of you, HTML markers stack — fan out slightly so every initials badge stays visible. */
function spreadPeersForMap(peers: MapMember[], self: { lat: number; lng: number } | null): MapMember[] {
  if (!self || peers.length === 0) return peers;
  return peers.map((m, i) => {
    const dKm = haversineKm(self, { lat: m.lat, lng: m.lng });
    if (dKm > 0.045) return m;
    const ring = Math.floor(i / 8);
    const slot = i % 8;
    const ang = slot * (Math.PI / 4) + i * 0.12;
    const meters = 16 + ring * 14;
    const latRad = (m.lat * Math.PI) / 180;
    const dLat = (meters / 111_320) * Math.cos(ang);
    const dLng = (meters / (111_320 * Math.max(0.2, Math.cos(latRad)))) * Math.sin(ang);
    return { ...m, lat: m.lat + dLat, lng: m.lng + dLng };
  });
}

/**
 * Merge REST live-state without wiping voice UI or real-time positions.
 * (Restored simpler merge from when peer pins were reliable: always keep `extra` socket-only rows.)
 */
function mergeLiveMembersFromApi(prev: LiveMember[], incoming: LiveMember[]): LiveMember[] {
  const prevById = new Map(prev.map((m) => [canonicalMemberIdStr(m), m]));
  const incomingIds = new Set(incoming.map((m) => canonicalMemberIdStr(m)));

  const merged = incoming.map((inc) => {
    const old = prevById.get(canonicalMemberIdStr(inc));
    const incLatN = toNum(inc.lat);
    const incLngN = toNum(inc.lng);
    let lat = incLatN ?? 0;
    let lng = incLngN ?? 0;
    let speed = inc.speed;

    const incMissing =
      incLatN == null ||
      incLngN == null ||
      (Math.abs(incLatN) <= 1e-5 && Math.abs(incLngN) <= 1e-5);
    const oldLat = old ? toNum(old.lat) : null;
    const oldLng = old ? toNum(old.lng) : null;
    const oldHasFix =
      old &&
      oldLat != null &&
      oldLng != null &&
      (Math.abs(oldLat) > 1e-5 || Math.abs(oldLng) > 1e-5);

    let locationUpdatedAt: string | null | undefined =
      inc.locationUpdatedAt ?? old?.locationUpdatedAt ?? undefined;
    if (inc.locationUpdatedAt && old?.locationUpdatedAt) {
      const ti = Date.parse(inc.locationUpdatedAt);
      const to = Date.parse(old.locationUpdatedAt);
      if (Number.isFinite(ti) && Number.isFinite(to)) {
        locationUpdatedAt = ti >= to ? inc.locationUpdatedAt : old.locationUpdatedAt;
      }
    }

    const prevMs = locationUpdatedAtMs(old?.locationUpdatedAt);
    const incMs = locationUpdatedAtMs(inc.locationUpdatedAt);
    const keepPrevPosition =
      old &&
      oldHasFix &&
      (incMissing || prevMs > incMs);

    if (keepPrevPosition) {
      lat = oldLat!;
      lng = oldLng!;
      speed = old.speed;
      locationUpdatedAt = old.locationUpdatedAt ?? locationUpdatedAt;
    }

    const rowForId: LiveMember = {
      ...inc,
      lat,
      lng,
      speed,
      locationUpdatedAt: locationUpdatedAt ?? null,
      role: normalizeRole(inc.role),
      muted: old?.muted ?? inc.muted,
      blocked: old?.blocked ?? inc.blocked,
    };
    const uid = memberUserId(rowForId);
    return {
      ...rowForId,
      id: Number.isFinite(uid) ? `m${uid}` : String(inc.id),
    };
  });

  const extra = prev.filter((m) => !incomingIds.has(canonicalMemberIdStr(m)));
  return extra.length ? [...merged, ...extra] : merged;
}

const SOS_OPTIONS: Array<{ id: string; label: string; icon: string; reason: string }> = [
  { id: "breakdown", label: "Breakdown", icon: "🚓", reason: "Vehicle issue" },
  { id: "medical", label: "Medical", icon: "⚕️", reason: "Medical emergency" },
  { id: "low-fuel", label: "Low fuel", icon: "⛽", reason: "Low fuel" },
  { id: "other", label: "Other", icon: "❓", reason: "Other" },
];

type LiveAlert = {
  id: string;
  kind: string;
  title: string;
  message: string;
  actorName: string;
  actorUserId: number | null;
  atIso: string;
  dismissible: boolean;
};

type AlertApiRow = {
  id?: string | number;
  kind?: string;
  user_id?: number | null;
  actor_name?: string;
  created_at?: string;
  reason?: string | null;
  details?: string | null;
};

type MapPinRequestSocketPayload = {
  pinId: string;
  requestedBy: { userId: number; displayName: string };
  lat: number;
  lng: number;
  reason: string;
  label: string;
  tripId: number;
};

/** Distinct pin colors so riders read like a racing grid. */
const RIDER_PIN_COLORS = ["#22c55e", "#3b82f6", "#dc2626", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#ef4444"];

type DrivingRoutePayload = {
  coordinates: { latitude: number; longitude: number }[];
  start: { lat: number; lng: number } | null;
  end: { lat: number; lng: number } | null;
  distanceMeters?: number | null;
  durationSeconds?: number | null;
  message?: string;
};

export function LiveTripScreen({ route, navigation }: Props) {
  const { id } = route.params;
  /** Expo Go cannot load native WebRTC — show a short hint instead of a scary error. */
  const isExpoGo = Constants.appOwnership === "expo";
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { mode, toggleMode } = useAppTheme();

  const [phase, setPhase] = useState<"waiting" | "live">("waiting");
  const [pausedFromLive, setPausedFromLive] = useState(false);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [tripLoading, setTripLoading] = useState(true);
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessDenied, setAccessDenied] = useState("");
  const [members, setMembers] = useState<LiveMember[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [mapPins, setMapPins] = useState<MapPin[]>([]);
  const [drivingRoute, setDrivingRoute] = useState<DrivingRoutePayload | null>(null);

  const [attendanceTab, setAttendanceTab] = useState<"all" | "arrived" | "pending">("all");

  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [endingTrip, setEndingTrip] = useState(false);
  const [tripStarted, setTripStarted] = useState(false);
  const [posTick, setPosTick] = useState(0);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(0);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [mapDiag, setMapDiag] = useState<string | null>(null);
  const [showSosModal, setShowSosModal] = useState(false);
  const [sosOtherReason, setSosOtherReason] = useState("");
  const [showPinModal, setShowPinModal] = useState(false);
  const [mapPinCrosshair, setMapPinCrosshair] = useState(false);
  const [showMapPinRequestModal, setShowMapPinRequestModal] = useState(false);
  const [mapPinReason, setMapPinReason] = useState("");
  const [pinType, setPinType] = useState<"parking" | "fuel" | "attraction" | "hazard" | "road-damage">("parking");
  const [pinLabel, setPinLabel] = useState("");
  const [showAttractionModal, setShowAttractionModal] = useState(false);
  const [attrName, setAttrName] = useState("");
  const [attrDesc, setAttrDesc] = useState("");
  const [attrImages, setAttrImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [attrSaving, setAttrSaving] = useState(false);
  const [sheetDragging, setSheetDragging] = useState(false);
  const [alertHistory, setAlertHistory] = useState<LiveAlert[]>([]);
  const [activeAlert, setActiveAlert] = useState<LiveAlert | null>(null);
  const [sentAlertPopup, setSentAlertPopup] = useState<LiveAlert | null>(null);
  const [showAlertHistoryModal, setShowAlertHistoryModal] = useState(false);
  const [unreadAlertCount, setUnreadAlertCount] = useState(0);
  const [mapPinLabel, setMapPinLabel] = useState("");
  const [mapPinSubmitting, setMapPinSubmitting] = useState(false);
  const [checkpointSortTick, setCheckpointSortTick] = useState(0);
  const [pinReviewFlash, setPinReviewFlash] = useState<"approve" | "deny" | null>(null);
  const [pinReviewUiLock, setPinReviewUiLock] = useState(false);
  const pinReviewBusyRef = useRef(false);
  const [pendingMemberPins, setPendingMemberPins] = useState<Array<{ id: string; lat: number; lng: number; label: string }>>(
    [],
  );
  const [pinRequestQueue, setPinRequestQueue] = useState<MapPinRequestSocketPayload[]>([]);
  const [transientToast, setTransientToast] = useState<{ message: string; tone: "success" | "warning" | "error" } | null>(
    null,
  );
  const [checkpointsSectionOpen, setCheckpointsSectionOpen] = useState(false);
  const [, setLiveSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  /** Last socket location-updated time per peer — survives socket reconnects (not reset with new io() closure). */
  const lastSeenRef = useRef<Record<number, number>>({});
  const isTripStaffRef = useRef(false);
  const pinRequestQueueRef = useRef<MapPinRequestSocketPayload[]>([]);
  const liveMapRef = useRef<LiveMapViewRef | null>(null);
  const [mapFitTick, setMapFitTick] = useState(0);
  const [mapRecenterPoint, setMapRecenterPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [userGeo, setUserGeo] = useState<UserGeo | null>(null);
  const convoyFitDoneRef = useRef(false);
  const initialAutoCenterDoneRef = useRef(false);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  /** Raw device GPS (lat/lng) for checkpoint distance — updated every fix, not smoothed, not from socket. */
  const currentPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  /** Fetched checkpoints + sticky reached; `applyCheckpointSort` writes sorted list + distances to state. */
  const checkpointsRawRef = useRef<Checkpoint[]>([]);
  /** Genuinely passed checkpoint ids: must have been >300m away then <150m (not distance-only). */
  const passedCheckpointIdsRef = useRef<Set<string>>(new Set());
  /** Per checkpoint id: rider has been farther than 300m at least once (enables pass detection). */
  const hasBeenFarRef = useRef<Map<string, boolean>>(new Map());
  /** Smoothed fix for map + broadcasts — updated only when raw fix passes drift gates. */
  const mapSmoothedRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastLocTsRef = useRef<number | null>(null);
  const [myDistanceKm, setMyDistanceKm] = useState(0);
  const sheetHeightAnim = useRef(new Animated.Value(200)).current;
  const sheetScrollYRef = useRef(0);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());
  const lastAlertIsoRef = useRef<string>("");
  /** Throttle REST location posts so convoy works when Socket.IO cannot reach the server. */
  const lastLocationHttpPostRef = useRef<number>(0);
  /** Dev: throttle console logs for outgoing GPS so the terminal stays readable. */
  const lastEmitLocationLogRef = useRef<number>(0);

  const tripIdNum = Number(id);
  const tripIdRef = useRef(tripIdNum);
  useEffect(() => {
    tripIdRef.current = tripIdNum;
  }, [tripIdNum]);
  const appUid = appUserNumericId(user);
  const localMemberId = appUid != null ? `m${appUid}` : null;
  const localMember =
    localMemberId != null ? members.find((m) => m.id === localMemberId) ?? null : null;
  const localRole = localMember?.role ?? "member";
  const canModerateVoice =
    localRole === "organizer" ||
    localRole === "admin" ||
    localRole === "co-admin" ||
    localRole === "moderator" ||
    user?.role === "organizer";
  const canSendLineupFormation =
    localRole === "organizer" ||
    localRole === "co-admin" ||
    localRole === "moderator" ||
    user?.role === "organizer";
  const canSaveNearbyAttraction = canSendLineupFormation;
  useEffect(() => {
    isTripStaffRef.current = canSendLineupFormation;
  }, [canSendLineupFormation]);
  useEffect(() => {
    pinRequestQueueRef.current = pinRequestQueue;
  }, [pinRequestQueue]);
  useEffect(() => {
    if (!transientToast) return;
    const t = setTimeout(() => setTransientToast(null), 3200);
    return () => clearTimeout(t);
  }, [transientToast]);
  const prevMapPinModalOpenRef = useRef(false);
  useEffect(() => {
    if (showMapPinRequestModal && !prevMapPinModalOpenRef.current) {
      setMapPinSubmitting(false);
    }
    prevMapPinModalOpenRef.current = showMapPinRequestModal;
  }, [showMapPinRequestModal]);
  const isOrganizer =
    user?.role === "organizer" || localRole === "organizer" || localRole === "admin";
  const localMuted = localMember?.muted ?? true;
  const {
    voiceMode,
    setVoiceMode,
    videoCallActive,
    joinVoice: broadcastJoinVoice,
    leaveVoice: broadcastLeaveVoice,
    speakRequests,
    approvedSpeakers,
    requestToSpeak: emitSpeakRequest,
    allowSpeaker,
    denySpeaker,
  } = useWaitingRoomVoice({
    tripId: String(id),
    enabled: phase === "waiting",
    localMemberId,
    canModerateVoice,
  });

  const localAllowedInControlled =
    voiceMode !== "controlled" ||
    canModerateVoice ||
    (localMemberId != null && approvedSpeakers.includes(localMemberId));

  const blockedIds = useMemo(
    () =>
      members
        .filter((m) => m.blocked && m.userId != null && Number.isFinite(Number(m.userId)))
        .map((m) => Number(m.userId)),
    [members],
  );

  const canSpeakConvoy =
    voiceMode === "open" ||
    localRole === "organizer" ||
    localRole === "admin" ||
    localRole === "co-admin" ||
    localRole === "moderator" ||
    (localMemberId != null && approvedSpeakers.includes(localMemberId));

  const onVoiceMemberMuteChange = useCallback((userId: number, muted: boolean) => {
    setMembers((prev) =>
      prev.map((m) => (Number(m.userId) === userId ? { ...m, muted } : m)),
    );
  }, []);

  const {
    isInVoice,
    isConnecting: voiceConnecting,
    voiceRiders,
    joinVoice: joinConvoyVoice,
    leaveVoice: leaveConvoyVoice,
    toggleMute: toggleConvoyMute,
    setMuted: setConvoyMuted,
    setBlocked: setConvoyBlocked,
    muteRemoteRider,
  } = useConvoyVoice({
    socketRef,
    tripId: tripIdNum,
    myUserId: Number(user?.id ?? 0),
    voiceMode,
    canSpeak: canSpeakConvoy,
    isMuted: localMuted,
    blockedIds,
    onMemberMuteChange: onVoiceMemberMuteChange,
  });

  const joinVoiceChannel = useCallback(async () => {
    const ok = await joinConvoyVoice();
    if (ok) await broadcastJoinVoice();
  }, [joinConvoyVoice, broadcastJoinVoice]);

  const leaveVoiceChannel = useCallback(() => {
    leaveConvoyVoice();
    void broadcastLeaveVoice();
  }, [leaveConvoyVoice, broadcastLeaveVoice]);

  useEffect(() => {
    if (phase !== "waiting" && (isInVoice || videoCallActive)) {
      leaveConvoyVoice();
      void broadcastLeaveVoice();
    }
  }, [phase, isInVoice, videoCallActive, leaveConvoyVoice, broadcastLeaveVoice]);

  useEffect(() => {
    if (!isInVoice) return;
    setConvoyMuted(localMuted);
  }, [isInVoice, localMuted, setConvoyMuted]);

  const requestToSpeak = () => {
    void emitSpeakRequest();
    if (!localMemberId) return;
    setMembers((prev) => prev.map((m) => (m.id === localMemberId ? { ...m, muted: true } : m)));
  };

  const nameByUserId = useCallback(
    (uid: number | null | undefined) => {
      if (uid == null) return "A member";
      const m = members.find((x) => x.userId === uid || Number(String(x.id).replace("m", "")) === uid);
      if (m?.name) return m.name;
      if (user?.id != null && Number(user.id) === uid) return user.name || "You";
      return `User ${uid}`;
    },
    [members, user?.id, user?.name],
  );

  const pushIncomingAlert = useCallback(
    (payload: { id?: string; kind?: string; userId?: number | null; actorName?: string; at?: string; reason?: string; details?: string }) => {
      const kind = String(payload.kind ?? "");
      if (!kind) return;
      const actorUserId = payload.userId ?? null;
      const actorName = payload.actorName?.trim() || nameByUserId(actorUserId);
      const atIso = payload.at && payload.at.length > 0 ? payload.at : new Date().toISOString();
      const extra = payload.details?.trim() || payload.reason?.trim() || "";
      let title = "Convoy alert";
      let message = `${actorName} sent an alert.`;
      if (kind === "regroup-ping") {
        title = "Regroup Ping";
        message = `${actorName} requested everyone to regroup at the meetup corridor.`;
      } else if (kind === "line-up-formation") {
        title = "Line-up Formation";
        message = `${actorName} asked riders to line up and match pace.`;
      } else if (kind.startsWith("sos")) {
        const reason = kind.includes(":") ? kind.split(":").slice(1).join(":") : "SOS";
        title = "SOS Alert";
        message = `${actorName} raised SOS: ${reason}${extra ? ` (${extra})` : ""}.`;
      } else if (kind === "map-pin-added") {
        title = "Map Pin Added";
        message = `${actorName} added a map pin${extra ? `: ${extra}` : ""}.`;
      } else if (kind === "trip-started") {
        title = "Trip Started";
        message = `${actorName} started the trip.`;
      } else {
        title = "Convoy Alert";
        message = `${actorName}: ${kind}${extra ? ` (${extra})` : ""}`;
      }
      const next: LiveAlert = {
        id: payload.id && payload.id.trim().length > 0 ? payload.id : `${atIso}-${kind}-${actorUserId ?? "na"}`,
        kind,
        title,
        message,
        actorName,
        actorUserId,
        atIso,
        dismissible: true,
      };
      setAlertHistory((prev) => [next, ...prev].slice(0, 100));
      setActiveAlert(next);
      setUnreadAlertCount((n) => n + 1);
    },
    [nameByUserId],
  );

  const phaseRef = useRef(phase);
  const isOrganizerRef = useRef(isOrganizer);
  const pushIncomingAlertRef = useRef(pushIncomingAlert);
  phaseRef.current = phase;
  isOrganizerRef.current = isOrganizer;
  pushIncomingAlertRef.current = pushIncomingAlert;

  const showSentAlertPopup = useCallback(
    (kind: string, details?: string) => {
      const actorName = user?.name || "You";
      let title = "Alert sent";
      let message = "Your alert was sent to all joined members.";
      if (kind.startsWith("sos")) {
        const reason = kind.includes(":") ? kind.split(":").slice(1).join(":") : "SOS";
        title = "SOS sent";
        message = `You sent SOS: ${reason}${details ? ` (${details})` : ""}.`;
      } else if (kind === "regroup-ping") {
        title = "Regroup sent";
        message = "Your regroup ping was sent to all joined members.";
      } else if (kind === "line-up-formation") {
        title = "Formation sent";
        message = "Your line-up formation alert was sent.";
      } else if (kind === "map-pin-added") {
        title = "Map pin alert sent";
        message = `You alerted members about a new map pin${details ? `: ${details}` : ""}.`;
      }
      const now = new Date().toISOString();
      setSentAlertPopup({
        id: `${now}-${kind}-self`,
        kind,
        title,
        message,
        actorName,
        actorUserId: user?.id != null ? Number(user.id) : null,
        atIso: now,
        dismissible: true,
      });
    },
    [user?.id, user?.name],
  );

  const arrivedCount = members.filter((m) => m.status === "arrived").length;
  const totalCount = members.length;

  const bannerSeed = trip?.banner ?? trip?.id ?? "trip";

  useEffect(() => {
    let cancelled = false;
    const watchdog = setTimeout(() => {
      if (!cancelled) setTripLoading(false);
    }, 2500);
    (async () => {
      try {
        setTripLoading(true);
        const res = await apiFetch(`/api/trips/${id}`);
        if (!res.ok) {
          if (!cancelled) setTrip(null);
          return;
        }
        const raw = (await res.json()) as Record<string, unknown>;
        if (!cancelled) {
          const nextTrip = normalizeTripFromApi(raw);
          setTrip(nextTrip);
          const st = String(nextTrip.status ?? "").toLowerCase();
          setTripStarted(st === "live" || st === "active" || st === "started" || st === "ongoing");
        }
      } catch {
        if (!cancelled) setTrip(null);
      } finally {
        if (!cancelled) setTripLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, [id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const watchdog = setTimeout(() => {
      if (!cancelled) setAccessChecking(false);
    }, 2500);
    (async () => {
      try {
        setAccessChecking(true);
        const res = await apiFetch(
          `/api/trips/${id}/live-access?user_id=${encodeURIComponent(user.id)}`,
        );
        const body = (await res.json().catch(() => ({}))) as {
          allowed?: boolean;
          error?: string;
          trip_started?: boolean;
          can_start?: boolean;
        };
        if (!res.ok || body.allowed !== true) {
          if (!cancelled) setAccessDenied(body.error || "You do not have permission to access this trip live room.");
          return;
        }
        if (!cancelled) {
          setAccessDenied("");
          if (typeof body.trip_started === "boolean") setTripStarted(body.trip_started);
        }
      } catch {
        if (!cancelled) setAccessDenied("Could not validate live access right now.");
      } finally {
        if (!cancelled) setAccessChecking(false);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, [id, user?.id]);

  // Waiting-room live gate sync: non-organizers auto-unlock when organizer starts.
  useEffect(() => {
    if (!user?.id || accessDenied || phase !== "waiting" || isOrganizer) return;
    let cancelled = false;

    const refreshLiveAccess = async () => {
      try {
        const res = await apiFetch(
          `/api/trips/${id}/live-access?user_id=${encodeURIComponent(user.id)}`,
        );
        const body = (await res.json().catch(() => ({}))) as {
          allowed?: boolean;
          trip_started?: boolean;
        };
        if (!cancelled && res.ok && body.allowed === true && typeof body.trip_started === "boolean") {
          setTripStarted(body.trip_started);
        }
      } catch {
        // keep UI stable; next poll will retry
      }
    };

    void refreshLiveAccess();
    const t = setInterval(() => {
      void refreshLiveAccess();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id, user?.id, accessDenied, phase, isOrganizer]);

  const fetchAndMergeLiveState = useCallback(async () => {
    if (!user?.id || accessDenied) return;
    const uid = appUserNumericId(user);
    if (uid == null) {
      setMapDiag((d) => d ?? "Sign out and sign in again — your profile id is missing (convoy sync needs a numeric user id).");
      return;
    }
    try {
      const res = await apiFetch(`/api/trips/${id}/live-state?user_id=${encodeURIComponent(String(uid))}`);
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        members?: LiveMember[];
        checkpoints?: Checkpoint[];
        mapPins?: MapPin[];
      };
      if (!res.ok) {
        if (res.status === 403) {
          setMapDiag(
            (body as { error?: string }).error ||
              "Convoy data blocked — book this trip (same account) or use the organizer account.",
          );
        } else if (res.status === 400) {
          setMapDiag("Convoy sync error — check trip id and try again.");
        }
        return;
      }
      setMapDiag(null);
      if (Array.isArray(body.members) && body.members.length > 0) {
        setMembers((prev) => mergeLiveMembersFromApi(prev, body.members!));
      }
      /* Checkpoints come from GET /api/trips/:id/checkpoints (trip_checkpoints) + socket */
      if (Array.isArray(body.mapPins)) setMapPins(body.mapPins);
    } catch {
      /* keep UI stable */
    }
  }, [id, user?.id, accessDenied]);

  /**
   * Per-device: distance from `currentPositionRef`, approach-then-pass (300m → 150m), "current" (<50m)
   * for new/nearby pins that are not passed yet. Sort: current first, then upcoming by distance, passed last.
   */
  const applyCheckpointSort = useCallback(() => {
    const FAR_M = 300;
    const PASS_M = 150;
    const CURRENT_M = 50;

    const pos = currentPositionRef.current;
    let raw = checkpointsRawRef.current;
    if (!raw.length) {
      setCheckpoints([]);
      setCheckpointSortTick((x) => x + 1);
      return;
    }
    if (!pos) {
      setCheckpoints(
        raw.map((c) => ({ ...c, clientDistanceM: undefined, clientIsCurrent: undefined })),
      );
      setCheckpointSortTick((x) => x + 1);
      return;
    }

    type Row = Checkpoint & {
      _passed: boolean;
      _current: boolean;
      _seq: number;
      clientDistanceM: number;
    };

    const withD: Row[] = raw.map((cp) => {
      const id = String(cp.id);
      const distM = haversineDistance(pos.lat, pos.lng, cp.lat, cp.lng);

      if (!passedCheckpointIdsRef.current.has(id)) {
        if (distM > FAR_M) {
          hasBeenFarRef.current.set(id, true);
        }
        if (hasBeenFarRef.current.get(id) === true && distM < PASS_M) {
          passedCheckpointIdsRef.current.add(id);
        }
      }

      const isPassed = passedCheckpointIdsRef.current.has(id);
      const seq = cp.order_index ?? 0;

      return {
        ...cp,
        reached: isPassed,
        clientDistanceM: distM,
        clientIsCurrent: false,
        _passed: isPassed,
        _current: false,
        _seq: seq,
      };
    });

    const nonPassed = withD.filter((r) => !r._passed);
    const minDist =
      nonPassed.length > 0 ? Math.min(...nonPassed.map((r) => r.clientDistanceM)) : Infinity;
    /** Tie at ~same meters as minDist — only first in list order gets "current". */
    const AT_MIN_EPS_M = 0.5;

    let currentAssigned = false;
    const finalRows: Row[] = withD.map((cp) => {
      if (
        !cp._passed &&
        !currentAssigned &&
        minDist < CURRENT_M &&
        Math.abs(cp.clientDistanceM - minDist) <= AT_MIN_EPS_M
      ) {
        currentAssigned = true;
        return { ...cp, clientIsCurrent: true, _current: true };
      }
      return { ...cp, clientIsCurrent: false, _current: false };
    });

    checkpointsRawRef.current = finalRows.map(({ _passed, _current, _seq, ...cp }) => cp);

    const sorted = [...finalRows].sort((a, b) => {
      if (a._current && !b._current) return -1;
      if (!a._current && b._current) return 1;
      if (a._passed && !b._passed) return 1;
      if (!a._passed && b._passed) return -1;
      if (!a._passed && !b._passed) {
        if (a.clientDistanceM !== b.clientDistanceM) return a.clientDistanceM - b.clientDistanceM;
        return a._seq - b._seq;
      }
      return a._seq - b._seq;
    });

    const clean: Checkpoint[] = sorted.map(({ _passed, _current, _seq, ...cp }) => cp);
    setCheckpoints(clean);
    setCheckpointSortTick((x) => x + 1);
  }, []);

  const applyCheckpointSortRef = useRef(applyCheckpointSort);
  useEffect(() => {
    applyCheckpointSortRef.current = applyCheckpointSort;
  }, [applyCheckpointSort]);

  const mapApiRowToCheckpoint = useCallback((r: Record<string, unknown>, i: number): Checkpoint => {
    const cid = String(r.id ?? i);
    return {
      id: cid,
      name: String(r.name ?? `Stop ${i + 1}`),
      lat: Number(r.latitude ?? r.lat) || 0,
      lng: Number(r.longitude ?? r.lng) || 0,
      reached: passedCheckpointIdsRef.current.has(cid),
      badge: "📍",
      xp: 50,
      order_index: Number(r.order_index ?? i + 1),
      source: r.source != null ? String(r.source) : undefined,
      description: r.description != null ? String(r.description) : null,
    };
  }, []);

  const loadTripCheckpoints = useCallback(async () => {
    if (!user?.id || accessDenied) return;
    const uid = appUserNumericId(user);
    if (uid == null) return;
    try {
      const res = await apiFetch(`/api/trips/${id}/checkpoints?user_id=${encodeURIComponent(String(uid))}`);
      if (!res.ok) return;
      const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows)) return;
      const mapped: Checkpoint[] = rows.map((r, i) => mapApiRowToCheckpoint(r, i));
      checkpointsRawRef.current = mapped;
      applyCheckpointSort();
    } catch {
      /* ignore */
    }
  }, [accessDenied, applyCheckpointSort, id, mapApiRowToCheckpoint, user]);

  const loadTripCheckpointsRef = useRef(loadTripCheckpoints);
  loadTripCheckpointsRef.current = loadTripCheckpoints;

  useEffect(() => {
    if (!user?.id || accessDenied) return;
    void loadTripCheckpoints();
  }, [accessDenied, loadTripCheckpoints, user?.id]);

  useEffect(() => {
    checkpointsRawRef.current = [];
    currentPositionRef.current = null;
    passedCheckpointIdsRef.current = new Set();
    hasBeenFarRef.current = new Map();
    setCheckpoints([]);
  }, [id]);

  /** Fallback if a socket event is missed (brief disconnect / background). */
  useEffect(() => {
    if (!user?.id || accessDenied || phase !== "live") return;
    const uid = appUserNumericId(user);
    if (uid == null) return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await apiFetch(
          `/api/trips/${tripIdRef.current}/checkpoints?user_id=${encodeURIComponent(String(uid))}`,
        );
        if (!res.ok) return;
        const rows = (await res.json().catch(() => [])) as unknown;
        if (!Array.isArray(rows)) return;
        if (rows.length !== checkpointsRawRef.current.length) {
          await loadTripCheckpointsRef.current();
        }
      } catch {
        /* silent — socket is primary */
      }
    }, 30000);
    return () => clearInterval(pollInterval);
  }, [accessDenied, phase, user?.id]);

  useEffect(() => {
    if (!user?.id || accessDenied) return;
    const uid = appUserNumericId(user);
    if (uid == null) return;
    const sub = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      try {
        const res = await apiFetch(
          `/api/trips/${tripIdRef.current}/checkpoints?user_id=${encodeURIComponent(String(uid))}`,
        );
        if (!res.ok) return;
        const rows = (await res.json().catch(() => [])) as unknown;
        if (!Array.isArray(rows)) return;
        if (rows.length !== checkpointsRawRef.current.length) {
          await loadTripCheckpointsRef.current();
        }
      } catch {
        /* silent */
      }
    });
    return () => sub.remove();
  }, [accessDenied, user?.id]);

  const fetchLiveStateRef = useRef(fetchAndMergeLiveState);
  fetchLiveStateRef.current = fetchAndMergeLiveState;

  useEffect(() => {
    if (!user?.id || accessDenied) return;
    void fetchAndMergeLiveState();
  }, [accessDenied, fetchAndMergeLiveState, user?.id]);

  // While convoy is live, poll REST (Socket also pushes; presence events remove ghosts instantly).
  useEffect(() => {
    if (!user?.id || accessDenied || phase !== "live") return;
    void fetchAndMergeLiveState();
    const t = setInterval(() => void fetchAndMergeLiveState(), LIVE_STATE_POLL_MS);
    return () => clearInterval(t);
  }, [accessDenied, fetchAndMergeLiveState, phase, user?.id]);

  useEffect(() => {
    if (!isInVoice) return;
    setMembers((prev) =>
      prev.map((m) => {
        const isStaff =
          m.role === "organizer" || m.role === "co-admin" || m.role === "moderator";
        if (voiceMode === "controlled") {
          return isStaff ? { ...m, muted: false } : { ...m, muted: true };
        }
        return { ...m, muted: false };
      }),
    );
  }, [voiceMode, isInVoice]);

  useEffect(() => {
    if (!user?.id || accessDenied) return;

    const selfUid = appUserNumericId(user);

    const socket = io(API_BASE_URL, {
      transports: ["polling", "websocket"],
      path: "/socket.io/",
      reconnection: true,
      reconnectionAttempts: 999,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      upgrade: true,
    });
    socketRef.current = socket;
    setLiveSocket(socket);

    const emitLastKnownPosition = () => {
      const pos = lastPosRef.current;
      const uid = appUserNumericId(user);
      if (!pos || uid == null) return;
      socket.emit("update-location", {
        tripId: tripIdNum,
        userId: uid,
        lat: pos.lat,
        lng: pos.lng,
        speed: null,
        heading: null,
      });
    };

    const joinAndAnnounce = () => {
      setMapDiag((d) => (d?.includes("Live socket") ? null : d));
      socket.emit("join-trip", tripIdNum);
      const uid = appUserNumericId(user);
      if (uid != null) {
        const roleForSocket = (() => {
          const r = String(localRole || "member").toLowerCase();
          if (r === "co-admin") return "co_admin";
          if (r === "admin" || r === "organizer") return "organizer";
          if (r === "moderator") return "moderator";
          return "member";
        })();
        socket.emit("identify", { userId: uid, tripId: tripIdNum, role: roleForSocket });
      }
      setTimeout(() => {
        socket.emit("request-positions", {
          tripId: tripIdNum,
          userId: uid ?? Number(user.id),
        });
      }, 500);
      setTimeout(() => {
        emitLastKnownPosition();
      }, 800);
      void fetchLiveStateRef.current();
      if (__DEV__) console.log("[socket] joined + announced, tripId:", tripIdNum);
    };

    const onConnectErr = (err: Error) => {
      setMapDiag(
        `Live socket: ${err.message || "cannot connect"}. Same Wi‑Fi/LAN as the API? EXPO_PUBLIC_API_URL must be http://<PC-IP>:3000 not localhost.`,
      );
      if (__DEV__) console.log("[socket] connect error:", err.message);
    };

    const onTripMemberPresence = (payload: { userId?: number; online?: boolean }) => {
      const uid = Number(payload?.userId);
      if (!Number.isFinite(uid)) return;
      if (selfUid != null && uid === selfUid) return;
      void fetchLiveStateRef.current();
    };

    const onBroadcastPositionNow = (_payload?: unknown) => {
      emitLastKnownPosition();
    };

    const onRiderLeft = (payload: { userId?: number }) => {
      const uid = Number(payload?.userId);
      if (!Number.isFinite(uid)) return;
      if (selfUid != null && uid === selfUid) return;
      delete lastSeenRef.current[uid];
      const memberId = `m${uid}`;
      if (__DEV__) console.log("[convoy] rider left:", uid);
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId ? { ...m, lat: 0, lng: 0, status: "absent" as const } : m,
        ),
      );
    };

    const onLocationUpdated = (payload: {
      userId: number;
      lat: number;
      lng: number;
      speed?: number | null;
      heading?: number | null;
      ts?: number;
    }) => {
      const puid = Number(payload.userId);
      if (selfUid != null && puid === selfUid) return;
      const plat = toNum(payload.lat);
      const plng = toNum(payload.lng);
      if (!Number.isFinite(puid) || plat == null || plng == null) return;
      if (Math.abs(plat) <= 1e-5 && Math.abs(plng) <= 1e-5) return;

      lastSeenRef.current[puid] = Date.now();
      if (__DEV__) {
        console.log("📍 location-updated:", puid, plat, plng);
      }

      const kmh =
        payload.speed != null && Number.isFinite(Number(payload.speed))
          ? Number((Number(payload.speed) * 3.6).toFixed(1))
          : undefined;

      setMembers((prev) => {
        const targetKey = `m${puid}`;
        const idx = prev.findIndex(
          (m) => canonicalMemberIdStr(m) === targetKey || memberUserId(m) === puid,
        );
        if (idx >= 0) {
          const cur = prev[idx];
          if (
            Math.abs(cur.lat - plat) < 0.000005 &&
            Math.abs(cur.lng - plng) < 0.000005 &&
            cur.status !== "absent"
          ) {
            return prev;
          }
          const next = [...prev];
          next[idx] = {
            ...cur,
            id: targetKey,
            userId: puid,
            lat: plat,
            lng: plng,
            locationUpdatedAt: new Date().toISOString(),
            status: cur.status === "absent" ? "on-way" : cur.status,
            ...(kmh != null ? { speed: kmh } : {}),
          };
          return next;
        }
        return [
          ...prev,
          {
            id: targetKey,
            userId: puid,
            name: `Rider ${puid}`,
            avatar: `rider-${puid}`,
            status: "on-way" as const,
            role: "member" as const,
            muted: true,
            blocked: false,
            speed: kmh ?? 0,
            distanceCovered: 0,
            checkpoints: 0,
            xpGained: 0,
            lat: plat,
            lng: plng,
            locationUpdatedAt: new Date().toISOString(),
          },
        ];
      });
    };

    const onConvoyAction = (payload: {
      kind?: string;
      userId?: number | null;
      actorName?: string;
      at?: string;
      reason?: string;
      details?: string;
    }) => {
      const k = String(payload?.kind || "");
      const selfId = user?.id != null ? Number(user.id) : null;
      const isSelf = selfId != null && payload.userId != null && Number(payload.userId) === selfId;
      if (k === "trip-started") {
        setTripStarted(true);
        if (!isOrganizerRef.current && phaseRef.current === "waiting" && !isSelf) {
          pushIncomingAlertRef.current(payload);
        }
        return;
      }
      if (k && !isSelf) pushIncomingAlertRef.current(payload);
    };

    const onDisconnect = (reason: string) => {
      if (__DEV__) console.log("[socket] disconnected:", reason);
    };

    socket.on("connect", joinAndAnnounce);
    if (socket.connected) joinAndAnnounce();
    socket.on("connect_error", onConnectErr);
    socket.on("trip-member-presence", onTripMemberPresence);
    socket.on("broadcast-position-now", onBroadcastPositionNow);
    socket.on("rider-left", onRiderLeft);
    socket.on("location-updated", onLocationUpdated);
    socket.on("convoy-action", onConvoyAction);
    socket.on("disconnect", onDisconnect);

    const onCheckpointsUpdated = (payload?: {
      tripId?: number;
      action?: string;
      checkpoint?: Record<string, unknown>;
    }) => {
      const tid = payload?.tripId != null ? Number(payload.tripId) : null;
      if (tid != null && Number.isFinite(tid) && tid !== tripIdRef.current) return;

      if (payload?.action === "added" && payload.checkpoint && typeof payload.checkpoint === "object") {
        const row = payload.checkpoint;
        const cid = String(row.id ?? "");
        if (!cid) {
          void loadTripCheckpointsRef.current();
          return;
        }
        if (checkpointsRawRef.current.some((c) => c.id === cid)) {
          void loadTripCheckpointsRef.current();
          return;
        }
        const cp = mapApiRowToCheckpoint(row, checkpointsRawRef.current.length);
        checkpointsRawRef.current = [...checkpointsRawRef.current, cp];
        applyCheckpointSortRef.current();
        return;
      }

      void loadTripCheckpointsRef.current();
    };
    const onMapPinRequested = (payload: MapPinRequestSocketPayload) => {
      if (!isTripStaffRef.current) return;
      setPinRequestQueue((q) => {
        const exists = q.some((x) => x.pinId === payload.pinId);
        if (exists) return q;
        return [...q, payload];
      });
    };
    const onMapPinReviewed = (payload: { pinId?: string; status?: string; checkpointName?: string }) => {
      const pid = payload.pinId != null ? String(payload.pinId) : "";
      if (pid) setPendingMemberPins((prev) => prev.filter((x) => x.id !== pid));
      const st = String(payload.status || "").toLowerCase();
      if (st === "approved") {
        setTransientToast({
          message: "Your pin was approved and added as a checkpoint!",
          tone: "success",
        });
        void loadTripCheckpointsRef.current();
      } else if (st === "denied") {
        setTransientToast({ message: "Your pin request was denied", tone: "error" });
      }
    };
    socket.on("checkpoints:updated", onCheckpointsUpdated);
    socket.on("map_pin:requested", onMapPinRequested);
    socket.on("map_pin:reviewed", onMapPinReviewed);

    return () => {
      socket.off("connect", joinAndAnnounce);
      socket.off("connect_error", onConnectErr);
      socket.off("trip-member-presence", onTripMemberPresence);
      socket.off("broadcast-position-now", onBroadcastPositionNow);
      socket.off("rider-left", onRiderLeft);
      socket.off("location-updated", onLocationUpdated);
      socket.off("convoy-action", onConvoyAction);
      socket.off("disconnect", onDisconnect);
      socket.off("checkpoints:updated", onCheckpointsUpdated);
      socket.off("map_pin:requested", onMapPinRequested);
      socket.off("map_pin:reviewed", onMapPinReviewed);
      socket.disconnect();
      socketRef.current = null;
      setLiveSocket(null);
    };
  }, [accessDenied, mapApiRowToCheckpoint, tripIdNum, user?.id]);

  /** REST fallback when socket drops updates — only patches rows with no fresh socket fix in the last 8s. */
  useEffect(() => {
    if (!user?.id || accessDenied || phase !== "live") return;
    const recovery = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/trips/${id}/live-state?user_id=${encodeURIComponent(String(user.id))}`);
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { members?: LiveMember[] };
        if (!Array.isArray(body.members)) return;

        setMembers((prev) => {
          let changed = false;
          const next = prev.map((existing) => {
            const fresh = body.members!.find(
              (m) => canonicalMemberIdStr(m) === canonicalMemberIdStr(existing),
            );
            if (!fresh) return existing;
            const nu = memberUserId(existing);
            if (!Number.isFinite(nu)) return existing;
            const lastSocket = lastSeenRef.current[nu];
            const socketFresh = lastSocket != null && Date.now() - lastSocket < 8000;
            if (socketFresh) return existing;

            const flat = toNum(fresh.lat);
            const flng = toNum(fresh.lng);
            if (flat == null || flng == null) return existing;
            if (Math.abs(flat) <= 1e-5 && Math.abs(flng) <= 1e-5) return existing;

            if (
              Math.abs(flat - existing.lat) > 0.000005 ||
              Math.abs(flng - existing.lng) > 0.000005 ||
              existing.status === "absent"
            ) {
              changed = true;
              return {
                ...existing,
                lat: flat,
                lng: flng,
                speed: fresh.speed ?? existing.speed,
                status: existing.status === "absent" ? "on-way" : existing.status,
                locationUpdatedAt: fresh.locationUpdatedAt ?? existing.locationUpdatedAt,
              };
            }
            return existing;
          });
          return changed ? next : prev;
        });
      } catch {
        /* non-critical */
      }
    }, 8000);
    return () => clearInterval(recovery);
  }, [accessDenied, id, phase, user?.id]);

  useEffect(() => {
    if (phase !== "live" || !user?.id || !Number.isFinite(tripIdNum)) return;
    let stopped = false;
    const tick = async () => {
      try {
        const since = lastAlertIsoRef.current ? `&since=${encodeURIComponent(lastAlertIsoRef.current)}` : "";
        const res = await apiFetch(
          `/api/trips/${tripIdNum}/alerts?user_id=${Number(user.id)}&limit=50${since}`,
        );
        const body = (await res.json().catch(() => ({}))) as { alerts?: AlertApiRow[] };
        if (!res.ok || stopped) return;
        const incoming = Array.isArray(body.alerts) ? body.alerts : [];
        for (const row of incoming) {
          const alertId = row.id != null ? String(row.id) : "";
          if (!alertId || seenAlertIdsRef.current.has(alertId)) continue;
          seenAlertIdsRef.current.add(alertId);
          const atIso = String(row.created_at || new Date().toISOString());
          if (!lastAlertIsoRef.current || atIso > lastAlertIsoRef.current) {
            lastAlertIsoRef.current = atIso;
          }
          const selfId = Number(user.id);
          const actorId = row.user_id != null ? Number(row.user_id) : null;
          if (actorId === selfId) continue;
          pushIncomingAlert({
            id: alertId,
            kind: row.kind,
            userId: actorId,
            actorName: row.actor_name,
            at: atIso,
            reason: row.reason ?? undefined,
            details: row.details ?? undefined,
          });
        }
      } catch {
        // Keep polling; socket may still deliver in parallel.
      }
    };
    tick();
    const t = setInterval(tick, 2500);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [phase, pushIncomingAlert, tripIdNum, user?.id]);

  useEffect(() => {
    if (phase !== "live" || !user?.id) return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase, user?.id]);

  useEffect(() => {
    if (accessDenied) return;
    const t = setInterval(() => {
      applyCheckpointSort();
    }, 5000);
    return () => clearInterval(t);
  }, [accessDenied, applyCheckpointSort]);

  useEffect(() => {
    if (phase !== "live" || !user?.id) {
      return;
    }
    let sub: Location.LocationSubscription | undefined;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Location permission needed",
          "Enable precise location to auto-center the live map and track distance accurately.",
        );
        return;
      }
      try {
        await Location.enableNetworkProviderAsync();
      } catch {
        // Ignore if unavailable; GPS can still work.
      }

      // Bootstrap an immediate fix so map pins/camera appear without waiting for watch callback.
      try {
        const first = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        const { latitude, longitude, accuracy, speed, heading } = first.coords;
        const lat = latitude;
        const lng = longitude;
        let hDeg: number | null = heading ?? null;
        if (hDeg != null && Number.isFinite(hDeg) && hDeg < 0) hDeg = hDeg + 360;
        setUserGeo({
          lat,
          lng,
          accuracyM: accuracy ?? undefined,
          headingDeg: hDeg,
          speedMps: speed ?? null,
        });
        if (!initialAutoCenterDoneRef.current) {
          setMapRecenterPoint({ lat, lng });
          liveMapRef.current?.recenter({ lat, lng });
          initialAutoCenterDoneRef.current = true;
        }
        lastPosRef.current = { lat, lng };
        currentPositionRef.current = { lat, lng };
        mapSmoothedRef.current = { lat, lng };
        lastLocTsRef.current = first.timestamp;
        applyCheckpointSort();
      } catch {
        // watcher below can still provide the first fix
      }

      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 4,
        },
        (loc) => {
          const uidLoc = appUserNumericId(user);
          const { latitude, longitude, accuracy, speed, heading } = loc.coords;
          const lat = latitude;
          const lng = longitude;
          currentPositionRef.current = { lat, lng };
          const accM = Math.max(0, accuracy ?? 50);
          const prev = lastPosRef.current;
          const dKmFromPrev = prev ? haversineKm(prev, { lat, lng }) : 0;
          const dMFromPrev = dKmFromPrev * 1000;
          const speedMps = speed != null && Number.isFinite(speed) ? Math.max(0, speed) : 0;
          const driftFloorM = Math.max(15, accM * 1.0);
          const movedEnough = dMFromPrev >= driftFloorM;
          const deviceSaysMoving = speedMps >= 1.0;

          // Ignore noisy GPS drift when user is effectively stationary.
          if (prev && !movedEnough && !deviceSaysMoving) {
            return;
          }

          let speedKmh = 0;
          if (speedMps > 0) {
            speedKmh = speedMps * 3.6;
          }
          if (prev) {
            const d = haversineKm(prev, { lat, lng });
            const dM = d * 1000;
            const minMoveM = Math.max(12, accM * 0.85);
            if (dM >= minMoveM && d < 2) setMyDistanceKm((x) => x + d);
            if (speedKmh < 0.5 && lastLocTsRef.current != null) {
              const dtSec = Math.max(0.1, (loc.timestamp - lastLocTsRef.current) / 1000);
              speedKmh = (d / dtSec) * 3600;
            }
          }
          setCurrentSpeedKmh(Math.max(0, Math.round(speedKmh)));
          lastPosRef.current = { lat, lng };
          lastLocTsRef.current = loc.timestamp;

          const ms = mapSmoothedRef.current;
          let outLat = lat;
          let outLng = lng;
          if (ms) {
            const a = GPS_SMOOTH_ALPHA;
            outLat = ms.lat * (1 - a) + lat * a;
            outLng = ms.lng * (1 - a) + lng * a;
          }
          mapSmoothedRef.current = { lat: outLat, lng: outLng };

          let hDeg: number | null = heading ?? null;
          if (hDeg != null && Number.isFinite(hDeg) && hDeg < 0) hDeg = hDeg + 360;
          setUserGeo({
            lat: outLat,
            lng: outLng,
            accuracyM: accuracy ?? undefined,
            headingDeg: hDeg,
            speedMps: speed ?? null,
          });
          setPosTick((x) => x + 1);

          setMembers((prev) =>
            prev.map((m) => {
              const isSelfRow =
                (uidLoc != null && memberUserId(m) === uidLoc) ||
                (localMemberId != null && (m.id === localMemberId || String(m.id) === localMemberId));
              if (!isSelfRow) return m;
              return {
                ...m,
                lat: outLat,
                lng: outLng,
                locationUpdatedAt: new Date().toISOString(),
                speed: Math.max(0, Math.round(speedKmh)),
                status: m.status === "absent" ? "on-way" : m.status,
              };
            }),
          );

          if (uidLoc != null) {
            socketRef.current?.emit("update-location", {
              tripId: tripIdNum,
              userId: uidLoc,
              lat: outLat,
              lng: outLng,
              accuracy: accuracy ?? undefined,
              speed: speed ?? undefined,
              heading: heading ?? undefined,
              recordedAt: new Date(loc.timestamp).toISOString(),
            });
          }

          if (__DEV__) {
            const nowL = Date.now();
            if (nowL - lastEmitLocationLogRef.current >= 1500) {
              lastEmitLocationLogRef.current = nowL;
              console.log("📍 EMIT my location (broadcast to trip room)", {
                userId: uidLoc,
                lat: outLat,
                lng: outLng,
              });
            }
          }

          const nowMs = Date.now();
          if (uidLoc != null && nowMs - lastLocationHttpPostRef.current >= LOCATION_HTTP_POST_MIN_MS) {
            lastLocationHttpPostRef.current = nowMs;
            void apiFetch(`/api/trips/${tripIdNum}/location`, {
              method: "POST",
              body: JSON.stringify({
                user_id: uidLoc,
                lat: outLat,
                lng: outLng,
                speed_mps:
                  speed != null && Number.isFinite(speed) && speed >= 0 ? Number(speed) : null,
              }),
            }).catch(() => {
              /* non-fatal; socket or next tick may succeed */
            });
          }
        },
      );
    })();

    return () => {
      sub?.remove();
    };
  }, [applyCheckpointSort, phase, tripIdNum, user?.id, localMemberId]);

  const hWin = Dimensions.get("window").height;
  const peekH = 200;
  const expandH = Math.min(hWin * 0.62, 560);
  const sheetBlocking = sheetExpanded || sheetDragging;
  const mapControlsTop = sheetBlocking ? hWin * 0.20 : hWin * 0.26;

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gestureState) => {
          const vertical = Math.abs(gestureState.dy) > 6 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
          if (!vertical) return false;
          if (!sheetExpanded) return true;
          // When expanded, only capture downward pull if list is already at top.
          return gestureState.dy > 6 && sheetScrollYRef.current <= 0;
        },
        onPanResponderGrant: () => {
          setSheetDragging(true);
        },
        onPanResponderRelease: (_evt, gestureState) => {
          if (gestureState.dy < -18) setSheetExpanded(true);
          if (gestureState.dy > 18) setSheetExpanded(false);
          setSheetDragging(false);
        },
        onPanResponderTerminate: () => {
          setSheetDragging(false);
        },
      }),
    [sheetExpanded],
  );

  useEffect(() => {
    Animated.spring(sheetHeightAnim, {
      toValue: sheetExpanded ? expandH : peekH,
      damping: 22,
      stiffness: 220,
      mass: 0.7,
      useNativeDriver: false,
    }).start();
  }, [sheetExpanded, expandH, peekH, sheetHeightAnim]);

  useEffect(() => {
    if (!sheetExpanded || phase !== "live") return;
    const pos = lastPosRef.current;
    if (!pos) return;
    let cancelled = false;
    setWeatherLoading(true);
    fetchWeatherNow(pos.lat, pos.lng).then((w) => {
      if (!cancelled) {
        setWeather(w);
        setWeatherLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sheetExpanded, phase, posTick]);

  const allowSpeakerAndUnmute = (targetId: string) => {
    void allowSpeaker(targetId);
    setMembers((prev) => prev.map((m) => (m.id === targetId ? { ...m, muted: false } : m)));
  };

  const denySpeakerOnly = (targetId: string) => {
    void denySpeaker(targetId);
  };

  const toggleMuteWithVoiceRules = useCallback(
    (targetId: string) => {
      if (!localMemberId) {
        setMembers((p) => p.map((m) => (m.id === targetId ? { ...m, muted: !m.muted } : m)));
        return;
      }
      const isSelf = targetId === localMemberId;
      const member = members.find((m) => m.id === targetId);
      if (!member) return;
      if (voiceMode === "controlled" && isSelf && localMuted && !localAllowedInControlled) return;
      if (!canModerateVoice && !isSelf) return;

      const newMuted = !member.muted;

      if (isInVoice) {
        if (isSelf) {
          const nowMuted = toggleConvoyMute() ?? newMuted;
          setMembers((p) => p.map((m) => (m.id === targetId ? { ...m, muted: nowMuted } : m)));
        } else if (canModerateVoice && member.userId != null) {
          muteRemoteRider(member.userId, newMuted);
          setMembers((p) => p.map((m) => (m.id === targetId ? { ...m, muted: newMuted } : m)));
        }
      } else {
        setMembers((p) => p.map((m) => (m.id === targetId ? { ...m, muted: newMuted } : m)));
      }
    },
    [
      localMemberId,
      members,
      voiceMode,
      localMuted,
      localAllowedInControlled,
      canModerateVoice,
      isInVoice,
      toggleConvoyMute,
      muteRemoteRider,
    ],
  );

  const toggleBlock = useCallback(
    (mid: string) => {
      setMembers((p) =>
        p.map((m) => {
          if (m.id !== mid) return m;
          const blocked = !m.blocked;
          if (isInVoice && m.userId != null) {
            setConvoyBlocked(m.userId, blocked);
          }
          return { ...m, blocked };
        }),
      );
    },
    [isInVoice, setConvoyBlocked],
  );

  const assignRole = (mid: string, role: MemberRole) =>
    setMembers((p) => p.map((m) => (m.id === mid ? { ...m, role } : m)));

  const endTrip = async () => {
    if (!user?.id) return;
    setEndingTrip(true);
    try {
      const res = await apiFetch(`/api/trips/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          user_id: Number(user.id),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert("End trip", (body as { error?: string }).error ?? (await readApiErrorMessage(res)));
        return;
      }
      navigation.replace("EndTripDashboard", {
        tripId: String(id),
        tripName: trip?.name,
        distanceKm: myDistanceKm,
        durationSec: elapsedSec,
        riders: totalCount,
      });
    } finally {
      setEndingTrip(false);
    }
  };

  const emitLiveLocationSnapshot = useCallback(() => {
    setTimeout(() => {
      const pos = lastPosRef.current;
      if (!pos || !user?.id || !socketRef.current) return;
      const uid = appUserNumericId(user);
      if (uid == null) return;
      socketRef.current.emit("update-location", {
        tripId: tripIdNum,
        userId: uid,
        lat: pos.lat,
        lng: pos.lng,
        speed: null,
        heading: null,
      });
    }, 800);
  }, [tripIdNum, user?.id]);

  const startTripLive = useCallback(async () => {
    if (!user?.id) return;
    if (!isOrganizer && !tripStarted) {
      Alert.alert("Trip not started", "Wait for organizer to start the trip.");
      return;
    }
    if (!isOrganizer && tripStarted) {
      setElapsedSec(0);
      setMyDistanceKm(0);
      mapSmoothedRef.current = null;
      setPhase("live");
      emitLiveLocationSnapshot();
      return;
    }
    try {
      const res = await apiFetch(`/api/trips/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "active",
          user_id: Number(user.id),
        }),
      });
      if (!res.ok) {
        Alert.alert("Start trip", await readApiErrorMessage(res));
        return;
      }
      setTripStarted(true);
      setElapsedSec(0);
      setMyDistanceKm(0);
      mapSmoothedRef.current = null;
      socketRef.current?.emit("convoy-action", {
        kind: "trip-started",
        tripId: tripIdNum,
        userId: Number(user.id),
      });
      setPhase("live");
      emitLiveLocationSnapshot();
    } catch {
      Alert.alert("Start trip", "Could not start trip right now.");
    }
  }, [emitLiveLocationSnapshot, id, isOrganizer, tripIdNum, tripStarted, user?.id]);

  /**
   * Timeline + top card: sorted order = current (<50m) → upcoming → passed.
   * "Next" card prefers `clientIsCurrent`, else first upcoming (not passed, not current).
   */
  const { nextCheckpointInfo, routeTimeline } = useMemo(() => {
    const spd = Math.max(currentSpeedKmh, 6);
    if (!checkpoints.length) {
      return {
        nextCheckpointInfo: null as {
          next: Checkpoint;
          distanceM: number;
          etaMin: number | null;
          isCurrent: boolean;
        } | null,
        routeTimeline: [] as Array<{
          cp: Checkpoint;
          order: number;
          distM: number;
          distKm: number;
          etaMin: number;
          reached: boolean;
          isCurrent: boolean;
          isNext: boolean;
        }>,
      };
    }
    const hasGps = checkpoints.some((cp) => cp.clientDistanceM != null);
    const currentCp = checkpoints.find((cp) => cp.clientIsCurrent) ?? null;
    const nextUpcoming = checkpoints.find((cp) => !cp.reached && !cp.clientIsCurrent) ?? null;

    let nextForCard: Checkpoint | null = null;
    if (currentCp) nextForCard = currentCp;
    else if (nextUpcoming) nextForCard = nextUpcoming;
    else if (!hasGps && checkpoints[0]) nextForCard = checkpoints[0];

    let nextCheckpointInfo: {
      next: Checkpoint;
      distanceM: number;
      etaMin: number | null;
      isCurrent: boolean;
    } | null = null;
    if (nextForCard) {
      const distM = nextForCard.clientDistanceM ?? 0;
      const distKm = distM / 1000;
      const etaMin =
        nextForCard.clientDistanceM != null && distKm > 0.005 ? (distKm / spd) * 60 : null;
      nextCheckpointInfo = {
        next: nextForCard,
        distanceM: distM,
        etaMin,
        isCurrent: Boolean(nextForCard.clientIsCurrent),
      };
    }

    const routeTimeline = checkpoints.map((cp, i) => {
      const distM = cp.clientDistanceM ?? 0;
      const reached = cp.reached === true;
      const isCurrent = cp.clientIsCurrent === true;
      const isNext =
        Boolean(nextUpcoming) &&
        !isCurrent &&
        !reached &&
        String(cp.id) === String(nextUpcoming!.id);
      const distKm = distM / 1000;
      const etaMin =
        cp.clientDistanceM != null && distKm > 0.005 ? (distKm / spd) * 60 : 0;
      return {
        cp,
        order: i + 1,
        distM,
        distKm,
        etaMin,
        reached,
        isCurrent,
        isNext,
      };
    });
    return { nextCheckpointInfo, routeTimeline };
  }, [checkpoints, checkpointSortTick, currentSpeedKmh]);

  /** Waiting-room list uses same sorted `checkpoints`; falls back to meetup distance if no GPS yet. */
  const waitingCheckpointList = useMemo(() => {
    if (!checkpoints.length) return [];
    return checkpoints.map((cp, i) => {
      let distM = cp.clientDistanceM ?? 0;
      let distKind: "you" | "meetup" | "none" = "none";
      if (cp.clientDistanceM != null) {
        distKind = "you";
      } else if (trip?.meetupLat != null && trip?.meetupLng != null) {
        const ml = Number(trip.meetupLat);
        const mg = Number(trip.meetupLng);
        if (Number.isFinite(ml) && Number.isFinite(mg)) {
          distM = haversineDistance(ml, mg, cp.lat, cp.lng);
          distKind = "meetup";
        }
      }
      const reached = cp.reached === true;
      return { cp, distM, reached, distKind };
    });
  }, [checkpoints, checkpointSortTick, trip?.meetupLat, trip?.meetupLng]);

  /** Must run every render (before any early return) — used for live map + active segment. */
  const mapRouteGeometry = useMemo(() => {
    const liveRoutePointsRaw =
      drivingRoute?.coordinates
        ?.map((c) => {
          const lat = toNum(c.latitude);
          const lng = toNum(c.longitude);
          if (lat == null || lng == null) return null;
          return { lat, lng };
        })
        .filter((x): x is { lat: number; lng: number } => x != null) ?? [];
    const startPoint =
      (drivingRoute?.start && toNum(drivingRoute.start.lat) != null && toNum(drivingRoute.start.lng) != null
        ? { lat: Number(drivingRoute.start.lat), lng: Number(drivingRoute.start.lng) }
        : null) ??
      (toNum(trip?.meetupLat) != null && toNum(trip?.meetupLng) != null
        ? { lat: Number(trip?.meetupLat), lng: Number(trip?.meetupLng) }
        : null);
    const endPoint =
      (drivingRoute?.end && toNum(drivingRoute.end.lat) != null && toNum(drivingRoute.end.lng) != null
        ? { lat: Number(drivingRoute.end.lat), lng: Number(drivingRoute.end.lng) }
        : null) ??
      (toNum(trip?.endLat) != null && toNum(trip?.endLng) != null
        ? { lat: Number(trip?.endLat), lng: Number(trip?.endLng) }
        : null);
    const liveRoutePoints =
      liveRoutePointsRaw.length >= 2
        ? liveRoutePointsRaw
        : startPoint && endPoint
          ? [startPoint, endPoint]
          : [];
    return { liveRoutePoints, startPoint, endPoint };
  }, [drivingRoute, trip]);

  const activeRouteSegmentPoints = useMemo((): MapPoint[] | null => {
    const { liveRoutePoints } = mapRouteGeometry;
    if (liveRoutePoints.length < 2 || !nextCheckpointInfo) return null;
    const pos =
      lastPosRef.current ??
      (userGeo ? { lat: userGeo.lat, lng: userGeo.lng } : null);
    if (!pos) return null;
    const next = nextCheckpointInfo.next;
    const nearest = (pts: { lat: number; lng: number }[], la: number, ln: number) => {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const d = haversineKm({ lat: la, lng: ln }, pts[i]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      return bi;
    };
    const ui = nearest(liveRoutePoints, pos.lat, pos.lng);
    const ci = nearest(liveRoutePoints, next.lat, next.lng);
    const lo = Math.min(ui, ci);
    const hi = Math.max(ui, ci);
    return liveRoutePoints.slice(lo, hi + 1);
  }, [mapRouteGeometry, nextCheckpointInfo, posTick, userGeo]);

  const mapOverlayPins = useMemo(() => {
    const fromServer = mapPins.map((p) => ({
      id: p.id,
      label: p.label,
      lat: p.lat,
      lng: p.lng,
      color: "#a78bfa",
    }));
    const pending = pendingMemberPins.map((p) => ({
      id: p.id,
      label: p.label,
      lat: p.lat,
      lng: p.lng,
      color: "#fbbf24",
    }));
    const q0 = pinRequestQueue[0];
    const staff =
      canSendLineupFormation && q0
        ? [
            {
              id: `pin-req-${q0.pinId}`,
              label: q0.label || "Pin request",
              lat: q0.lat,
              lng: q0.lng,
              color: "#f59e0b",
            },
          ]
        : [];
    return [...fromServer, ...pending, ...staff];
  }, [mapPins, pendingMemberPins, pinRequestQueue, canSendLineupFormation]);

  const onLeave = useCallback(() => {
    setShowExitConfirm(false);
    if (isInVoice) leaveConvoyVoice();
    if (videoCallActive) void broadcastLeaveVoice();
    navigation.goBack();
  }, [navigation, isInVoice, leaveConvoyVoice, videoCallActive, broadcastLeaveVoice]);

  const fitConvoy = useCallback(() => {
    setMapFitTick((n) => n + 1);
  }, []);

  const handleRecenter = useCallback(async () => {
    try {
      const pos =
        userGeo ??
        (lastPosRef.current
          ? { lat: lastPosRef.current.lat, lng: lastPosRef.current.lng }
          : null);
      if (pos) {
        setMapRecenterPoint({ lat: pos.lat, lng: pos.lng });
        liveMapRef.current?.fitConvoy();
        setTimeout(() => {
          liveMapRef.current?.recenter({ lat: pos.lat, lng: pos.lng });
        }, 220);
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      const { latitude, longitude } = loc.coords;
      setMapRecenterPoint({ lat: latitude, lng: longitude });
      liveMapRef.current?.fitConvoy();
      setTimeout(() => {
        liveMapRef.current?.recenter({ lat: latitude, lng: longitude });
      }, 220);
    } catch {
      // keep UI stable
    }
  }, [userGeo]);

  useEffect(() => {
    convoyFitDoneRef.current = false;
  }, [id]);

  useEffect(() => {
    if (phase === "waiting") convoyFitDoneRef.current = false;
  }, [phase]);

  useEffect(() => {
    if (phase !== "live" || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/trips/${id}/driving-route`);
        const j = (await res.json()) as DrivingRoutePayload;
        if (!cancelled) setDrivingRoute(j);
      } catch {
        if (!cancelled) setDrivingRoute(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, phase]);

  useEffect(() => {
    if (phase !== "live" || convoyFitDoneRef.current) return;
    const hasRoute = (drivingRoute?.coordinates?.length ?? 0) >= 2;
    const hasRiders = members.some(
      (m) => m.status !== "absent" && m.lat !== 0 && m.lng !== 0,
    );
    if (
      !hasRoute &&
      !hasRiders &&
      !(trip?.meetupLat != null && trip?.meetupLng != null)
    ) {
      return;
    }
    const t = setTimeout(() => {
      fitConvoy();
      convoyFitDoneRef.current = true;
    }, 500);
    return () => clearTimeout(t);
  }, [
    phase,
    drivingRoute?.coordinates?.length,
    members.length,
    fitConvoy,
    trip?.meetupLat,
    trip?.meetupLng,
  ]);

  const goToPausedWaiting = useCallback(() => {
    setPhase("waiting");
    setPausedFromLive(true);
  }, []);

  const emitConvoy = useCallback(
    async (kind: string, extras?: { reason?: string; details?: string }) => {
      if (!user?.id) return;
      if (kind === "line-up-formation" && !canSendLineupFormation) {
        Alert.alert("Not allowed", "Only organizer, co-admin, or moderator can send line-up formation alerts.");
        return;
      }
      const atIso = new Date().toISOString();
      const payload = {
        kind,
        tripId: tripIdNum,
        userId: Number(user.id),
        actorName: user?.name || "You",
        at: atIso,
        reason: extras?.reason,
        details: extras?.details,
      };
      try {
        await apiFetch(`/api/trips/${tripIdNum}/alerts`, {
          method: "POST",
          body: JSON.stringify({
            user_id: Number(user.id),
            kind,
            actor_name: payload.actorName,
            reason: extras?.reason,
            details: extras?.details,
          }),
        });
      } catch (e: unknown) {
        if (isAbortLikeError(e)) return;
        // Socket fallback still runs for near-realtime UX.
      }
      socketRef.current?.emit("convoy-action", payload);
      showSentAlertPopup(kind, extras?.details || extras?.reason);
    },
    [tripIdNum, user?.id, canSendLineupFormation, showSentAlertPopup],
  );

  const submitMapPin = useCallback(async () => {
    if (!user?.id || !pinLabel.trim()) {
      Alert.alert("Map pin", "Enter a label.");
      return;
    }
    const pos = lastPosRef.current;
    if (!pos) {
      Alert.alert("Location", "Wait for a GPS fix, then try again.");
      return;
    }
    try {
      const res = await apiFetch(`/api/trips/${id}/map-pins`, {
        method: "POST",
        skipApiTimeout: true,
        body: JSON.stringify({
          user_id: Number(user.id),
          type: pinType,
          label: pinLabel.trim(),
          lat: pos.lat,
          lng: pos.lng,
          added_by: user.name,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; label?: string; lat?: number; lng?: number; type?: string; addedBy?: string };
      if (!res.ok) {
        Alert.alert("Map pin", (body as { error?: string }).error ?? (await readApiErrorMessage(res)));
        return;
      }
      setMapPins((p) => [
        ...p,
        {
          id: String(body.id ?? Date.now()),
          type: String(body.type ?? pinType),
          lat: Number(body.lat ?? pos.lat),
          lng: Number(body.lng ?? pos.lng),
          label: String(body.label ?? pinLabel.trim()),
          addedBy: String(body.addedBy ?? user.name),
        },
      ]);
      emitConvoy("map-pin-added", { details: pinLabel.trim() });
      setPinLabel("");
      setShowPinModal(false);
      Alert.alert("Map pin", "Pin added for the convoy.");
    } catch (e: unknown) {
      if (isAbortLikeError(e)) return;
      Alert.alert("Map pin", "Could not add pin.");
    }
  }, [id, pinLabel, pinType, user]);

  const submitMapPinRequest = useCallback(async () => {
    if (!user?.id || mapPinSubmitting) return;
    const reasonT = mapPinReason.trim();
    const labelT = mapPinLabel.trim();
    if (!reasonT && !labelT) {
      Alert.alert("Pin request", "Enter a label or reason.");
      return;
    }
    const pos = lastPosRef.current;
    if (!pos) {
      Alert.alert("Location", "Wait for a GPS fix.");
      return;
    }
    const uid = appUserNumericId(user);
    if (uid == null) {
      Alert.alert("Pin request", "Sign in again — your profile id could not be read.");
      return;
    }
    const lat = Number(pos.lat);
    const lng = Number(pos.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert("Location", "Invalid GPS coordinates — wait for a fix and try again.");
      return;
    }
    setMapPinSubmitting(true);
    try {
      const res = await apiFetch(`/api/trips/${tripIdNum}/map-pin-requests`, {
        method: "POST",
        skipApiTimeout: true,
        body: JSON.stringify({
          user_id: uid,
          latitude: lat,
          longitude: lng,
          reason: reasonT,
          label: labelT,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        autoApproved?: boolean;
        status?: string;
        pinId?: string;
        error?: string;
        details?: string;
        message?: string;
      };
      if (res.status === 409 && body.error === "duplicate") {
        setShowMapPinRequestModal(false);
        setMapPinReason("");
        setMapPinLabel("");
        setMapPinCrosshair(false);
        return;
      }
      if (!res.ok) {
        const errMsg =
          (typeof body.details === "string" && body.details.trim()) ||
          body.error ||
          body.message ||
          (await readApiErrorMessage(res));
        Alert.alert("Pin request", errMsg);
        return;
      }
      setShowMapPinRequestModal(false);
      setMapPinReason("");
      setMapPinLabel("");
      setMapPinCrosshair(false);
      if (body.autoApproved) {
        setTransientToast({ message: "Pin added as checkpoint", tone: "success" });
        void loadTripCheckpoints();
        return;
      }
      if (body.status === "pending" && body.pinId) {
        setTransientToast({ message: "Pin submitted — waiting for approval", tone: "warning" });
        setPendingMemberPins((p) => [
          ...p,
          {
            id: String(body.pinId),
            lat,
            lng,
            label: labelT || reasonT.slice(0, 40) || "Pending",
          },
        ]);
      }
    } catch (e: unknown) {
      if (isAbortLikeError(e)) {
        if (__DEV__) console.log("Pin request aborted client-side — server may still have received it");
        return;
      }
      console.error("Pin submit error:", e);
      const errMsg = e instanceof Error ? e.message : "Could not submit";
      Alert.alert("Pin request", errMsg);
    } finally {
      setMapPinSubmitting(false);
    }
  }, [mapPinLabel, mapPinReason, mapPinSubmitting, tripIdNum, user, loadTripCheckpoints]);

  const reviewQueuedPinRequest = useCallback(
    (action: "approve" | "deny") => {
      if (pinReviewBusyRef.current) return;
      const current = pinRequestQueueRef.current[0];
      if (!current || !user?.id) return;
      pinReviewBusyRef.current = true;
      setPinReviewUiLock(true);
      setPinReviewFlash(action);
      const pinId = current.pinId;
      const uid = Number(user.id);
      setTimeout(() => {
        setPinReviewFlash(null);
        setPinRequestQueue((q) => (q[0]?.pinId === pinId ? q.slice(1) : q));
        pinReviewBusyRef.current = false;
        setPinReviewUiLock(false);
      }, 150);
      void (async () => {
        try {
          const res = await apiFetch(`/api/trips/${tripIdNum}/map-pin-requests/${pinId}/review`, {
            method: "PATCH",
            skipApiTimeout: true,
            body: JSON.stringify({
              user_id: uid,
              action,
            }),
          });
          if (!res.ok) {
            setTransientToast({ message: "Action failed — please try again", tone: "error" });
          }
        } catch (e: unknown) {
          if (isAbortLikeError(e)) return;
          setTransientToast({ message: "Action failed — please try again", tone: "error" });
        }
      })();
    },
    [tripIdNum, user?.id],
  );

  const closeAttractionModal = useCallback(() => {
    setShowAttractionModal(false);
    setAttrName("");
    setAttrDesc("");
    setAttrImages([]);
  }, []);

  const pickAttractionImages = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo access to add images.");
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 5 - attrImages.length),
      quality: 0.7,
      base64: true,
    });
    if (__DEV__) {
      console.log("[attraction] picker:", r.canceled ? "canceled" : `${r.assets?.length ?? 0} asset(s)`);
    }
    if (r.canceled || !r.assets?.length) return;
    const picked = r.assets.slice(0, 5);
    if (__DEV__) {
      console.log(
        "[attraction] selected:",
        picked.map((a) => ({ uri: a.uri?.slice(0, 48), hasBase64: Boolean(a.base64?.length) })),
      );
    }
    setAttrImages((prev) => [...prev, ...picked].slice(0, 5));
  }, [attrImages.length]);

  const submitAttraction = useCallback(async () => {
    if (!user?.id || !attrName.trim()) {
      Alert.alert("Attraction", "Enter a name for this place.");
      return;
    }
    const uid = appUserNumericId(user);
    if (uid == null) {
      Alert.alert("Attraction", "Sign in again — your profile id could not be read.");
      return;
    }
    const pos = lastPosRef.current;
    if (!pos) {
      Alert.alert("Location", "Wait for a GPS fix.");
      return;
    }
    const lat = Number(pos.lat);
    const lng = Number(pos.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert("Location", "Invalid GPS coordinates — wait for a fix and try again.");
      return;
    }
    setAttrSaving(true);
    try {
      let imageUrls: string[] = [];
      if (attrImages.length > 0) {
        if (!supabase) {
          Alert.alert(
            "Photos",
            "Supabase is not configured in mobile (.env). Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to upload photos.",
          );
        } else {
          if (__DEV__) console.log("[attraction] uploading", attrImages.length, "image(s)");
          imageUrls = await uploadAttractionImagesToStorage(supabase, tripIdNum, attrImages);
          if (__DEV__) console.log("[attraction] uploaded URLs:", imageUrls);
        }
      }

      const body = {
        name: attrName.trim(),
        description: attrDesc.trim(),
        latitude: lat,
        longitude: lng,
        images: imageUrls,
        user_id: uid,
        trip_id: tripIdNum,
      };
      if (__DEV__) console.log("[attraction] API body:", { ...body, images: imageUrls });

      const res = await apiFetch(`/api/trips/${tripIdNum}/nearby-attractions`, {
        method: "POST",
        skipApiTimeout: true,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        Alert.alert("Attraction", await readApiErrorMessage(res));
        return;
      }
      closeAttractionModal();
      const n = imageUrls.length;
      Alert.alert(
        "Saved!",
        n > 0
          ? `Organizers can use this as a checkpoint. ${n} photo(s) attached.`
          : "Organizers can use this as a checkpoint.",
      );
    } catch (e: unknown) {
      if (isAbortLikeError(e)) return;
      const msg = e instanceof Error ? e.message : "Network error while saving.";
      Alert.alert("Attraction", msg);
    } finally {
      setAttrSaving(false);
    }
  }, [attrDesc, attrImages, attrName, closeAttractionModal, tripIdNum, user]);

  // Keep camera stable: avoid continuous auto-recenter / auto-fit loops.
  // Camera actions stay user-driven (locate/fit/zoom) plus initial one-time fit.

  if (accessChecking) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={styles.muted}>Checking trip permissions...</Text>
      </View>
    );
  }

  if (tripLoading || !trip) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.text} />
        <Text style={styles.muted}>{tripLoading ? "Loading trip..." : "Trip not found"}</Text>
      </View>
    );
  }

  if (accessDenied) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top, paddingHorizontal: 24 }]}>
        <Ionicons name="warning-outline" size={40} color="#fbbf24" style={{ marginBottom: 12 }} />
        <Text style={styles.title}>Live access denied</Text>
        <Text style={[styles.muted, { textAlign: "center", marginBottom: 20 }]}>{accessDenied}</Text>
        <Pressable style={styles.primaryBtn} onPress={() => navigation.navigate("TripDetail", { id })}>
          <Text style={styles.primaryBtnText}>Go to trip</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, styles.outlineBtn, { marginTop: 10 }]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.outlineBtnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === "waiting") {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.waitHeader}>
          <View style={styles.waitHeaderLeft}>
            <View style={styles.pulseDot} />
            <Text style={styles.waitTitle}>Waiting Room</Text>
            <View style={styles.preTripBadge}>
              <Text style={styles.preTripBadgeText}>{pausedFromLive ? "PAUSED" : "PRE-TRIP"}</Text>
            </View>
          </View>
          <View style={styles.waitHeaderRight}>
            <Text style={styles.metaSmall}>
              {arrivedCount}/{totalCount} at meetup
            </Text>
            <Pressable
              onPress={() => setShowExitConfirm(true)}
              style={styles.iconBtn}
              hitSlop={12}
            >
              <Ionicons name="close" size={18} color="rgba(255,255,255,0.45)" />
            </Pressable>
          </View>
        </View>

        <ScrollView style={styles.flex} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {pausedFromLive ? (
            <View style={styles.pausedBanner}>
              <Ionicons name="pause-circle" size={18} color="#fbbf24" />
              <Text style={styles.pausedBannerText}>
                Trip paused - you are back in the waiting room. Resume to return to live tracking.
              </Text>
            </View>
          ) : null}
          <View style={styles.bannerWrap}>
            <Image
              source={{ uri: `https://picsum.photos/seed/${encodeURIComponent(bannerSeed)}/800/300` }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
            <View style={styles.bannerGrad} />
            <View style={styles.bannerTextBox}>
              <Text style={styles.bannerTheme}>{(trip.theme || "Adventure").toUpperCase()}</Text>
              <Text style={styles.bannerName}>{trip.name}</Text>
              <View style={styles.row}>
                <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.5)" />
                <Text style={styles.bannerLoc}>{trip.meetupPoint || "Meetup TBD"}</Text>
              </View>
            </View>
          </View>

          <View style={styles.pad}>
            <Text style={styles.sectionLabel}>Organizer Controls</Text>

            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>GROUP COMMS</Text>
                  <Text style={styles.mutedSmall}>
                    {members.filter((m) => m.status !== "absent").length} members active
                  </Text>
                </View>
                <View style={[styles.connBadge, isInVoice && styles.connBadgeOn]}>
                  <Text style={[styles.connBadgeText, isInVoice && { color: "#34d399" }]}>
                    {isInVoice ? "Voice Connected" : "Not Connected"}
                  </Text>
                </View>
              </View>
              {isExpoGo ? (
                <Text style={[styles.mutedSmall, { marginTop: 6, color: "rgba(255,255,255,0.42)" }]} numberOfLines={4}>
                  Expo Go does not include WebRTC, so there is no live mic audio here. Talk mode, raise hand, and other
                  controls still sync over the network. For real voice, build a dev client:{" "}
                  <Text style={{ fontWeight: "700", color: "rgba(255,255,255,0.55)" }}>npx expo run:android</Text> or{" "}
                  <Text style={{ fontWeight: "700", color: "rgba(255,255,255,0.55)" }}>npx expo run:ios</Text>.
                </Text>
              ) : null}

              <View style={styles.voiceRow}>
                <Pressable
                  disabled={!canModerateVoice}
                  onPress={() => void setVoiceMode("open")}
                  style={[styles.voicePill, voiceMode === "open" && styles.voicePillActive]}
                >
                  <Text style={[styles.voicePillText, voiceMode === "open" && styles.voicePillTextOn]}>
                    Talk All
                  </Text>
                </Pressable>
                <Pressable
                  disabled={!canModerateVoice}
                  onPress={() => void setVoiceMode("controlled")}
                  style={[styles.voicePill, voiceMode === "controlled" && styles.voicePillActive]}
                >
                  <Text
                    style={[styles.voicePillText, voiceMode === "controlled" && styles.voicePillTextOn]}
                  >
                    Staff Talk
                  </Text>
                </Pressable>
              </View>

              {!isInVoice ? (
                <Pressable
                  style={styles.joinVoice}
                  onPress={() => void joinVoiceChannel()}
                  disabled={voiceConnecting}
                >
                  <Text style={styles.joinVoiceText}>
                    {voiceConnecting ? "Connecting…" : "Join Voice Channel"}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.row}>
                  <Pressable
                    style={[styles.joinVoice, { flex: 1, backgroundColor: "rgba(255,255,255,0.06)" }]}
                    onPress={() => leaveVoiceChannel()}
                  >
                    <Text style={[styles.joinVoiceText, { color: "rgba(255,255,255,0.75)" }]}>
                      Disconnect
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={localMuted && !localAllowedInControlled}
                    onPress={() => localMemberId && toggleMuteWithVoiceRules(localMemberId)}
                    style={[styles.muteBtn, !localMuted && styles.muteBtnHot]}
                  >
                    <Text style={{ color: localMuted ? "rgba(255,255,255,0.75)" : "#fca5a5", fontWeight: "700", fontSize: 12 }}>
                      {localMuted ? "Unmute" : "Mute"}
                    </Text>
                  </Pressable>
                </View>
              )}

              {isInVoice ? (
                <View style={[styles.connBadge, styles.connBadgeOn, { marginTop: 8 }]}>
                  <Text style={[styles.connBadgeText, { color: "#34d399" }]}>
                    🎙 {voiceRiders.length + 1} in voice
                  </Text>
                </View>
              ) : null}

              {isInVoice && voiceMode === "controlled" && (
                <>
                  {!canModerateVoice ? (
                    localMemberId ? (
                      <Pressable
                        disabled={localAllowedInControlled || speakRequests.includes(localMemberId)}
                        onPress={requestToSpeak}
                        style={styles.raiseHand}
                      >
                        <Text style={styles.raiseHandText}>
                          {localAllowedInControlled
                            ? "Approved to speak"
                            : speakRequests.includes(localMemberId)
                              ? "Request Sent"
                              : "Raise Hand (Request to Speak)"}
                        </Text>
                      </Pressable>
                    ) : null
                  ) : (
                    <View style={{ marginTop: 8 }}>
                      <Text style={styles.cardTitle}>SPEAK REQUESTS</Text>
                      {speakRequests.length === 0 ? (
                        <Text style={[styles.mutedSmall, { marginTop: 6 }]}>No requests yet</Text>
                      ) : (
                        speakRequests.map((rid) => {
                          const rm = members.find((m) => m.id === rid);
                          if (!rm) return null;
                          return (
                            <View key={rid} style={styles.reqRow}>
                              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 12, flex: 1 }} numberOfLines={1}>
                                {rm.name}
                              </Text>
                              <Pressable onPress={() => allowSpeakerAndUnmute(rid)} style={styles.miniAllow}>
                                <Text style={{ color: "#34d399", fontWeight: "700", fontSize: 10 }}>Allow</Text>
                              </Pressable>
                              <Pressable onPress={() => denySpeakerOnly(rid)} style={styles.miniDeny}>
                                <Text style={{ color: "#f87171", fontWeight: "700", fontSize: 10 }}>Deny</Text>
                              </Pressable>
                            </View>
                          );
                        })
                      )}
                    </View>
                  )}
                </>
              )}

              <View style={{ marginTop: 12, gap: 8 }}>
                {members
                  .filter((m) => m.status !== "absent")
                  .map((m) => {
                    const rs = roleBadgeStyle(m.role);
                    return (
                      <View key={m.id} style={styles.memberRow}>
                        <Image
                          source={{
                            uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(m.avatar)}`,
                          }}
                          style={styles.avatar}
                        />
                        <View style={{ flex: 1 }}>
                          <View style={styles.rowBetween}>
                            <Text style={styles.memberName} numberOfLines={1}>
                              {m.name}
                            </Text>
                            <View style={[styles.rolePill, { borderColor: rs.borderColor, backgroundColor: rs.bg }]}>
                              <Text style={[styles.rolePillText, { color: rs.color }]}>{m.role}</Text>
                            </View>
                          </View>
                          <Text style={styles.mutedSmall}>• Idle</Text>
                        </View>
                      </View>
                    );
                  })}
              </View>
            </View>

            <View style={[styles.card, { marginTop: 12 }]}>
              <Pressable
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                onPress={() => setCheckpointsSectionOpen((s) => !s)}
              >
                <Text style={styles.cardTitle}>CHECKPOINTS ({checkpoints.length})</Text>
                <Text style={{ color: "rgba(255,255,255,0.45)" }}>{checkpointsSectionOpen ? "▼" : "▶"}</Text>
              </Pressable>
              {checkpointsSectionOpen ? (
                checkpoints.length === 0 ? (
                  <Text style={[styles.mutedSmall, { marginTop: 8 }]}>No checkpoints yet.</Text>
                ) : (
                  waitingCheckpointList.map(({ cp, distM, reached, distKind }, i) => {
                      const startLat = trip?.meetupLat;
                      const startLng = trip?.meetupLng;
                      let distLabel = "";
                      if (
                        startLat != null &&
                        startLng != null &&
                        Number.isFinite(Number(startLat)) &&
                        Number.isFinite(Number(startLng))
                      ) {
                        const fromStart = haversineDistance(
                          Number(startLat),
                          Number(startLng),
                          cp.lat,
                          cp.lng,
                        );
                        distLabel = ` · ${formatDistance(fromStart)} from start`;
                      }
                      const sortDistLabel =
                        distKind === "you"
                          ? ` · ${formatDistance(distM)} from you`
                          : distKind === "meetup"
                            ? ` · ${formatDistance(distM)} from meetup`
                            : "";
                      return (
                        <View key={cp.id} style={[styles.cpRow, reached && { opacity: 0.45 }]}>
                          <View style={[styles.cpIdx, reached && styles.cpIdxOn]}>
                            <Text style={{ fontSize: 10, fontWeight: "700" }}>{reached ? "✓" : i + 1}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }} numberOfLines={2}>
                              {cp.name}
                            </Text>
                            {cp.description ? (
                              <Text style={[styles.mutedSmall, { marginTop: 2 }]} numberOfLines={2}>
                                {cp.description}
                              </Text>
                            ) : null}
                            <Text style={[styles.mutedSmall, { marginTop: 2 }]}>
                              {cp.source === "nearby_attraction" ? "★ Community discovery" : ""}
                              {cp.source === "map_pin" ? "📌 Member pin" : ""}
                              {distLabel}
                              {sortDistLabel}
                            </Text>
                          </View>
                        </View>
                      );
                    })
                )
              ) : null}
              {checkpointsSectionOpen && canSendLineupFormation ? (
                <Pressable
                  style={[styles.primaryBtn, styles.outlineBtn, { marginTop: 10 }]}
                  onPress={() =>
                    Alert.alert("Manage checkpoints", "Reorder and delete from the trip tools on web for now.")
                  }
                >
                  <Text style={styles.outlineBtnText}>Manage</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.attendanceHeader}>
              {(["all", "arrived", "pending"] as const).map((tab) => (
                <Pressable
                  key={tab}
                  onPress={() => setAttendanceTab(tab)}
                  style={[styles.attTab, attendanceTab === tab && styles.attTabOn]}
                >
                  <Text style={[styles.attTabText, attendanceTab === tab && styles.attTabTextOn]}>
                    {tab}{" "}
                    {tab === "arrived"
                      ? `(${arrivedCount})`
                      : tab === "pending"
                        ? `(${members.filter((x) => x.status === "on-way").length})`
                        : `(${totalCount})`}
                  </Text>
                </Pressable>
              ))}
              <View style={styles.liveMini}>
                <View style={styles.liveMiniDot} />
                <Text style={styles.liveMiniText}>{arrivedCount} LIVE</Text>
              </View>
            </View>

            {members
              .filter((m) =>
                attendanceTab === "all"
                  ? true
                  : attendanceTab === "arrived"
                    ? m.status === "arrived"
                    : m.status !== "arrived",
              )
              .map((member) => {
                const rs = roleBadgeStyle(member.role);
                const roleLabel =
                  member.role === "organizer" || member.role === "admin"
                    ? "Admin"
                    : member.role === "co-admin"
                      ? "Co-Admin"
                      : member.role === "moderator"
                        ? "Moderator"
                        : "Member";
                return (
                  <View
                    key={`att-${member.id}`}
                    style={[
                      styles.attCard,
                      member.status === "arrived" && styles.attCardOk,
                      member.status === "on-way" && styles.attCardWay,
                    ]}
                  >
                    <View style={styles.row}>
                      <View>
                        <Image
                          source={{
                            uri: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(member.avatar)}`,
                          }}
                          style={styles.avatarLg}
                        />
                        <View
                          style={[
                            styles.statusDot,
                            member.status === "arrived"
                              ? { backgroundColor: "#34d399" }
                              : member.status === "on-way"
                                ? { backgroundColor: "#fbbf24" }
                                : { backgroundColor: "rgba(255,255,255,0.25)" },
                          ]}
                        />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.memberName}>{member.name}</Text>
                        <View style={styles.row}>
                          <View style={[styles.rolePill, { borderColor: rs.borderColor, backgroundColor: rs.bg }]}>
                            <Text style={[styles.rolePillText, { color: rs.color }]}>{roleLabel}</Text>
                          </View>
                          <Text style={styles.mutedSmall}>
                            {member.status === "arrived"
                              ? "✓ Arrived"
                              : member.status === "on-way"
                                ? "→ On Way"
                                : "✗ Absent"}
                          </Text>
                        </View>
                        {(canModerateVoice || (localMemberId && member.id === localMemberId)) && (
                          <View style={styles.modRow}>
                            <Pressable
                              onPress={() => toggleMuteWithVoiceRules(member.id)}
                              style={styles.modBtn}
                            >
                              <Text style={styles.modBtnText}>{member.muted ? "Unmute" : "Mute"}</Text>
                            </Pressable>
                            {canModerateVoice && (
                              <>
                                <Pressable onPress={() => toggleBlock(member.id)} style={styles.modBtn}>
                                  <Text style={styles.modBtnText}>{member.blocked ? "Unblock" : "Block"}</Text>
                                </Pressable>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                                  <View style={styles.row}>
                                    {(["member", "moderator", "co-admin"] as const).map((r) => (
                                      <Pressable
                                        key={r}
                                        onPress={() => assignRole(member.id, r)}
                                        style={[
                                          styles.rolePick,
                                          member.role === r && styles.rolePickOn,
                                        ]}
                                      >
                                        <Text
                                          style={{
                                            fontSize: 9,
                                            fontWeight: "700",
                                            color: member.role === r ? "#000" : "rgba(255,255,255,0.45)",
                                            textTransform: "capitalize",
                                          }}
                                        >
                                          {r}
                                        </Text>
                                      </Pressable>
                                    ))}
                                  </View>
                                </ScrollView>
                              </>
                            )}
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
          </View>
        </ScrollView>

        <View style={[styles.beginWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {pausedFromLive ? (
            <Pressable
              style={styles.beginBtn}
              onPress={() => {
                setPausedFromLive(false);
                setPhase("live");
                emitLiveLocationSnapshot();
              }}
            >
              <Ionicons name="play" size={18} color="#000" />
              <Text style={styles.beginBtnText}>Resume trip</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.beginBtn, !isOrganizer && !tripStarted && { opacity: 0.45 }]}
              onPress={() => void startTripLive()}
              disabled={!isOrganizer && !tripStarted}
            >
              <Ionicons name={isOrganizer ? "navigate" : "play"} size={18} color="#000" />
              <Text style={styles.beginBtnText}>
                {isOrganizer ? "Start trip & go live" : tripStarted ? "Join Live Journey" : "Waiting for organizer"}
              </Text>
            </Pressable>
          )}
          <Text style={styles.beginHint}>
            {isOrganizer
              ? `${arrivedCount}/${totalCount} members ready`
              : tripStarted
                ? "Organizer started this trip, you can now go live."
                : "Organizer must start trip before anyone can go live."}
          </Text>
        </View>

        <Modal visible={showExitConfirm} transparent animationType="fade">
          <Pressable style={styles.modalBackdrop} onPress={() => setShowExitConfirm(false)}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>Leave waiting room?</Text>
              <Text style={styles.mutedSmall}>You can rejoin from the trip anytime.</Text>
              <View style={styles.modalActions}>
                <Pressable style={[styles.primaryBtn, styles.outlineBtn]} onPress={() => setShowExitConfirm(false)}>
                  <Text style={styles.outlineBtnText}>Stay</Text>
                </Pressable>
                <Pressable style={styles.primaryBtn} onPress={onLeave}>
                  <Text style={styles.primaryBtnText}>Leave</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  /* ─── LIVE PHASE ─── */
  const h = Dimensions.get("window").height;
  const { liveRoutePoints, startPoint, endPoint } = mapRouteGeometry;
  /** Plot other riders whenever we have a non-zero fix. */
  const convoyMarkerCoords = (m: LiveMember): { lat: number; lng: number } | null => {
    const lat = toNum(m.lat);
    const lng = toNum(m.lng);
    if (lat == null || lng == null) return null;
    if (Math.abs(lat) <= 1e-5 && Math.abs(lng) <= 1e-5) return null;
    return { lat, lng };
  };
  const dedupedForPins = dedupeMembersForMapPins(members);
  const mapMembersRaw = dedupedForPins
    .filter((m) => !liveMemberRowIsSelf(m, appUid, localMemberId))
    .map((m) => {
      const c = convoyMarkerCoords(m);
      if (!c) return null;
      const i = dedupedForPins.findIndex((x) => canonicalMemberIdStr(x) === canonicalMemberIdStr(m));
      return {
        id: canonicalMemberIdStr(m),
        name: m.name,
        lat: c.lat,
        lng: c.lng,
        speed: m.speed,
        color: RIDER_PIN_COLORS[(i >= 0 ? i : 0) % RIDER_PIN_COLORS.length],
      };
    })
    .filter((m): m is MapMember => m != null);
  const selfPinForSpread =
    userGeo != null ? { lat: userGeo.lat, lng: userGeo.lng } : lastPosRef.current;
  const mapMembers = spreadPeersForMap(mapMembersRaw, selfPinForSpread);
  const effectiveUserGeo =
    userGeo ??
    (lastPosRef.current
      ? {
          lat: lastPosRef.current.lat,
          lng: lastPosRef.current.lng,
          accuracyM: undefined,
          headingDeg: null,
          speedMps: null,
        }
      : null);

  return (
    <View style={styles.liveRoot}>
      <LiveMapView
        ref={liveMapRef}
        dark={mode === "dark"}
        route={liveRoutePoints}
        start={startPoint}
        end={endPoint}
        members={mapMembers}
        pins={mapOverlayPins}
        activeRouteSegment={activeRouteSegmentPoints}
        fitTick={mapFitTick}
        recenterPoint={mapRecenterPoint}
        userGeo={effectiveUserGeo}
        onMapError={(msg) => setMapDiag(msg)}
      />

      {mapPinCrosshair ? (
        <View style={styles.crosshairWrap} pointerEvents="box-none">
          <Pressable
            delayLongPress={500}
            onLongPress={() => {
              const pos = lastPosRef.current;
              if (!pos) {
                Alert.alert("Location", "Wait for GPS or use Re-centre.");
                return;
              }
              setShowMapPinRequestModal(true);
            }}
            style={styles.crosshairHit}
          >
            <View style={styles.crosshairRing} />
            <View style={styles.crosshairH} />
            <View style={styles.crosshairV} />
          </Pressable>
          <Text style={styles.crosshairHint}>
            Move map to your desired location, then long-press the crosshair (uses your GPS for this build).
          </Text>
        </View>
      ) : null}

      {mapDiag ? (
        <View style={[styles.mapDiagBadge, { top: insets.top + 52 }]}>
          <Text style={styles.mapDiagText} numberOfLines={2}>
            {mapDiag}
          </Text>
        </View>
      ) : null}
      {!sheetBlocking ? (
        <Pressable style={[styles.recenterPill, { bottom: Math.max(insets.bottom + 210, 220) }]} onPress={() => void handleRecenter()}>
          <Ionicons name="navigate" size={20} color="#0f7a8a" />
          <Text style={styles.recenterPillText}>Re-centre</Text>
        </Pressable>
      ) : null}

      <View style={[styles.liveTopBar, { top: insets.top + 8 }]}>
        <Pressable style={styles.mapCircleBtn} onPress={() => setShowExitConfirm(true)}>
          <Ionicons name="chevron-down" size={22} color="#fff" />
        </Pressable>
        <View style={styles.liveTopTitleWrap}>
          <Text style={styles.liveTopTitle} numberOfLines={1}>
            Convoy live
          </Text>
          {drivingRoute?.distanceMeters != null && drivingRoute.distanceMeters > 0 ? (
            <Text style={styles.liveTopSub} numberOfLines={1}>
              Route ~{(drivingRoute.distanceMeters / 1000).toFixed(1)} km
              {drivingRoute.durationSeconds != null
                ? ` · ~${Math.round(drivingRoute.durationSeconds / 60)} min`
                : ""}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={styles.alertHistoryBtn}
          onPress={() => {
            setShowAlertHistoryModal(true);
            setUnreadAlertCount(0);
          }}
        >
          <Ionicons name="notifications-outline" size={20} color="#fff" />
          {unreadAlertCount > 0 ? (
            <View style={styles.alertBadge}>
              <Text style={styles.alertBadgeText}>{Math.min(99, unreadAlertCount)}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={[styles.mapLeftCol, { top: mapControlsTop }]}>
        <Pressable style={styles.mapCircleBtn} onPress={toggleMode}>
          <Ionicons name={mode === "dark" ? "moon" : "sunny"} size={20} color="#fff" />
        </Pressable>
      </View>

      {!sheetBlocking ? (
        <View style={[styles.mapRightCol, { top: mapControlsTop }]}>
          <Pressable style={styles.mapCircleBtn} onPress={() => liveMapRef.current?.zoomBy(1)}>
            <Ionicons name="add" size={20} color="#fff" />
          </Pressable>
          <Pressable style={styles.mapCircleBtn} onPress={() => liveMapRef.current?.zoomBy(-1)}>
            <Ionicons name="remove" size={20} color="#fff" />
          </Pressable>
          <Pressable style={styles.mapCircleBtn} onPress={() => liveMapRef.current?.togglePitch()}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>3D</Text>
          </Pressable>
          <Pressable style={styles.mapCircleBtn} onPress={() => void handleRecenter()}>
            <Ionicons name="locate" size={20} color="#fff" />
          </Pressable>
          <Pressable
            style={styles.mapCircleBtn}
            onPress={() => {
              fitConvoy();
              liveMapRef.current?.fitConvoy();
            }}
            accessibilityLabel="Fit route and riders"
          >
            <Ionicons name="expand-outline" size={20} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      <Animated.View
        style={[
          styles.liveSheet,
          {
            height: sheetHeightAnim,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
        {...sheetPanResponder.panHandlers}
      >
        <Pressable style={styles.sheetHandle} onPress={() => setSheetExpanded((s) => !s)}>
          <View style={styles.sheetGrabber} />
          <Ionicons
            name={sheetExpanded ? "chevron-down" : "chevron-up"}
            size={14}
            color="rgba(255,255,255,0.45)"
            style={{ marginTop: 4 }}
          />
        </Pressable>
        {!sheetExpanded ? (
          <>
            <View style={styles.peekRow}>
              <View style={styles.peekMetricSide}>
                <Text style={styles.metricBig}>{formatElapsedStrava(elapsedSec)}</Text>
                <Text style={styles.metricLabel}>TIME</Text>
              </View>
              <View style={styles.peekPauseCenter}>
                <Pressable onPress={() => !endingTrip && goToPausedWaiting()}>
                  <View style={styles.pauseOuter}>
                    <View style={styles.pauseInner}>
                      <Ionicons name="pause" size={28} color="#fff" />
                    </View>
                  </View>
                </Pressable>
              </View>
              <View style={[styles.peekMetricSide, { alignItems: "flex-end" }]}>
                <Text style={styles.metricBig}>{myDistanceKm.toFixed(1)}</Text>
                <Text style={styles.metricLabel}>DISTANCE (KM)</Text>
              </View>
            </View>
            <View style={styles.peekActions}>
              <Pressable
                style={styles.dangerOutline}
                onPress={() => {
                  setSheetExpanded(false);
                  setShowSosModal(true);
                }}
              >
                <Ionicons name="warning" size={14} color="#f87171" />
                <Text style={styles.dangerOutlineText}>SOS</Text>
              </Pressable>
              <View style={styles.dangerOutline}>
                <View style={styles.liveDot} />
                <Text style={styles.dangerOutlineText}>LIVE</Text>
              </View>
              <Pressable
                style={styles.dangerOutline}
                disabled={endingTrip}
                onPress={() => {
                  Alert.alert("End trip", "End this trip for everyone?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "End trip", style: "destructive", onPress: () => void endTrip() },
                  ]);
                }}
              >
                <Text style={styles.dangerOutlineText}>End trip</Text>
              </Pressable>
            </View>
            <Text style={styles.swipeHint}>Swipe up for convoy controls</Text>
          </>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 8 }}
            onScroll={(e) => {
              sheetScrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            nestedScrollEnabled
            bounces={false}
            overScrollMode="never"
          >
            <View style={styles.statusBanner}>
              <View style={styles.gpsDot} />
              <Text style={styles.statusBannerText}>Live GPS tracking</Text>
              <Text style={styles.statusBannerMuted}> · Convoy sync</Text>
            </View>
            <View style={styles.metrics2}>
              <View>
                <Text style={styles.metricBig}>{formatElapsedStrava(elapsedSec)}</Text>
                <Text style={styles.metricLabel}>TIME</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.metricBig}>{myDistanceKm.toFixed(1)}</Text>
                <Text style={styles.metricLabel}>DISTANCE (KM)</Text>
              </View>
            </View>
            <View style={styles.iconRow}>
              <Pressable
                style={styles.roundIcon}
                onPress={() => {
                  setSheetExpanded(false);
                  setShowSosModal(true);
                }}
              >
                <Ionicons name="warning" size={22} color="#fff" />
              </Pressable>
              <Pressable style={styles.roundIcon} onPress={() => emitConvoy("regroup-ping")}>
                <Ionicons name="notifications" size={22} color="#fbbf24" />
              </Pressable>
              <Pressable onPress={() => !endingTrip && goToPausedWaiting()}>
                <View style={styles.pauseOuterLg}>
                  <View style={styles.pauseInnerLg}>
                    <Ionicons name="pause" size={32} color="#fff" />
                  </View>
                </View>
              </Pressable>
              <Pressable
                style={[styles.roundIcon, mapPinCrosshair && { borderWidth: 2, borderColor: "#c084fc" }]}
                onPress={() => setMapPinCrosshair((x) => !x)}
              >
                <Ionicons name="location" size={22} color="#c084fc" />
                {pinRequestQueue.length > 0 && canSendLineupFormation ? (
                  <View style={[styles.alertBadgeInline, { position: "absolute", top: -4, right: -4 }]}>
                    <Text style={styles.alertBadgeText}>{Math.min(9, pinRequestQueue.length)}</Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                style={[styles.roundIcon, !canSendLineupFormation && { opacity: 0.35 }]}
                onPress={() => emitConvoy("line-up-formation")}
                disabled={!canSendLineupFormation}
              >
                <Ionicons name="list" size={22} color="#2dd4bf" />
              </Pressable>
            </View>
            <View style={styles.liveChipRow}>
              <View style={styles.liveChip}>
                <View style={styles.liveDot} />
                <Text style={styles.liveChipText}>LIVE</Text>
              </View>
              <Pressable
                style={styles.liveChip}
                onPress={() => {
                  setShowAlertHistoryModal(true);
                  setUnreadAlertCount(0);
                }}
              >
                <Ionicons name="notifications-outline" size={14} color="#fff" />
                <Text style={styles.liveChipText}>Alerts</Text>
                {unreadAlertCount > 0 ? (
                  <View style={styles.alertBadgeInline}>
                    <Text style={styles.alertBadgeText}>{Math.min(99, unreadAlertCount)}</Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                style={styles.endTripChip}
                disabled={endingTrip}
                onPress={() =>
                  Alert.alert("End trip", "End this trip for everyone?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "End trip", style: "destructive", onPress: () => void endTrip() },
                  ])
                }
              >
                <Text style={styles.endTripChipText}>End trip</Text>
              </Pressable>
            </View>
            <View style={styles.settingsCard}>
              <View style={styles.setRowTall}>
                <View style={styles.setIconCol}>
                  <Ionicons
                    name="flag-outline"
                    size={22}
                    color={nextCheckpointInfo?.isCurrent ? "#fbbf24" : "#2dd4bf"}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.setLabel,
                      nextCheckpointInfo?.isCurrent ? { color: "#fbbf24" } : null,
                    ]}
                  >
                    {nextCheckpointInfo?.isCurrent ? "You are here" : "Next checkpoint"}
                  </Text>
                  {nextCheckpointInfo ? (
                    <>
                      <Text style={styles.setSub} numberOfLines={2}>
                        {nextCheckpointInfo.next.name}
                      </Text>
                      <Text style={styles.setSub}>
                        {nextCheckpointInfo.next.clientDistanceM == null
                          ? "Waiting for GPS…"
                          : nextCheckpointInfo.isCurrent
                            ? `You are here · ${formatDistance(nextCheckpointInfo.distanceM)}`
                            : `${formatDistance(nextCheckpointInfo.distanceM)} from you`}
                        {nextCheckpointInfo.next.clientDistanceM != null &&
                        !nextCheckpointInfo.isCurrent &&
                        nextCheckpointInfo.etaMin != null &&
                        nextCheckpointInfo.etaMin > 0
                          ? ` · ~${Math.max(1, Math.round(nextCheckpointInfo.etaMin))} min at current pace`
                          : ""}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.setSub}>No checkpoints for this trip yet.</Text>
                  )}
                </View>
              </View>
              <View style={styles.setRowTall}>
                <View style={styles.setIconCol}>
                  <Ionicons name="partly-sunny-outline" size={22} color="rgba(255,255,255,0.75)" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.setLabel}>Weather</Text>
                  {weatherLoading ? (
                    <Text style={styles.setSub}>Loading…</Text>
                  ) : weather ? (
                    <Text style={styles.setSub}>
                      {weather.label} · {weather.tempC}°C · wind {weather.windKmh} km/h
                    </Text>
                  ) : (
                    <Text style={styles.setSub}>Open the sheet at your position to load weather.</Text>
                  )}
                </View>
              </View>
              {canSaveNearbyAttraction ? (
                <Pressable style={styles.setRowTall} onPress={() => setShowAttractionModal(true)}>
                  <View style={styles.setIconCol}>
                    <Ionicons name="star-outline" size={22} color="rgba(255,255,255,0.75)" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.setLabel}>Mark nearby attraction</Text>
                    <Text style={styles.setSub}>Save a discovered place for organizers (checkpoints).</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
                </Pressable>
              ) : null}
            </View>
            <Text style={[styles.sectionRouteTitle, { marginBottom: 8 }]}>ROUTE · CHECKPOINT TIMELINE</Text>
            {routeTimeline.length === 0 ? (
              <Text style={[styles.mutedSmall, { textAlign: "center", padding: 12 }]}>
                No checkpoints yet. Organizers can add them when creating the event.
              </Text>
            ) : (
              routeTimeline.map((row) => (
                <View key={row.cp.id} style={[styles.timelineRow, row.reached && { opacity: 0.45 }]}>
                  <View style={styles.timelineDot}>
                    <Text
                      style={[
                        styles.timelineOrder,
                        row.isCurrent && { color: "#fbbf24", fontSize: 14 },
                        row.isNext && !row.isCurrent && { color: "#00E5B0" },
                      ]}
                    >
                      {row.reached ? "✓" : row.isCurrent ? "●" : row.isNext ? "→" : "○"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.timelineName,
                        row.isCurrent && { color: "#fbbf24" },
                        row.isNext && !row.isCurrent && { color: "#00E5B0" },
                        row.reached && { color: "rgba(255,255,255,0.45)" },
                      ]}
                    >
                      {row.order}. {row.cp.name}
                    </Text>
                    <Text style={styles.setSub}>
                      {row.reached
                        ? `Passed · ${
                            row.cp.clientDistanceM == null ? "—" : `${formatDistance(row.distM)} from you`
                          }`
                        : row.isCurrent
                          ? `You are here · ${
                              row.cp.clientDistanceM == null ? "—" : formatDistance(row.distM)
                            }`
                          : row.cp.clientDistanceM == null
                            ? "—"
                            : `${formatDistance(row.distM)} from you`}
                      {row.cp.source === "nearby_attraction" ? " · ★ community" : ""}
                      {row.cp.source === "map_pin" ? " · 📌 member pin" : ""}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </Animated.View>

      <Modal visible={showSosModal} transparent animationType="slide">
        <Pressable style={[styles.modalBackdrop, styles.modalBackdropBottom]} onPress={() => setShowSosModal(false)}>
          <Pressable
            style={[styles.sosSheet, { paddingBottom: Math.max(insets.bottom + 10, 18) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.sosSheetHandle} />
            <View style={styles.sosSheetHeader}>
              <Text style={styles.sosSheetTitle}>SOS Alert</Text>
              <Pressable style={styles.sosCloseBtn} onPress={() => setShowSosModal(false)}>
                <Ionicons name="close" size={24} color="rgba(255,255,255,0.75)" />
              </Pressable>
            </View>
            <Text style={styles.sosSheetSubtitle}>
              This will broadcast an emergency alert to all trip members and the organizer.
            </Text>
            <View style={styles.sosSheetGrid}>
              {SOS_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.id}
                  style={styles.sosTile}
                  onPress={() => {
                    if (opt.id === "other") {
                      const reason = sosOtherReason.trim();
                      if (!reason) {
                        Alert.alert("SOS", "Please type the reason for Other.");
                        return;
                      }
                      emitConvoy("sos:Other", { details: reason });
                    } else {
                      emitConvoy(`sos:${opt.reason}`, { reason: opt.reason });
                    }
                    setShowSosModal(false);
                    setSosOtherReason("");
                  }}
                >
                  <View style={styles.sosTileIconWrap}>
                    <Text style={styles.sosTileIcon}>{opt.icon}</Text>
                  </View>
                  <Text style={styles.sosTileText}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={[styles.textInputDark, { marginTop: 12, borderColor: "rgba(225,29,72,0.35)" }]}
              placeholder="Other reason (required for Other)"
              placeholderTextColor="rgba(255,255,255,0.38)"
              value={sosOtherReason}
              onChangeText={setSosOtherReason}
            />
            <Pressable
              style={[styles.primaryBtn, { marginTop: 10 }]}
              onPress={() => {
                const reason = sosOtherReason.trim();
                if (!reason) {
                  Alert.alert("SOS", "Please type the reason for Other.");
                  return;
                }
                emitConvoy("sos:Other", { details: reason });
                setShowSosModal(false);
                setSosOtherReason("");
              }}
            >
              <Text style={styles.primaryBtnText}>Send</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!activeAlert} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setActiveAlert(null)}>
          <Pressable style={styles.alertCardDark} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.alertCardTitle}>{activeAlert?.title ?? "Alert"}</Text>
            <Text style={styles.alertCardMeta}>
              From: {activeAlert?.actorName || "Unknown"} •{" "}
              {activeAlert ? new Date(activeAlert.atIso).toLocaleTimeString() : ""}
            </Text>
            <Text style={styles.alertCardMessage}>{activeAlert?.message}</Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.alertCardDismissBtn} onPress={() => setActiveAlert(null)}>
                <Text style={styles.alertCardDismissText}>Dismiss</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!sentAlertPopup} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setSentAlertPopup(null)}>
          <Pressable style={styles.alertCardDark} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.alertCardTitle}>{sentAlertPopup?.title ?? "Alert sent"}</Text>
            <Text style={styles.alertCardMeta}>
              {sentAlertPopup ? new Date(sentAlertPopup.atIso).toLocaleTimeString() : ""}
            </Text>
            <Text style={styles.alertCardMessage}>{sentAlertPopup?.message}</Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.alertCardDismissBtn} onPress={() => setSentAlertPopup(null)}>
                <Text style={styles.alertCardDismissText}>Dismiss</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showAlertHistoryModal} transparent animationType="slide">
        <Pressable style={[styles.modalBackdrop, styles.modalBackdropBottom]} onPress={() => setShowAlertHistoryModal(false)}>
          <Pressable style={[styles.sosSheet, { paddingBottom: Math.max(insets.bottom + 10, 18) }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sosSheetHeader}>
              <Text style={styles.sosSheetTitle}>Alert History</Text>
              <Pressable style={styles.sosCloseBtn} onPress={() => setShowAlertHistoryModal(false)}>
                <Ionicons name="close" size={24} color="rgba(255,255,255,0.75)" />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {alertHistory.length === 0 ? (
                <Text style={styles.sosSheetSubtitle}>No alerts yet.</Text>
              ) : (
                alertHistory.map((a) => (
                  <View key={a.id} style={styles.alertHistoryRow}>
                    <Text style={styles.alertHistoryTitle}>{a.title}</Text>
                    <Text style={styles.alertHistoryMeta}>
                      {a.actorName} • {new Date(a.atIso).toLocaleString()}
                    </Text>
                    <Text style={styles.alertHistoryMessage}>{a.message}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showPinModal} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowPinModal(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Add map pin</Text>
            <Text style={styles.mutedSmall}>Type, label — uses your current GPS position.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 10 }}>
              {(["parking", "fuel", "attraction", "hazard", "road-damage"] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setPinType(t)}
                  style={[styles.typeChip, pinType === t && styles.typeChipOn]}
                >
                  <Text style={{ fontSize: 10, fontWeight: "800", color: pinType === t ? "#000" : "rgba(255,255,255,0.5)" }}>
                    {t}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <TextInput
              style={styles.textInputDark}
              placeholder="Label"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={pinLabel}
              onChangeText={setPinLabel}
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.primaryBtn, styles.outlineBtn]} onPress={() => setShowPinModal(false)}>
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={() => void submitMapPin()}>
                <Text style={styles.primaryBtnText}>Add pin</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showAttractionModal} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => closeAttractionModal()}>
          <Pressable style={[styles.modalCard, { maxHeight: "85%" }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Nearby attraction</Text>
            <Text style={styles.mutedSmall}>Name and description — saved for organizers.</Text>
            <Text style={[styles.mutedSmall, { marginTop: 6 }]}>
              GPS:{" "}
              {userGeo
                ? `${userGeo.lat.toFixed(5)}, ${userGeo.lng.toFixed(5)}`
                : lastPosRef.current
                  ? `${lastPosRef.current.lat.toFixed(5)}, ${lastPosRef.current.lng.toFixed(5)}`
                  : "—"}
            </Text>
            <TextInput
              style={styles.textInputDark}
              placeholder="Place name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={attrName}
              onChangeText={setAttrName}
            />
            <TextInput
              style={[styles.textInputDark, { minHeight: 80, marginTop: 8 }]}
              placeholder="What makes it special?"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={attrDesc}
              onChangeText={setAttrDesc}
              multiline
            />
            <Pressable
              style={[styles.primaryBtn, styles.outlineBtn, { marginTop: 10 }]}
              onPress={() => void pickAttractionImages()}
              disabled={attrSaving || attrImages.length >= 5}
            >
              <Text style={styles.outlineBtnText}>
                {attrImages.length > 0
                  ? `${attrImages.length} photo(s) selected — tap to add more`
                  : "+ Add photos (max 5)"}
              </Text>
            </Pressable>
            {attrImages.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 10 }}
                keyboardShouldPersistTaps="handled"
              >
                {attrImages.map((asset, idx) => (
                  <View key={`${asset.uri}-${idx}`} style={{ marginRight: 10 }}>
                    <Image
                      source={{ uri: asset.uri }}
                      style={{ width: 80, height: 60, borderRadius: 6, backgroundColor: "#111" }}
                      resizeMode="cover"
                    />
                    <Pressable
                      onPress={() => setAttrImages((prev) => prev.filter((_, i) => i !== idx))}
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        backgroundColor: "#dc2626",
                        borderRadius: 10,
                        width: 22,
                        height: 22,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      hitSlop={6}
                    >
                      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "800" }}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.primaryBtn, styles.outlineBtn]}
                onPress={() => closeAttractionModal()}
                disabled={attrSaving}
              >
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, attrSaving && { opacity: 0.65 }]}
                onPress={() => void submitAttraction()}
                disabled={attrSaving}
              >
                {attrSaving ? (
                  <Text style={styles.primaryBtnText}>
                    {attrImages.length > 0 ? "Uploading…" : "Saving…"}
                  </Text>
                ) : (
                  <Text style={styles.primaryBtnText}>Save</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showMapPinRequestModal} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowMapPinRequestModal(false)}>
          <Pressable style={[styles.modalCard, { maxHeight: "85%" }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Request map pin</Text>
            <Text style={styles.mutedSmall}>
              {canSendLineupFormation
                ? "Adds a checkpoint immediately for organizers and staff."
                : "Submit for organizer approval."}
            </Text>
            <TextInput
              style={[styles.textInputDark, { marginTop: 10 }]}
              placeholder="Label (checkpoint name)"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={mapPinLabel}
              onChangeText={setMapPinLabel}
            />
            <TextInput
              style={[styles.textInputDark, { marginTop: 8, minHeight: 72 }]}
              placeholder="Reason / notes"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={mapPinReason}
              onChangeText={setMapPinReason}
              multiline
            />
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.primaryBtn, styles.outlineBtn]}
                onPress={() => {
                  setShowMapPinRequestModal(false);
                  setMapPinReason("");
                  setMapPinLabel("");
                }}
              >
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, mapPinSubmitting && styles.primaryBtnDisabled]}
                disabled={mapPinSubmitting}
                onPress={() => void submitMapPinRequest()}
              >
                <Text style={[styles.primaryBtnText, mapPinSubmitting && { opacity: 0.75 }]}>
                  {mapPinSubmitting ? "Submitting…" : "Submit for approval"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={canSendLineupFormation && pinRequestQueue.length > 0} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <Pressable style={[styles.modalCard, { maxHeight: "88%" }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Pin request</Text>
            {pinRequestQueue[0] ? (
              <>
                <Text style={[styles.mutedSmall, { marginTop: 4 }]}>
                  From {pinRequestQueue[0].requestedBy.displayName}
                </Text>
                {pinRequestQueue.length > 1 ? (
                  <Text style={[styles.mutedSmall, { marginTop: 4 }]}>
                    {pinRequestQueue.length} pending pins — review the oldest first
                  </Text>
                ) : null}
                <Text style={{ marginTop: 10, color: "#fff", fontWeight: "700" }}>
                  {pinRequestQueue[0].label || "Map pin"}
                </Text>
                <Text style={{ marginTop: 8, color: "rgba(255,255,255,0.85)" }}>{pinRequestQueue[0].reason}</Text>
                <View style={{ flexDirection: "row", gap: 12, marginTop: 18 }}>
                  <Pressable
                    disabled={pinReviewUiLock}
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor: pinReviewFlash === "deny" ? "#dc2626" : "#b91c1c",
                        flex: 1,
                        opacity: pinReviewUiLock && pinReviewFlash !== "deny" ? 0.4 : 1,
                      },
                    ]}
                    onPress={() => reviewQueuedPinRequest("deny")}
                  >
                    <Text style={[styles.primaryBtnText, { color: "#fff" }]}>Deny</Text>
                  </Pressable>
                  <Pressable
                    disabled={pinReviewUiLock}
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor: pinReviewFlash === "approve" ? "#22c55e" : "#15803d",
                        flex: 1,
                        opacity: pinReviewUiLock && pinReviewFlash !== "approve" ? 0.4 : 1,
                      },
                    ]}
                    onPress={() => reviewQueuedPinRequest("approve")}
                  >
                    <Text style={[styles.primaryBtnText, { color: "#fff" }]}>Approve</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </Pressable>
        </View>
      </Modal>

      <Modal visible={showExitConfirm} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowExitConfirm(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Leave live trip?</Text>
            <Text style={styles.mutedSmall}>Your position will stop broadcasting when you leave.</Text>
            <View style={styles.modalActions}>
              <Pressable style={[styles.primaryBtn, styles.outlineBtn]} onPress={() => setShowExitConfirm(false)}>
                <Text style={styles.outlineBtnText}>Stay</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={onLeave}>
                <Text style={styles.primaryBtnText}>Leave</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {transientToast ? (
        <View
          style={[
            styles.toastBar,
            transientToast.tone === "success" && { backgroundColor: "rgba(22, 101, 52, 0.94)" },
            transientToast.tone === "warning" && { backgroundColor: "rgba(161, 98, 7, 0.94)" },
            transientToast.tone === "error" && { backgroundColor: "rgba(127, 29, 29, 0.94)" },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.toastText}>{transientToast.message}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toastBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 112,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    zIndex: 50,
  },
  toastText: { color: "#fff", fontSize: 14, fontWeight: "600", textAlign: "center" },
  crosshairWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    pointerEvents: "box-none",
  },
  crosshairHit: {
    width: 120,
    height: 120,
    justifyContent: "center",
    alignItems: "center",
  },
  crosshairRing: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
  },
  crosshairH: {
    position: "absolute",
    width: 72,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  crosshairV: {
    position: "absolute",
    width: 2,
    height: 72,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  crosshairHint: {
    position: "absolute",
    bottom: "38%",
    left: 16,
    right: 16,
    textAlign: "center",
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
  },
  root: { flex: 1, backgroundColor: "#000" },
  flex: { flex: 1 },
  centered: { flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" },
  muted: { color: "rgba(255,255,255,0.4)", marginTop: 12, fontSize: 14 },
  mutedSmall: { color: "rgba(255,255,255,0.35)", fontSize: 11 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  hero: { color: "#fff", fontSize: 22, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowBetween: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  waitHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(0,0,0,0.9)",
  },
  waitHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  waitHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fbbf24" },
  waitTitle: { color: "#fff", fontWeight: "700", fontSize: 14 },
  preTripBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
    backgroundColor: "rgba(251,191,36,0.1)",
  },
  preTripBadgeText: { color: "#fbbf24", fontSize: 10, fontWeight: "800" },
  metaSmall: { color: "rgba(255,255,255,0.4)", fontSize: 11 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerWrap: { height: 144, position: "relative", overflow: "hidden" },
  bannerGrad: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  bannerTextBox: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16 },
  bannerTheme: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.4)", letterSpacing: 1.2 },
  bannerName: { fontSize: 16, fontWeight: "800", color: "#fff", marginTop: 4 },
  bannerLoc: { fontSize: 11, color: "rgba(255,255,255,0.5)", marginLeft: 4 },
  pad: { padding: 16 },
  sectionLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 2,
    color: "rgba(255,255,255,0.2)",
    marginBottom: 10,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 14,
    padding: 12,
  },
  cardTitle: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.35)", letterSpacing: 1 },
  connBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  connBadgeOn: { borderColor: "rgba(52,211,153,0.35)", backgroundColor: "rgba(52,211,153,0.1)" },
  connBadgeText: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.5)" },
  voiceRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  voicePill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
  },
  voicePillActive: { backgroundColor: "#fff", borderColor: "#fff" },
  voicePillText: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.45)" },
  voicePillTextOn: { color: "#000" },
  joinVoice: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(52,211,153,0.12)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.25)",
    alignItems: "center",
  },
  joinVoiceText: { color: "#6ee7b7", fontSize: 12, fontWeight: "800" },
  muteBtn: {
    marginLeft: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  muteBtnHot: { borderColor: "rgba(248,113,113,0.35)", backgroundColor: "rgba(248,113,113,0.12)" },
  raiseHand: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
  },
  raiseHandText: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "700" },
  reqRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    marginTop: 6,
  },
  miniAllow: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(52,211,153,0.12)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.25)",
  },
  miniDeny: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(248,113,113,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.25)",
  },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  avatar: { width: 40, height: 40, borderRadius: 10, backgroundColor: "#222" },
  avatarLg: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#222" },
  memberName: { color: "#fff", fontWeight: "700", fontSize: 13 },
  rolePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  rolePillText: { fontSize: 9, fontWeight: "800", textTransform: "capitalize" },
  cpRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  cpIdx: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  cpIdxOn: { backgroundColor: "rgba(52,211,153,0.2)", borderColor: "rgba(52,211,153,0.35)" },
  attendanceHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  attTab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  attTabOn: { backgroundColor: "#fff" },
  attTabText: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.4)", textTransform: "capitalize" },
  attTabTextOn: { color: "#000" },
  liveMini: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.25)",
    backgroundColor: "rgba(52,211,153,0.1)",
  },
  liveMiniDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#34d399" },
  liveMiniText: { fontSize: 10, fontWeight: "800", color: "#34d399" },
  attCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 10,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  attCardOk: { borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.03)" },
  attCardWay: { borderColor: "rgba(251,191,36,0.2)", backgroundColor: "rgba(251,191,36,0.04)" },
  statusDot: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#000",
  },
  modRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  modBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  modBtnText: { fontSize: 9, fontWeight: "800", color: "rgba(255,255,255,0.5)" },
  rolePick: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    marginRight: 4,
  },
  rolePickOn: { backgroundColor: "#fff", borderColor: "#fff" },
  beginWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "#000",
  },
  beginBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingVertical: 16,
    borderRadius: 16,
  },
  beginBtnText: { color: "#000", fontSize: 16, fontWeight: "800" },
  beginHint: { textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 8 },
  primaryBtn: {
    backgroundColor: "#fff",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  primaryBtnText: { color: "#000", fontWeight: "800" },
  outlineBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  outlineBtnText: { color: "#fff", fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    padding: 24,
  },
  modalBackdropBottom: {
    justifyContent: "flex-end",
    padding: 0,
    backgroundColor: "rgba(0,0,0,0.60)",
  },
  modalCard: {
    backgroundColor: "#111",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 8 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  liveRoot: { flex: 1, backgroundColor: "#000" },
  mapDiagBadge: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 60,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
    backgroundColor: "rgba(127,29,29,0.78)",
  },
  mapDiagText: { color: "#fecaca", fontSize: 11, fontWeight: "700" },
  recenterPill: {
    position: "absolute",
    left: 14,
    zIndex: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.12)",
  },
  recenterPillText: {
    color: "#0f7a8a",
    fontSize: 14,
    fontWeight: "800",
  },
  mapDataBadge: {
    position: "absolute",
    left: 12,
    zIndex: 60,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  mapDataText: { color: "rgba(255,255,255,0.88)", fontSize: 10, fontWeight: "700" },
  mapLeftCol: {
    position: "absolute",
    left: 12,
    zIndex: 20,
    gap: 8,
  },
  pausedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(251,191,36,0.12)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
  },
  pausedBannerText: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 18 },
  setRowTall: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  setIconCol: { width: 28, alignItems: "center", paddingTop: 2 },
  sectionRouteTitle: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: "rgba(255,255,255,0.35)",
    marginTop: 8,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(251,191,36,0.2)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  timelineOrder: { color: "#fbbf24", fontSize: 12, fontWeight: "900" },
  timelineName: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sosSheet: {
    width: "100%",
    alignSelf: "stretch",
    backgroundColor: "#07090d",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderColor: "rgba(190,24,24,0.35)",
  },
  sosSheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignSelf: "center",
    marginBottom: 12,
  },
  sosSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  sosSheetTitle: {
    color: "#fb7185",
    fontSize: 18,
    fontWeight: "700",
  },
  sosCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  sosSheetSubtitle: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 14,
  },
  sosSheetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },
  sosTile: {
    width: "48%",
    borderRadius: 14,
    backgroundColor: "rgba(127,29,29,0.24)",
    borderWidth: 1,
    borderColor: "rgba(225,29,72,0.30)",
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  sosTileIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2",
  },
  sosTileIcon: {
    fontSize: 20,
  },
  sosTileText: {
    color: "#fecaca",
    fontSize: 14,
    fontWeight: "700",
  },
  alertHistoryRow: {
    borderWidth: 1,
    borderColor: "rgba(225,29,72,0.24)",
    backgroundColor: "rgba(127,29,29,0.14)",
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  alertHistoryTitle: {
    color: "#fb7185",
    fontSize: 14,
    fontWeight: "800",
  },
  alertHistoryMeta: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    marginTop: 2,
  },
  alertHistoryMessage: {
    color: "#fecaca",
    fontSize: 12,
    marginTop: 6,
    lineHeight: 18,
  },
  alertCardDark: {
    backgroundColor: "#07090d",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(225,29,72,0.34)",
  },
  alertCardTitle: {
    color: "#fb7185",
    fontSize: 30,
    fontWeight: "800",
  },
  alertCardMeta: {
    color: "rgba(255,255,255,0.60)",
    fontSize: 12,
    marginTop: 8,
  },
  alertCardMessage: {
    color: "#fecaca",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
  },
  alertCardDismissBtn: {
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 14,
    alignItems: "center",
  },
  alertCardDismissText: {
    color: "#111827",
    fontSize: 22,
    fontWeight: "800",
  },
  sosRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  typeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    marginRight: 6,
  },
  typeChipOn: { backgroundColor: "#fff", borderColor: "#fff" },
  textInputDark: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 12,
    padding: 12,
    color: "#fff",
    marginTop: 8,
  },
  liveTopBar: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    zIndex: 20,
  },
  mapCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  liveTopTitleWrap: { flex: 1, marginHorizontal: 8, alignItems: "center", justifyContent: "center" },
  liveTopTitle: { color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: "800" },
  liveTopSub: { color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: "600", marginTop: 2 },
  alertHistoryBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  alertBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  alertBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  alertBadgeInline: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    marginLeft: 4,
  },
  mapRightCol: {
    position: "absolute",
    right: 12,
    zIndex: 20,
    gap: 8,
  },
  liveSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  sheetHandle: { alignItems: "center", paddingTop: 6, paddingBottom: 4 },
  sheetGrabber: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  peekRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    minHeight: 72,
  },
  peekMetricSide: {
    flex: 1,
    minWidth: 0,
  },
  peekPauseCenter: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  metricBig: { color: "#fff", fontSize: 28, fontWeight: "800" },
  metricLabel: { color: "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: "700", marginTop: 2 },
  pauseOuter: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.85)",
    shadowColor: "#dc2626",
    shadowOpacity: 0.45,
    shadowRadius: 12,
  },
  pauseInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  peekActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  dangerOutline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
  },
  dangerOutlineText: { color: "#f87171", fontSize: 11, fontWeight: "800" },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ef4444",
  },
  swipeHint: {
    textAlign: "center",
    marginTop: 10,
    fontSize: 10,
    color: "rgba(255,255,255,0.25)",
  },
  statusBanner: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  gpsDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#34d399", marginRight: 8 },
  statusBannerText: { color: "#93c5fd", fontSize: 12, fontWeight: "700" },
  statusBannerMuted: { color: "rgba(255,255,255,0.35)", fontSize: 12 },
  metrics2: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12, alignItems: "flex-start" },
  iconRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 4,
    flexWrap: "wrap",
  },
  roundIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  pauseOuterLg: {
    padding: 4,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#b91c1c",
    shadowOpacity: 0.5,
    shadowRadius: 16,
  },
  pauseInnerLg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  liveChipRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  liveChipText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  endTripChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(127,29,29,0.45)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.45)",
  },
  endTripChipText: { color: "#fecaca", fontSize: 11, fontWeight: "800" },
  settingsCard: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 12,
    gap: 12,
    marginBottom: 12,
  },
  setRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  setLabel: { color: "#fff", fontSize: 13, fontWeight: "600", flex: 1 },
  setSub: { color: "rgba(255,255,255,0.35)", fontSize: 11 },
  tabsRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 4,
    marginBottom: 10,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  tabOn: { backgroundColor: "#fff" },
  tabText: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.4)" },
  tabTextOn: { color: "#000" },
  crewCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  crewAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#222" },
  crewDot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#000",
  },
});
