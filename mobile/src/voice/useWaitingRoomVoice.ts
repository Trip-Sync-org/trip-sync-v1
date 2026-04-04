/**
 * Waiting-room voice: Supabase Realtime syncs mode / speak queue across devices; optional WebRTC for audio.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { tripChannel, EVENTS } from "../../shared/voiceConstants.js";
import { WaitingRoomP2P } from "./waitingRoomP2P";

export type VoiceMode = "open" | "controlled";

type UseWaitingRoomVoiceOpts = {
  tripId: string;
  /** waiting room UI only */
  enabled: boolean;
  localMemberId: string | null;
  canModerateVoice: boolean;
};

export function useWaitingRoomVoice({
  tripId,
  enabled,
  localMemberId,
  canModerateVoice,
}: UseWaitingRoomVoiceOpts) {
  const [voiceMode, setVoiceModeState] = useState<VoiceMode>("controlled");
  const [videoCallActive, setVideoCallActive] = useState(false);
  const [speakRequests, setSpeakRequests] = useState<string[]>([]);
  const [approvedSpeakers, setApprovedSpeakers] = useState<string[]>([]);
  const [voiceJoinedIds, setVoiceJoinedIds] = useState<string[]>([]);
  const [webrtcStatus, setWebrtcStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [webrtcError, setWebrtcError] = useState<string | null>(null);

  const voiceChRef = useRef<RealtimeChannel | null>(null);
  const voiceSubscribedRef = useRef<Promise<void> | null>(null);
  const p2pRef = useRef<WaitingRoomP2P | null>(null);
  const tripIdRef = useRef(tripId);
  const voiceJoinedIdsRef = useRef<string[]>([]);
  tripIdRef.current = tripId;

  useEffect(() => {
    voiceJoinedIdsRef.current = voiceJoinedIds;
  }, [voiceJoinedIds]);

  const broadcast = useCallback(async (event: string, payload: Record<string, unknown>) => {
    if (!supabase) return;
    const ch = voiceChRef.current;
    if (!ch) return;
    if (voiceSubscribedRef.current) {
      await voiceSubscribedRef.current.catch(() => {});
    }
    await ch.send({ type: "broadcast", event, payload });
  }, []);

  useEffect(() => {
    if (!supabase || !enabled || !tripId) return;

    const ch = supabase.channel(tripChannel(tripId), {
      config: { broadcast: { self: true } },
    });
    voiceChRef.current = ch;

    ch.on("broadcast", { event: EVENTS.WAITING_VOICE_MODE }, ({ payload }: { payload: { mode?: VoiceMode } }) => {
      const m = payload?.mode;
      if (m === "open" || m === "controlled") setVoiceModeState(m);
    });

    ch.on(
      "broadcast",
      { event: EVENTS.WAITING_SPEAK_REQUEST },
      ({ payload }: { payload: { memberId?: string } }) => {
        const id = payload?.memberId;
        if (!id) return;
        setSpeakRequests((prev) => (prev.includes(id) ? prev : [...prev, id]));
      },
    );

    ch.on(
      "broadcast",
      { event: EVENTS.WAITING_SPEAK_APPROVE },
      ({ payload }: { payload: { memberId?: string } }) => {
        const id = payload?.memberId;
        if (!id) return;
        setApprovedSpeakers((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setSpeakRequests((prev) => prev.filter((x) => x !== id));
      },
    );

    ch.on(
      "broadcast",
      { event: EVENTS.WAITING_SPEAK_DENY },
      ({ payload }: { payload: { memberId?: string } }) => {
        const id = payload?.memberId;
        if (!id) return;
        setSpeakRequests((prev) => prev.filter((x) => x !== id));
        setApprovedSpeakers((prev) => prev.filter((x) => x !== id));
      },
    );

    ch.on(
      "broadcast",
      { event: EVENTS.WAITING_VOICE_JOIN },
      ({ payload }: { payload: { memberId?: string } }) => {
        const id = payload?.memberId;
        if (!id) return;
        setVoiceJoinedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      },
    );

    ch.on(
      "broadcast",
      { event: EVENTS.WAITING_VOICE_LEAVE },
      ({ payload }: { payload: { memberId?: string } }) => {
        const id = payload?.memberId;
        if (!id) return;
        setVoiceJoinedIds((prev) => prev.filter((x) => x !== id));
      },
    );

    voiceSubscribedRef.current = new Promise<void>((resolve, reject) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(new Error(`voice channel ${status}`));
        }
      });
    });
    return () => {
      voiceChRef.current = null;
      voiceSubscribedRef.current = null;
      void supabase?.removeChannel(ch);
    };
  }, [enabled, tripId]);

  const setVoiceMode = useCallback(
    async (mode: VoiceMode) => {
      if (!canModerateVoice) return;
      setVoiceModeState(mode);
      await broadcast(EVENTS.WAITING_VOICE_MODE, { mode });
    },
    [broadcast, canModerateVoice],
  );

  const joinVoice = useCallback(async () => {
    if (!localMemberId) return;
    if (!supabase) {
      setWebrtcError("Supabase is not configured (EXPO_PUBLIC_SUPABASE_URL / ANON_KEY).");
      setWebrtcStatus("error");
      return;
    }
    setVideoCallActive(true);
    setWebrtcError(null);
    await broadcast(EVENTS.WAITING_VOICE_JOIN, { memberId: localMemberId });

    p2pRef.current?.stop();
    const p2p = new WaitingRoomP2P(supabase, tripIdRef.current, localMemberId, {
      onRemoteStreamsChange: () => {},
      onStatus: setWebrtcStatus,
      onError: setWebrtcError,
    });
    p2pRef.current = p2p;
    await p2p.start();
    const ids = [...new Set([...voiceJoinedIdsRef.current, localMemberId])];
    await p2p.syncRemotePeers(ids);
  }, [broadcast, localMemberId]);

  const leaveVoice = useCallback(async () => {
    if (!localMemberId) return;
    p2pRef.current?.stop();
    p2pRef.current = null;
    await broadcast(EVENTS.WAITING_VOICE_LEAVE, { memberId: localMemberId });
    setVideoCallActive(false);
    setWebrtcStatus("idle");
  }, [broadcast, localMemberId]);

  useEffect(() => {
    if (!videoCallActive || !localMemberId || !p2pRef.current) return;
    const ids = voiceJoinedIds.includes(localMemberId) ? voiceJoinedIds : [...voiceJoinedIds, localMemberId];
    void p2pRef.current.syncRemotePeers(ids);
  }, [videoCallActive, localMemberId, voiceJoinedIds]);

  const requestToSpeak = useCallback(async () => {
    if (!localMemberId) return;
    await broadcast(EVENTS.WAITING_SPEAK_REQUEST, { memberId: localMemberId });
  }, [broadcast, localMemberId]);

  const allowSpeaker = useCallback(
    async (targetId: string) => {
      if (!canModerateVoice) return;
      await broadcast(EVENTS.WAITING_SPEAK_APPROVE, { memberId: targetId });
    },
    [broadcast, canModerateVoice],
  );

  const denySpeaker = useCallback(
    async (targetId: string) => {
      if (!canModerateVoice) return;
      await broadcast(EVENTS.WAITING_SPEAK_DENY, { memberId: targetId });
    },
    [broadcast, canModerateVoice],
  );

  return {
    voiceMode,
    setVoiceMode,
    videoCallActive,
    joinVoice,
    leaveVoice,
    speakRequests,
    approvedSpeakers,
    voiceJoinedIds,
    webrtcStatus,
    webrtcError,
    requestToSpeak,
    allowSpeaker,
    denySpeaker,
  };
}
