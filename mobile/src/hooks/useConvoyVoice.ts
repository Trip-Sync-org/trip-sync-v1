/**
 * useConvoyVoice — LiveKit SFU edition
 *
 * Replaces the old WebRTC peer-to-peer voice manager.
 * Audio is handled entirely by LiveKit; this hook:
 *   - fetches a token from POST /get-voice-token on the socket server
 *   - connects/disconnects the LiveKit room
 *   - exposes the same API surface as the old hook so LiveTripScreen needs no changes
 *
 * Socket.IO is still used for location + convoy actions — untouched here.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Alert, PermissionsAndroid, Platform } from "react-native";
import type { Socket } from "socket.io-client";
import { SOCKET_URL } from "../config";

// LiveKit React Native — only available in a native build (not Expo Go)
let LiveKitRoom: any = null;
let useRoomContext: (() => any) | null = null;
let AudioSession: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lk = require("@livekit/react-native");
  useRoomContext = lk.useRoomContext ?? lk.useRoom ?? null;
  AudioSession = lk.AudioSession ?? null;
  LiveKitRoom = lk.LiveKitRoom ?? null;
} catch (_) {
  // Expo Go or package not installed — voice gracefully disabled
}

const LIVEKIT_WS_URL = process.env.EXPO_PUBLIC_LIVEKIT_URL ?? "wss://voice.tripsync.live";

export type VoiceMode = "open" | "controlled";

type UseConvoyVoiceProps = {
  socketRef: MutableRefObject<Socket | null>;
  tripId: number;
  myUserId: number;
  voiceMode: VoiceMode;
  canSpeak: boolean;
  isMuted: boolean;
  blockedIds: number[];
  onMemberMuteChange?: (userId: number, muted: boolean) => void;
};

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS === "android") {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title: "Microphone",
      message: "Trip-Sync needs microphone access for convoy voice chat.",
      buttonPositive: "OK",
    });
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true; // iOS — handled via Info.plist
}

export function useConvoyVoice({
  socketRef: _socketRef, // kept in signature for API compatibility — no longer used for voice
  tripId,
  myUserId,
  voiceMode: _voiceMode,
  canSpeak,
  isMuted,
  blockedIds: _blockedIds,
  onMemberMuteChange,
}: UseConvoyVoiceProps) {
  const [isInVoice, setIsInVoice] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [voiceRiders, setVoiceRiders] = useState<number[]>([]);

  // LiveKit room instance — obtained from context if LiveKitRoom provider is mounted,
  // or managed internally via the SDK's Room class.
  const roomRef = useRef<any>(null);
  const localMutedRef = useRef(isMuted);
  localMutedRef.current = isMuted;
  const canSpeakRef = useRef(canSpeak);
  canSpeakRef.current = canSpeak;

  // ── JOIN ──────────────────────────────────────────────────────────────────
  const joinVoice = useCallback(async (): Promise<boolean> => {
    if (isInVoice || isConnecting) return false;
    if (!Number.isFinite(myUserId) || myUserId <= 0) {
      Alert.alert("Voice error", "Sign in again to use convoy voice.");
      return false;
    }

    const ok = await requestMicPermission();
    if (!ok) {
      Alert.alert("Microphone needed", "Allow microphone access in Settings to use convoy voice chat.");
      return false;
    }

    if (!useRoomContext && !LiveKitRoom) {
      // Expo Go fallback — inform user but don't crash
      Alert.alert(
        "Voice unavailable",
        "LiveKit voice requires a native build. Run: npx expo run:android",
      );
      return false;
    }

    setIsConnecting(true);
    try {
      // Fetch token from our socket server
      const res = await fetch(`${SOCKET_URL}/get-voice-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: String(tripId),
          participantName: String(myUserId),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Token request failed (${res.status})`);
      }
      const { token } = (await res.json()) as { token: string };

      // Build a LiveKit Room instance
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Room } = require("livekit-client");
      const room = new Room();
      roomRef.current = room;

      // Start the native audio session BEFORE connecting / publishing the mic.
      // startAudioSession() is async (returns a Promise) — it MUST be awaited so the
      // native Android AudioManager enters communication/recording mode before any
      // track is published. If we don't await it, setMicrophoneEnabled() can "succeed"
      // at the JS layer while the OS never actually opens the mic (no green-dot
      // indicator, no audio). This ordering is required per the @livekit/react-native docs.
      if (!AudioSession) {
        throw new Error(
          "AudioSession unavailable — @livekit/react-native native module not linked. Rebuild dev client: npx expo run:android",
        );
      }
      try {
        // Configure Android for communication-mode audio (mic capture route).
        if (Platform.OS === "android" && typeof AudioSession.configureAudio === "function") {
          await AudioSession.configureAudio({
            android: { audioTypeOptions: AudioSession.AndroidAudioTypePresets?.communication },
          });
        }
        await AudioSession.startAudioSession();
        console.log("[voice] AudioSession.startAudioSession() succeeded (awaited)");
      } catch (audioErr: unknown) {
        console.error("[voice] AudioSession.startAudioSession() FAILED:", audioErr);
        throw audioErr; // without a live audio session the mic cannot open — fail the join
      }

      await room.connect(LIVEKIT_WS_URL, token, {
        audio: true,
        video: false,
        adaptiveStream: false,

        dynacast: false,
      });

      // Apply initial mic state from permission gate + manual mute preference
      const initialMicOn = canSpeakRef.current && !localMutedRef.current;
      await room.localParticipant
        ?.setMicrophoneEnabled(initialMicOn)
        .then(() => {
          console.log(
            "[voice] join setMicrophoneEnabled",
            initialMicOn,
            "succeeded. isMicrophoneEnabled now:",
            room.localParticipant?.isMicrophoneEnabled,
          );
        })
        .catch((e: unknown) => console.error("[voice] join setMicrophoneEnabled FAILED:", e));

      // Track remote participants
      const syncRiders = () => {
        const ids: number[] = [];
        room.remoteParticipants.forEach((p: any) => {
          const uid = Number(p.identity);
          if (Number.isFinite(uid)) ids.push(uid);
        });
        setVoiceRiders(ids);
      };

      room.on("participantConnected", syncRiders);
      room.on("participantDisconnected", syncRiders);
      room.on("disconnected", () => {
        setIsInVoice(false);
        setVoiceRiders([]);
        AudioSession?.stopAudioSession();
      });

      syncRiders();
      setIsInVoice(true);
      console.log("[voice] LiveKit connected, room:", tripId);
      return true;
    } catch (err: unknown) {
      console.error("[voice] failed to start:", err);
      const msg = err instanceof Error ? err.message : "Could not start voice. Check microphone permission.";
      Alert.alert("Voice unavailable", msg);
      roomRef.current = null;
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [isInVoice, isConnecting, myUserId, tripId]);

  // ── LEAVE ─────────────────────────────────────────────────────────────────
  const leaveVoice = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      room.disconnect();
      roomRef.current = null;
    }
    AudioSession?.stopAudioSession();
    setIsInVoice(false);
    setVoiceRiders([]);
    console.log("[voice] LiveKit disconnected");
  }, []);

  // ── MUTE ──────────────────────────────────────────────────────────────────
  const toggleMute = useCallback((): boolean => {
    const room = roomRef.current;
    if (!room?.localParticipant) return false;
    const nowMuted = !localMutedRef.current;
    const effectiveOn = canSpeakRef.current && !nowMuted;
    room.localParticipant.setMicrophoneEnabled(effectiveOn).catch((e: unknown) => {
      console.warn("[voice] setMicrophoneEnabled error:", e);
    });
    return nowMuted;
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    const shouldBeOn = canSpeakRef.current && !muted;
    room.localParticipant.setMicrophoneEnabled(shouldBeOn).catch((e: unknown) => {
      console.warn("[voice] setMicrophoneEnabled error:", e);
    });
  }, []);

  // ── REMOTE MUTE (staff muting a rider) ────────────────────────────────────
  // LiveKit SFU: we cannot forcibly mute a remote participant's microphone from
  // the client side. Instead we notify the target via the socket signal so their
  // device mutes itself. The onMemberMuteChange callback updates the UI.
  const muteRemoteRider = useCallback(
    (userId: number, muted: boolean) => {
      onMemberMuteChange?.(userId, muted);
      // Signal the target rider via socket so their device applies the mute
      _socketRef.current?.emit("voice-signal", {
        tripId,
        toUserId: userId,
        fromUserId: myUserId,
        signal: { type: "voice-force-mute", userId, muted },
      });
    },
    [_socketRef, myUserId, onMemberMuteChange, tripId],
  );

  // ── BLOCK (local audio gate — mute their audio track locally) ─────────────
  const setBlocked = useCallback((_userId: number, _blocked: boolean) => {
    // LiveKit: remote audio tracks can be muted locally via participant.audioTracks
    // For now this is a no-op — full implementation can subscribe/unsubscribe tracks
    // using room.remoteParticipants.get(identity)?.audioTrackPublications
  }, []);

  // ── Single source of truth: LiveKit mic = canSpeak AND NOT manual mute ────
  useEffect(() => {
    if (!isInVoice || !roomRef.current?.localParticipant) return;
    const shouldBeOn = canSpeak && !isMuted;
    roomRef.current.localParticipant
      .setMicrophoneEnabled(shouldBeOn)
      .then(() => {
        console.log(
          "[voice] setMicrophoneEnabled",
          shouldBeOn,
          "succeeded. isMicrophoneEnabled now:",
          roomRef.current?.localParticipant?.isMicrophoneEnabled,
        );
      })
      .catch((e: unknown) => console.error("[voice] setMicrophoneEnabled FAILED:", e));
  }, [canSpeak, isMuted, isInVoice]);

  // ── CLEANUP on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const room = roomRef.current;
      if (room) {
        room.disconnect();
        roomRef.current = null;
      }
      AudioSession?.stopAudioSession();
    };
  }, []);

  return {
    isInVoice,
    isConnecting,
    voiceRiders,
    joinVoice,
    leaveVoice,
    toggleMute,
    setMuted,
    setBlocked,
    muteRemoteRider,
  };
}
