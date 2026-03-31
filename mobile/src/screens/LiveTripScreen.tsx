import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { io, type Socket } from "socket.io-client";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { API_BASE_URL } from "../config";
import { apiFetch, readApiErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { normalizeTripFromApi, type Trip } from "../lib/tripNormalize";
import { fetchWeatherNow, type WeatherNow } from "../lib/weather";
import { useAppTheme } from "../context/ThemeContext";
import { colors } from "../theme";
import { LiveMapView, type UserGeo } from "../components/LiveMapView";

type Props = NativeStackScreenProps<RootStackParamList, "LiveTrip">;

type MemberRole = "organizer" | "admin" | "co-admin" | "moderator" | "member";
type MemberStatus = "arrived" | "on-way" | "absent";
type VoiceMode = "open" | "controlled";

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
};

type Checkpoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  reached: boolean;
  badge: string;
  xp: number;
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

function formatPaceMinPerKm(elapsedSec: number, distKm: number): string {
  if (distKm < 0.01) return "--:--";
  const secPerKm = elapsedSec / distKm;
  const m = Math.floor(secPerKm / 60);
  const s = Math.floor(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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

const SOS_REASONS = ["Medical emergency", "Vehicle issue", "Lost from group", "Road hazard", "Other"];

/** Distinct pin colors so riders read like a racing grid. */
const RIDER_PIN_COLORS = ["#22c55e", "#3b82f6", "#f97316", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#ef4444"];

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

  const [voiceMode, setVoiceMode] = useState<VoiceMode>("controlled");
  const [videoCallActive, setVideoCallActive] = useState(false);
  const [speakRequests, setSpeakRequests] = useState<string[]>([]);
  const [approvedSpeakers, setApprovedSpeakers] = useState<string[]>([]);
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
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinType, setPinType] = useState<"parking" | "fuel" | "attraction" | "hazard" | "road-damage">("parking");
  const [pinLabel, setPinLabel] = useState("");
  const [showAttractionModal, setShowAttractionModal] = useState(false);
  const [attrName, setAttrName] = useState("");
  const [attrDesc, setAttrDesc] = useState("");

  const socketRef = useRef<Socket | null>(null);
  const [mapFitTick, setMapFitTick] = useState(0);
  const [mapRecenterPoint, setMapRecenterPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [userGeo, setUserGeo] = useState<UserGeo | null>(null);
  const convoyFitDoneRef = useRef(false);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastLocTsRef = useRef<number | null>(null);
  const [myDistanceKm, setMyDistanceKm] = useState(0);
  const sheetHeightAnim = useRef(new Animated.Value(200)).current;

  const tripIdNum = Number(id);
  const localMemberId = Number.isFinite(Number(user?.id)) ? `m${Number(user!.id)}` : null;
  const localMember =
    localMemberId != null ? members.find((m) => m.id === localMemberId) ?? null : null;
  const localRole = localMember?.role ?? "member";
  const canModerateVoice =
    localRole === "organizer" ||
    localRole === "admin" ||
    localRole === "co-admin" ||
    localRole === "moderator" ||
    user?.role === "organizer";
  const isOrganizer =
    user?.role === "organizer" || localRole === "organizer" || localRole === "admin";
  const localMuted = localMember?.muted ?? true;
  const localAllowedInControlled =
    voiceMode !== "controlled" ||
    canModerateVoice ||
    (localMemberId != null && approvedSpeakers.includes(localMemberId));

  const arrivedCount = members.filter((m) => m.status === "arrived").length;
  const totalCount = members.length;

  const bannerSeed = trip?.banner ?? trip?.id ?? "trip";

  useEffect(() => {
    let cancelled = false;
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
    };
  }, [id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
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

  useEffect(() => {
    if (!user?.id || accessDenied) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(
          `/api/trips/${id}/live-state?user_id=${encodeURIComponent(user.id)}`,
        );
        const body = (await res.json().catch(() => ({}))) as {
          members?: LiveMember[];
          checkpoints?: Checkpoint[];
          mapPins?: MapPin[];
        };
        if (!res.ok) return;
        if (Array.isArray(body.members) && body.members.length > 0 && !cancelled) {
          setMembers(
            body.members.map((m) => ({
              ...m,
              role: normalizeRole(m.role),
            })),
          );
        }
        if (Array.isArray(body.checkpoints) && !cancelled) setCheckpoints(body.checkpoints);
        if (Array.isArray(body.mapPins) && !cancelled) setMapPins(body.mapPins);
      } catch {
        /* keep UI stable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user?.id, accessDenied]);

  useEffect(() => {
    if (!videoCallActive) return;
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
  }, [voiceMode, videoCallActive]);

  useEffect(() => {
    const socket = io(API_BASE_URL, {
      transports: ["websocket", "polling"],
      path: "/socket.io/",
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 500,
    });
    socketRef.current = socket;
    socket.emit("join-trip", tripIdNum);

    socket.on(
      "location-updated",
      (payload: { userId: number; lat: number; lng: number; speed?: number }) => {
        const kmh =
          payload.speed != null && Number.isFinite(payload.speed)
            ? Number((payload.speed * 3.6).toFixed(1))
            : undefined;
        setMembers((prev) => {
          const idx = prev.findIndex((m) => Number(m.id.replace("m", "")) === payload.userId);
          if (idx >= 0) {
            const next = [...prev];
            const cur = next[idx];
            next[idx] = {
              ...cur,
              lat: payload.lat,
              lng: payload.lng,
              status: cur.status === "absent" ? "on-way" : cur.status,
              ...(kmh != null ? { speed: kmh } : {}),
            };
            return next;
          }
          return [
            ...prev,
            {
              id: `m${payload.userId}`,
              userId: payload.userId,
              name: `Member ${payload.userId}`,
              avatar: `member-${payload.userId}`,
              status: "on-way",
              role: "member",
              muted: true,
              blocked: false,
              speed: kmh ?? 0,
              distanceCovered: 0,
              checkpoints: 0,
              xpGained: 0,
              lat: payload.lat,
              lng: payload.lng,
            },
          ];
        });
      },
    );

    socket.on(
      "convoy-action",
      (payload: { kind?: string; userId?: number | null; at?: string }) => {
        const k = String(payload?.kind || "");
        if (k === "regroup-ping") {
          Alert.alert("Regroup ping", "The convoy asked everyone to regroup at the meetup corridor.");
        } else if (k === "trip-started") {
          setTripStarted(true);
          if (!isOrganizer && phase === "waiting") {
            Alert.alert("Trip started", "Organizer started the trip. You can now join live.");
          }
        } else if (k === "line-up-formation") {
          Alert.alert("Formation", "Line up — match speed and spacing with the group.");
        } else if (k.startsWith("sos")) {
          Alert.alert("SOS", "An SOS was signaled in this trip.");
        } else if (k) {
          Alert.alert("Convoy", k);
        }
      },
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [tripIdNum, isOrganizer, phase]);

  useEffect(() => {
    if (phase !== "live" || !user?.id) return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase, user?.id]);

  useEffect(() => {
    if (phase !== "live" || !user?.id) {
      return;
    }
    let sub: Location.LocationSubscription | undefined;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

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
        setMapRecenterPoint({ lat, lng });
        lastPosRef.current = { lat, lng };
        lastLocTsRef.current = first.timestamp;
      } catch {
        // watcher below can still provide the first fix
      }

      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => {
          const { latitude, longitude, accuracy, speed, heading } = loc.coords;
          const lat = latitude;
          const lng = longitude;
          let speedKmh = 0;
          if (speed != null && Number.isFinite(speed) && speed >= 0) {
            speedKmh = Math.max(0, speed * 3.6);
          }
          if (lastPosRef.current) {
            const d = haversineKm(lastPosRef.current, { lat, lng });
            if (d > 0.001 && d < 5) setMyDistanceKm((x) => x + d);
            if (speedKmh < 0.5 && lastLocTsRef.current != null) {
              const dtSec = Math.max(0.1, (loc.timestamp - lastLocTsRef.current) / 1000);
              speedKmh = (d / dtSec) * 3600;
            }
          }
          setCurrentSpeedKmh(Math.max(0, Math.round(speedKmh)));
          lastPosRef.current = { lat, lng };
          lastLocTsRef.current = loc.timestamp;
          setMapRecenterPoint({ lat, lng });
          let hDeg: number | null = heading ?? null;
          if (hDeg != null && Number.isFinite(hDeg) && hDeg < 0) hDeg = hDeg + 360;
          setUserGeo({
            lat,
            lng,
            accuracyM: accuracy ?? undefined,
            headingDeg: hDeg,
            speedMps: speed ?? null,
          });
          setPosTick((x) => x + 1);

          setMembers((prev) =>
            prev.map((m) =>
              localMemberId && m.id === localMemberId
                ? {
                    ...m,
                    lat,
                    lng,
                    speed: Math.max(0, Math.round(speedKmh)),
                    status: m.status === "absent" ? "on-way" : m.status,
                  }
                : m,
            ),
          );

          socketRef.current?.emit("update-location", {
            tripId: tripIdNum,
            userId: Number(user.id),
            lat,
            lng,
            accuracy: accuracy ?? undefined,
            speed: speed ?? undefined,
            heading: heading ?? undefined,
            recordedAt: new Date(loc.timestamp).toISOString(),
          });
        },
      );
    })();

    return () => {
      sub?.remove();
    };
  }, [phase, tripIdNum, user?.id, localMemberId]);

  const hWin = Dimensions.get("window").height;
  const peekH = 200;
  const expandH = Math.min(hWin * 0.62, 560);

  useEffect(() => {
    Animated.timing(sheetHeightAnim, {
      toValue: sheetExpanded ? expandH : peekH,
      duration: 320,
      easing: Easing.out(Easing.cubic),
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

  const requestToSpeak = () => {
    if (!localMemberId) return;
    if (localAllowedInControlled) return;
    setSpeakRequests((prev) =>
      prev.includes(localMemberId) ? prev : [...prev, localMemberId],
    );
    setMembers((prev) =>
      prev.map((m) => (m.id === localMemberId ? { ...m, muted: true } : m)),
    );
  };

  const allowSpeaker = (targetId: string) => {
    setApprovedSpeakers((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]));
    setSpeakRequests((prev) => prev.filter((x) => x !== targetId));
    setMembers((prev) => prev.map((m) => (m.id === targetId ? { ...m, muted: false } : m)));
  };

  const denySpeaker = (targetId: string) => {
    setApprovedSpeakers((prev) => prev.filter((x) => x !== targetId));
    setSpeakRequests((prev) => prev.filter((x) => x !== targetId));
  };

  const toggleMuteWithVoiceRules = (targetId: string) => {
    if (!localMemberId) {
      setMembers((p) => p.map((m) => (m.id === targetId ? { ...m, muted: !m.muted } : m)));
      return;
    }
    const isSelf = targetId === localMemberId;
    if (voiceMode === "controlled" && isSelf && localMuted && !localAllowedInControlled) return;
    if (!canModerateVoice && !isSelf) return;
    setMembers((p) => p.map((m) => (m.id === targetId ? { ...m, muted: !m.muted } : m)));
  };

  const toggleBlock = (mid: string) =>
    setMembers((p) => p.map((m) => (m.id === mid ? { ...m, blocked: !m.blocked } : m)));

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

  const startTripLive = useCallback(async () => {
    if (!user?.id) return;
    if (!isOrganizer && !tripStarted) {
      Alert.alert("Trip not started", "Wait for organizer to start the trip.");
      return;
    }
    if (!isOrganizer && tripStarted) {
      setPhase("live");
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
      socketRef.current?.emit("convoy-action", {
        kind: "trip-started",
        tripId: tripIdNum,
        userId: Number(user.id),
      });
      setPhase("live");
    } catch {
      Alert.alert("Start trip", "Could not start trip right now.");
    }
  }, [id, isOrganizer, tripIdNum, tripStarted, user?.id]);

  const nextCheckpointInfo = useMemo(() => {
    if (!checkpoints.length) return null;
    const sorted = [...checkpoints].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const unreached = sorted.filter((c) => !c.reached);
    const seq = unreached.length ? unreached : sorted;
    const pos =
      lastPosRef.current ??
      (localMember && localMember.lat !== 0 && localMember.lng !== 0
        ? { lat: localMember.lat, lng: localMember.lng }
        : null);
    if (!pos) return { next: seq[0], distanceKm: 0, etaMin: null as number | null };
    let best = seq[0];
    let bestD = haversineKm(pos, { lat: best.lat, lng: best.lng });
    for (const c of seq) {
      const d = haversineKm(pos, { lat: c.lat, lng: c.lng });
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    const spd = Math.max(currentSpeedKmh, 6);
    const etaMin = bestD > 0.005 ? (bestD / spd) * 60 : 0;
    return { next: best, distanceKm: bestD, etaMin };
  }, [checkpoints, localMember, posTick, currentSpeedKmh]);

  const routeTimeline = useMemo(() => {
    const pos =
      lastPosRef.current ??
      (localMember && localMember.lat !== 0 && localMember.lng !== 0
        ? { lat: localMember.lat, lng: localMember.lng }
        : null);
    const sorted = [...checkpoints].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const spd = Math.max(currentSpeedKmh, 6);
    return sorted.map((cp, i) => {
      const distKm = pos ? haversineKm(pos, { lat: cp.lat, lng: cp.lng }) : 0;
      const etaMin = pos && distKm > 0.005 ? (distKm / spd) * 60 : 0;
      return { cp, order: i + 1, distKm, etaMin, reached: cp.reached };
    });
  }, [checkpoints, localMember, posTick, currentSpeedKmh]);

  const onLeave = useCallback(() => {
    setShowExitConfirm(false);
    navigation.goBack();
  }, [navigation]);

  const fitConvoy = useCallback(() => {
    setMapFitTick((n) => n + 1);
  }, []);

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
    (kind: string) => {
      if (!user?.id) return;
      socketRef.current?.emit("convoy-action", {
        kind,
        tripId: tripIdNum,
        userId: Number(user.id),
      });
    },
    [tripIdNum, user?.id],
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
      setPinLabel("");
      setShowPinModal(false);
      Alert.alert("Map pin", "Pin added for the convoy.");
    } catch {
      Alert.alert("Map pin", "Could not add pin.");
    }
  }, [id, pinLabel, pinType, user]);

  const submitAttraction = useCallback(async () => {
    if (!user?.id || !attrName.trim()) {
      Alert.alert("Attraction", "Enter a name for this place.");
      return;
    }
    const pos = lastPosRef.current;
    if (!pos) {
      Alert.alert("Location", "Wait for a GPS fix.");
      return;
    }
    try {
      const res = await apiFetch("/api/nearby-attractions", {
        method: "POST",
        body: JSON.stringify({
          name: attrName.trim(),
          description: attrDesc.trim(),
          lat: pos.lat,
          lng: pos.lng,
          user_id: Number(user.id),
        }),
      });
      if (!res.ok) {
        Alert.alert("Attraction", await readApiErrorMessage(res));
        return;
      }
      setAttrName("");
      setAttrDesc("");
      setShowAttractionModal(false);
      Alert.alert("Saved", "Nearby attraction saved. Organizers can pick it when adding checkpoints.");
    } catch {
      Alert.alert("Attraction", "Could not save.");
    }
  }, [attrDesc, attrName, user?.id]);

  // Keep map camera target synced while in live mode.
  useEffect(() => {
    if (phase !== "live") return;
    const fallbackStart =
      drivingRoute?.start ??
      (trip?.meetupLat != null && trip?.meetupLng != null
        ? { lat: trip.meetupLat, lng: trip.meetupLng }
        : null);
    const effective =
      userGeo ??
      (lastPosRef.current
        ? {
            lat: lastPosRef.current.lat,
            lng: lastPosRef.current.lng,
          }
        : null);
    if (effective) {
      setMapRecenterPoint({ lat: effective.lat, lng: effective.lng });
    } else if (fallbackStart) {
      setMapRecenterPoint({ lat: fallbackStart.lat, lng: fallbackStart.lng });
    }
  }, [
    phase,
    userGeo?.lat,
    userGeo?.lng,
    drivingRoute?.start?.lat,
    drivingRoute?.start?.lng,
    trip?.meetupLat,
    trip?.meetupLng,
  ]);

  // Auto-fit whenever meaningful map data appears/changes in live mode.
  useEffect(() => {
    if (phase !== "live") return;
    const routeCount = drivingRoute?.coordinates?.length ?? 0;
    const hasStart =
      (drivingRoute?.start != null &&
        Number.isFinite(Number(drivingRoute.start.lat)) &&
        Number.isFinite(Number(drivingRoute.start.lng))) ||
      (trip?.meetupLat != null && trip?.meetupLng != null);
    const hasEnd =
      (drivingRoute?.end != null &&
        Number.isFinite(Number(drivingRoute.end.lat)) &&
        Number.isFinite(Number(drivingRoute.end.lng))) ||
      (trip?.endLat != null && trip?.endLng != null);
    const memberCount = members.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng) && m.lat !== 0 && m.lng !== 0).length;
    const pinCount = mapPins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).length;
    const hasUser = !!userGeo || !!lastPosRef.current;
    const hasData = routeCount > 0 || hasStart || hasEnd || memberCount > 0 || pinCount > 0 || hasUser;
    if (!hasData) return;
    setMapFitTick((n) => n + 1);
  }, [
    phase,
    drivingRoute?.coordinates?.length,
    drivingRoute?.start?.lat,
    drivingRoute?.start?.lng,
    drivingRoute?.end?.lat,
    drivingRoute?.end?.lng,
    trip?.meetupLat,
    trip?.meetupLng,
    trip?.endLat,
    trip?.endLng,
    members,
    mapPins,
    userGeo?.lat,
    userGeo?.lng,
    posTick,
  ]);

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
                <View style={[styles.connBadge, videoCallActive && styles.connBadgeOn]}>
                  <Text style={[styles.connBadgeText, videoCallActive && { color: "#34d399" }]}>
                    {videoCallActive ? "Voice Connected" : "Not Connected"}
                  </Text>
                </View>
              </View>

              <View style={styles.voiceRow}>
                <Pressable
                  disabled={!canModerateVoice}
                  onPress={() => setVoiceMode("open")}
                  style={[styles.voicePill, voiceMode === "open" && styles.voicePillActive]}
                >
                  <Text style={[styles.voicePillText, voiceMode === "open" && styles.voicePillTextOn]}>
                    Talk All
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setVoiceMode("controlled")}
                  style={[styles.voicePill, voiceMode === "controlled" && styles.voicePillActive]}
                >
                  <Text
                    style={[styles.voicePillText, voiceMode === "controlled" && styles.voicePillTextOn]}
                  >
                    Staff Talk
                  </Text>
                </Pressable>
              </View>

              {!videoCallActive ? (
                <Pressable style={styles.joinVoice} onPress={() => setVideoCallActive(true)}>
                  <Text style={styles.joinVoiceText}>Join Voice Channel</Text>
                </Pressable>
              ) : (
                <View style={styles.row}>
                  <Pressable
                    style={[styles.joinVoice, { flex: 1, backgroundColor: "rgba(255,255,255,0.06)" }]}
                    onPress={() => setVideoCallActive(false)}
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

              {videoCallActive && voiceMode === "controlled" && (
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
                              <Pressable onPress={() => allowSpeaker(rid)} style={styles.miniAllow}>
                                <Text style={{ color: "#34d399", fontWeight: "700", fontSize: 10 }}>Allow</Text>
                              </Pressable>
                              <Pressable onPress={() => denySpeaker(rid)} style={styles.miniDeny}>
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
              <Text style={styles.cardTitle}>CHECKPOINTS ({checkpoints.length})</Text>
              {checkpoints.length === 0 ? (
                <Text style={[styles.mutedSmall, { marginTop: 8 }]}>No checkpoints yet.</Text>
              ) : (
                checkpoints.map((cp, i) => (
                  <View key={cp.id} style={styles.cpRow}>
                    <View style={[styles.cpIdx, cp.reached && styles.cpIdxOn]}>
                      <Text style={{ fontSize: 10, fontWeight: "700" }}>{i + 1}</Text>
                    </View>
                    <Text style={{ flex: 1, color: "rgba(255,255,255,0.65)", fontSize: 12 }} numberOfLines={1}>
                      {cp.name}
                    </Text>
                    <Text style={{ color: "#fbbf24", fontSize: 10, fontWeight: "700" }}>+{cp.xp}XP</Text>
                  </View>
                ))
              )}
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
  const mapMembers = members
    .filter(
      (m) =>
        m.lat !== 0 &&
        m.lng !== 0 &&
        Number.isFinite(m.lat) &&
        Number.isFinite(m.lng) &&
        (localMemberId ? m.id !== localMemberId : true),
    )
    .map((m, i) => ({
      id: m.id,
      name: m.name,
      lat: m.lat,
      lng: m.lng,
      speed: m.speed,
      color: RIDER_PIN_COLORS[i % RIDER_PIN_COLORS.length],
    }));
  const mapOverlayPins = mapPins.map((p) => ({ id: p.id, label: p.label, lat: p.lat, lng: p.lng }));
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
        dark={mode === "dark"}
        route={liveRoutePoints}
        start={startPoint}
        end={endPoint}
        members={mapMembers}
        pins={mapOverlayPins}
        fitTick={mapFitTick}
        recenterPoint={mapRecenterPoint}
        userGeo={effectiveUserGeo}
        onMapError={(msg) => setMapDiag(msg)}
      />

      {mapDiag ? (
        <View style={[styles.mapDiagBadge, { top: insets.top + 52 }]}>
          <Text style={styles.mapDiagText} numberOfLines={2}>
            {mapDiag}
          </Text>
        </View>
      ) : null}
      <View style={[styles.mapDataBadge, { top: insets.top + 88 }]}>
        <Text style={styles.mapDataText}>
          r:{liveRoutePoints.length} m:{mapMembers.length} p:{mapOverlayPins.length} u:
          {effectiveUserGeo ? "1" : "0"} s:{startPoint ? "1" : "0"} e:{endPoint ? "1" : "0"}
        </Text>
      </View>

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
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.mapLeftCol, { top: h * 0.34 }]}>
        <Pressable style={styles.mapCircleBtn} onPress={toggleMode}>
          <Ionicons name={mode === "dark" ? "moon" : "sunny"} size={20} color="#fff" />
        </Pressable>
      </View>

      <View style={[styles.mapRightCol, { top: h * 0.36 }]}>
        <Pressable style={styles.mapCircleBtn}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 11 }}>3D</Text>
        </Pressable>
        <Pressable
          style={styles.mapCircleBtn}
          onPress={async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== "granted") return;
            const loc = await Location.getCurrentPositionAsync({});
            const { latitude, longitude } = loc.coords;
            setMapRecenterPoint({ lat: latitude, lng: longitude });
          }}
        >
          <Ionicons name="locate" size={20} color="#fff" />
        </Pressable>
        <Pressable style={styles.mapCircleBtn} onPress={fitConvoy} accessibilityLabel="Fit route and riders">
          <Ionicons name="expand-outline" size={20} color="#fff" />
        </Pressable>
      </View>

      <Animated.View
        style={[
          styles.liveSheet,
          {
            height: sheetHeightAnim,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
      >
        <Pressable style={styles.sheetHandle} onPress={() => setSheetExpanded((s) => !s)}>
          <Ionicons
            name={sheetExpanded ? "chevron-down" : "chevron-up"}
            size={18}
            color="rgba(255,255,255,0.35)"
          />
        </Pressable>
        {!sheetExpanded ? (
          <>
            <View style={styles.peekRow}>
              <View>
                <Text style={styles.metricBig}>{formatElapsedStrava(elapsedSec)}</Text>
                <Text style={styles.metricLabel}>TIME</Text>
              </View>
              <Pressable onPress={() => !endingTrip && goToPausedWaiting()}>
                <View style={styles.pauseOuter}>
                  <View style={styles.pauseInner}>
                    <Ionicons name="pause" size={28} color="#fff" />
                  </View>
                </View>
              </Pressable>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.metricBig}>{myDistanceKm.toFixed(1)}</Text>
                <Text style={styles.metricLabel}>KM</Text>
              </View>
            </View>
            <View style={styles.peekActions}>
              <Pressable style={styles.dangerOutline} onPress={() => setShowSosModal(true)}>
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
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={styles.statusBanner}>
              <View style={styles.gpsDot} />
              <Text style={styles.statusBannerText}>Live GPS tracking</Text>
              <Text style={styles.statusBannerMuted}> · Convoy sync</Text>
            </View>
            <View style={styles.metrics3}>
              <View>
                <Text style={styles.metricBig}>{formatElapsedStrava(elapsedSec)}</Text>
                <Text style={styles.metricLabel}>TIME</Text>
              </View>
              <View style={{ alignItems: "center" }}>
                <Text style={styles.metricBig}>{formatPaceMinPerKm(elapsedSec, myDistanceKm)}</Text>
                <Text style={styles.metricLabel}>SPLIT AVG (/KM)</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.metricBig}>{myDistanceKm.toFixed(1)}</Text>
                <Text style={styles.metricLabel}>DISTANCE (KM)</Text>
              </View>
            </View>
            <View style={styles.iconRow}>
              <Pressable style={styles.roundIcon} onPress={() => setShowSosModal(true)}>
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
              <Pressable style={styles.roundIcon} onPress={() => setShowPinModal(true)}>
                <Ionicons name="location" size={22} color="#c084fc" />
              </Pressable>
              <Pressable style={styles.roundIcon} onPress={() => emitConvoy("line-up-formation")}>
                <Ionicons name="list" size={22} color="#2dd4bf" />
              </Pressable>
            </View>
            <View style={styles.liveChipRow}>
              <View style={styles.liveChip}>
                <View style={styles.liveDot} />
                <Text style={styles.liveChipText}>LIVE</Text>
              </View>
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
                  <Ionicons name="flag-outline" size={22} color="rgba(255,255,255,0.75)" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.setLabel}>Next checkpoint</Text>
                  {nextCheckpointInfo ? (
                    <>
                      <Text style={styles.setSub} numberOfLines={2}>
                        {nextCheckpointInfo.next.name}
                      </Text>
                      <Text style={styles.setSub}>
                        {nextCheckpointInfo.distanceKm.toFixed(1)} km away
                        {nextCheckpointInfo.etaMin != null
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
            </View>
            <Text style={[styles.sectionRouteTitle, { marginBottom: 8 }]}>ROUTE · CHECKPOINT TIMELINE</Text>
            {routeTimeline.length === 0 ? (
              <Text style={[styles.mutedSmall, { textAlign: "center", padding: 12 }]}>
                No checkpoints yet. Organizers can add them when creating the event.
              </Text>
            ) : (
              routeTimeline.map((row) => (
                <View key={row.cp.id} style={styles.timelineRow}>
                  <View style={styles.timelineDot}>
                    <Text style={styles.timelineOrder}>{row.order}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.timelineName}>{row.cp.name}</Text>
                    <Text style={styles.setSub}>
                      {row.reached ? "Reached · " : ""}
                      {row.distKm.toFixed(1)} km from you · ~{Math.max(1, Math.round(row.etaMin))} min
                      {row.cp.badge ? ` · ${row.cp.badge}` : ""}
                      {row.cp.xp ? ` · +${row.cp.xp} XP` : ""}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </Animated.View>

      <Modal visible={showSosModal} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowSosModal(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>SOS alert</Text>
            <Text style={styles.mutedSmall}>Pick a reason — your group is notified.</Text>
            {SOS_REASONS.map((r) => (
              <Pressable
                key={r}
                style={styles.sosRow}
                onPress={() => {
                  emitConvoy(`sos:${r}`);
                  setShowSosModal(false);
                  Alert.alert("SOS sent", r);
                }}
              >
                <Text style={{ color: "#fecaca", fontWeight: "700" }}>{r}</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.primaryBtn, styles.outlineBtn, { marginTop: 8 }]} onPress={() => setShowSosModal(false)}>
              <Text style={styles.outlineBtnText}>Cancel</Text>
            </Pressable>
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
        <Pressable style={styles.modalBackdrop} onPress={() => setShowAttractionModal(false)}>
          <Pressable style={[styles.modalCard, { maxHeight: "85%" }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Nearby attraction</Text>
            <Text style={styles.mutedSmall}>Name and description — saved for organizers.</Text>
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
            <View style={styles.modalActions}>
              <Pressable style={[styles.primaryBtn, styles.outlineBtn]} onPress={() => setShowAttractionModal(false)}>
                <Text style={styles.outlineBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryBtn} onPress={() => void submitAttraction()}>
                <Text style={styles.primaryBtnText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
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
    </View>
  );
}

const styles = StyleSheet.create({
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
  primaryBtnText: { color: "#000", fontWeight: "800" },
  outlineBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  outlineBtnText: { color: "#fff", fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    padding: 24,
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
  sheetHandle: { alignItems: "center", paddingVertical: 4 },
  peekRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  metricBig: { color: "#fff", fontSize: 28, fontWeight: "800" },
  metricLabel: { color: "rgba(255,255,255,0.35)", fontSize: 10, fontWeight: "700", marginTop: 2 },
  pauseOuter: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(251,146,60,0.6)",
    shadowColor: "#f97316",
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  pauseInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(249,115,22,0.95)",
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
  metrics3: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  iconRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 4,
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
    borderColor: "rgba(251,146,60,0.65)",
    shadowColor: "#f97316",
    shadowOpacity: 0.55,
    shadowRadius: 16,
  },
  pauseInnerLg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(234,88,12,0.98)",
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
