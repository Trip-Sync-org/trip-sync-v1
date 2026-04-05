import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, PermissionsAndroid, Platform } from "react-native";
import type { Socket } from "socket.io-client";
import { createVoiceManager, type VoiceManagerApi, type VoiceMode } from "../lib/voiceManager";

type UseConvoyVoiceProps = {
  socket: Socket | null;
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
  return true;
}

export function useConvoyVoice({
  socket,
  tripId,
  myUserId,
  voiceMode,
  canSpeak,
  isMuted,
  blockedIds,
  onMemberMuteChange,
}: UseConvoyVoiceProps) {
  const managerRef = useRef<VoiceManagerApi | null>(null);
  const blockedIdsPrevRef = useRef<number[]>([]);
  const [isInVoice, setIsInVoice] = useState(false);
  const [voiceRiders, setVoiceRiders] = useState<number[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);

  const joinVoice = useCallback(async (): Promise<boolean> => {
    if (isInVoice || isConnecting || !socket?.connected) return false;
    if (!Number.isFinite(myUserId) || myUserId <= 0) {
      Alert.alert("Voice error", "Sign in again to use convoy voice.");
      return false;
    }

    const ok = await requestMicPermission();
    if (!ok) {
      Alert.alert("Microphone needed", "Allow microphone access in Settings to use convoy voice chat.");
      return false;
    }

    setIsConnecting(true);
    try {
      const manager = createVoiceManager(myUserId, tripId);

      manager.onSignal = (payload) => {
        if (!socket?.connected) return;
        if (payload.type === "voice-offer" || payload.type === "voice-answer" || payload.type === "voice-ice") {
          socket.emit("voice-signal", {
            tripId,
            toUserId: payload.toUserId,
            fromUserId: myUserId,
            signal: payload,
          });
        } else if (payload.type === "voice-muted") {
          socket.emit("voice-signal", {
            tripId,
            toUserId: -1,
            fromUserId: myUserId,
            signal: payload,
          });
        }
      };

      await manager.start();
      manager.setVoiceMode(voiceMode, canSpeak);
      manager.setMuted(isMuted);
      blockedIds.forEach((id) => manager.setBlocked(id, true));

      managerRef.current = manager;

      socket.emit("voice-join", { tripId, userId: myUserId });
      setIsInVoice(true);
      return true;
    } catch (err: unknown) {
      console.error("[voice] failed to start:", err);
      const msg =
        err instanceof Error && err.message.includes("WEBRTC_UNAVAILABLE")
          ? err.message.replace(/^WEBRTC_UNAVAILABLE:\s*/i, "")
          : "Could not start voice. Check microphone permission.";
      Alert.alert("Voice unavailable", msg);
      return false;
    } finally {
      setIsConnecting(false);
    }
  }, [
    blockedIds,
    canSpeak,
    isConnecting,
    isInVoice,
    isMuted,
    myUserId,
    socket,
    tripId,
    voiceMode,
  ]);

  const leaveVoice = useCallback(() => {
    managerRef.current?.stop();
    managerRef.current = null;
    if (socket?.connected) {
      socket.emit("voice-leave", { tripId, userId: myUserId });
    }
    setIsInVoice(false);
    setVoiceRiders([]);
  }, [myUserId, socket, tripId]);

  const toggleMute = useCallback(() => {
    const m = managerRef.current;
    if (!m) return false;
    const next = !m.getMuted();
    m.setMuted(next);
    return next;
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    managerRef.current?.setMuted(muted);
  }, []);

  const setBlocked = useCallback((userId: number, blocked: boolean) => {
    managerRef.current?.setBlocked(userId, blocked);
  }, []);

  const muteRemoteRider = useCallback(
    (userId: number, muted: boolean) => {
      managerRef.current?.setRemoteMuted(userId, muted);
      socket?.emit("voice-signal", {
        tripId,
        toUserId: userId,
        fromUserId: myUserId,
        signal: { type: "voice-force-mute", userId, muted },
      });
    },
    [myUserId, socket, tripId],
  );

  useEffect(() => {
    managerRef.current?.setVoiceMode(voiceMode, canSpeak);
  }, [voiceMode, canSpeak]);

  useEffect(() => {
    const m = managerRef.current;
    if (!m) {
      blockedIdsPrevRef.current = blockedIds;
      return;
    }
    const prev = blockedIdsPrevRef.current;
    blockedIdsPrevRef.current = blockedIds;
    prev.forEach((id) => {
      if (!blockedIds.includes(id)) m.setBlocked(id, false);
    });
    blockedIds.forEach((id) => m.setBlocked(id, true));
  }, [blockedIds]);

  useEffect(() => {
    if (!socket) return;

    const onVoicePeers = (data: { peers?: number[] }) => {
      const peers = Array.isArray(data?.peers) ? data.peers : [];
      setVoiceRiders(peers);
      peers.forEach((peerId) => {
        void managerRef.current?.callRider(peerId);
      });
    };

    const onVoiceRiderJoined = (data: { userId?: number }) => {
      const uid = Number(data?.userId);
      if (!Number.isFinite(uid)) return;
      setVoiceRiders((prev) => (prev.includes(uid) ? prev : [...prev, uid]));
    };

    const onVoiceRiderLeft = (data: { userId?: number }) => {
      const uid = Number(data?.userId);
      if (!Number.isFinite(uid)) return;
      setVoiceRiders((prev) => prev.filter((id) => id !== uid));
      managerRef.current?.removeRider(uid);
    };

    const onVoiceSignal = async (data: { fromUserId?: number; toUserId?: number; signal?: Record<string, unknown> }) => {
      const fromUserId = Number(data?.fromUserId);
      const toUserId = Number(data?.toUserId);
      const signal = data?.signal;
      if (!Number.isFinite(fromUserId) || !signal || typeof signal !== "object") return;

      if (toUserId !== -1 && toUserId !== myUserId) return;

      const m = managerRef.current;
      if (!m) return;

      const t = String(signal.type ?? "");
      if (t === "voice-offer") {
        const sdp = String(signal.sdp ?? "");
        await m.handleOffer(fromUserId, sdp);
      } else if (t === "voice-answer") {
        const sdp = String(signal.sdp ?? "");
        await m.handleAnswer(fromUserId, sdp);
      } else if (t === "voice-ice") {
        const cand = signal.candidate;
        if (cand && typeof cand === "object") {
          await m.handleIceCandidate(fromUserId, cand as Record<string, unknown>);
        }
      } else if (t === "voice-muted") {
        const uid = Number(signal.userId);
        const muted = Boolean(signal.muted);
        if (Number.isFinite(uid)) onMemberMuteChange?.(uid, muted);
      } else if (t === "voice-force-mute") {
        const uid = Number(signal.userId);
        const muted = Boolean(signal.muted);
        if (uid === myUserId) {
          m.setMuted(muted);
          onMemberMuteChange?.(myUserId, muted);
        } else {
          m.setRemoteMuted(uid, muted);
        }
      }
    };

    socket.on("voice-peers", onVoicePeers);
    socket.on("voice-rider-joined", onVoiceRiderJoined);
    socket.on("voice-rider-left", onVoiceRiderLeft);
    socket.on("voice-signal", onVoiceSignal);

    return () => {
      socket.off("voice-peers", onVoicePeers);
      socket.off("voice-rider-joined", onVoiceRiderJoined);
      socket.off("voice-rider-left", onVoiceRiderLeft);
      socket.off("voice-signal", onVoiceSignal);
    };
  }, [myUserId, onMemberMuteChange, socket]);

  useEffect(() => {
    return () => {
      managerRef.current?.stop();
      managerRef.current = null;
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
