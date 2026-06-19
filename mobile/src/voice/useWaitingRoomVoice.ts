/**
 * Waiting-room voice: Supabase Realtime syncs mode / speak queue / join presence.
 * WebRTC mesh audio is handled by useConvoyVoice + VoiceManager.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { apiFetch } from "../api/client";
import { supabase } from "../lib/supabase";
import { tripChannel, EVENTS } from "../../shared/voiceConstants.js";
import { apiModeToVoiceMode, voiceModeToApiMode, type VoiceMode } from "./voiceModeApi";

export type { VoiceMode };

type UseWaitingRoomVoiceOpts = {
  tripId: string;
  /** waiting room UI only */
  enabled: boolean;
  localMemberId: string | null;
  canModerateVoice: boolean;
  /** Numeric app user id — used to persist voice mode via API */
  userId?: number | null;
};

export function useWaitingRoomVoice({
  tripId,
  enabled,
  localMemberId,
  canModerateVoice,
  userId,
}: UseWaitingRoomVoiceOpts) {
  const [voiceMode, setVoiceModeState] = useState<VoiceMode>("controlled");
  const [videoCallActive, setVideoCallActive] = useState(false);
  const [speakRequests, setSpeakRequests] = useState<string[]>([]);
  const [approvedSpeakers, setApprovedSpeakers] = useState<string[]>([]);
  const [voiceJoinedIds, setVoiceJoinedIds] = useState<string[]>([]);

  const voiceChRef = useRef<RealtimeChannel | null>(null);
  const voiceSubscribedRef = useRef<Promise<void> | null>(null);

  const broadcast = useCallback(async (event: string, payload: Record<string, unknown>) => {
    if (!supabase) return;
    const ch = voiceChRef.current;
    if (!ch) return;
    if (voiceSubscribedRef.current) {
      await voiceSubscribedRef.current.catch(() => {});
    }
    await ch.send({ type: "broadcast", event, payload });
  }, []);

  /** Fetch persisted mode so late joiners get current state (not stale default). */
  useEffect(() => {
    if (!enabled || !tripId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/trips/${encodeURIComponent(tripId)}/voice-mode`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { mode?: string };
        if (cancelled) return;
        setVoiceModeState(apiModeToVoiceMode(body.mode));
      } catch (e) {
        if (__DEV__) console.warn("[voice] fetch voice-mode failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, tripId]);

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
      if (userId != null && Number.isFinite(userId) && userId > 0) {
        try {
          await apiFetch(`/api/trips/${encodeURIComponent(tripId)}/voice-mode`, {
            method: "PATCH",
            body: JSON.stringify({ mode: voiceModeToApiMode(mode), user_id: userId }),
          });
        } catch (e) {
          if (__DEV__) console.warn("[voice] persist voice-mode failed:", e);
        }
      }
    },
    [broadcast, canModerateVoice, tripId, userId],
  );

  const joinVoice = useCallback(async () => {
    if (!localMemberId) return;
    if (!supabase) return;
    setVideoCallActive(true);
    await broadcast(EVENTS.WAITING_VOICE_JOIN, { memberId: localMemberId });
  }, [broadcast, localMemberId]);

  const leaveVoice = useCallback(async () => {
    if (!localMemberId) return;
    await broadcast(EVENTS.WAITING_VOICE_LEAVE, { memberId: localMemberId });
    setVideoCallActive(false);
  }, [broadcast, localMemberId]);

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
    requestToSpeak,
    allowSpeaker,
    denySpeaker,
  };
}
