/**
 * Web: WebRTC mesh + Supabase signaling on signal-trip-{tripId}.
 */
import { useCallback, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, ICE_SERVERS, signalingChannel } from "../../../shared/voiceConstants.js";
import { fetchIceServers } from "../services/voiceApi.js";
import { getMicStreamForVoice, micErrorMessage, resumeAudioContextIfNeeded } from "../lib/micAccess";

export function useVoiceChannel({ tripId, userId, displayName, role, onLocalSpeaking }) {
  const selfId = String(userId);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeMode, setActiveMode] = useState("all");
  const [error, setError] = useState(null);
  const pcMap = useRef(new Map());
  const localStreamRef = useRef(null);
  const signalChRef = useRef(null);
  const remoteAudiosRef = useRef(new Map());
  const analyserRef = useRef(null);
  const speakIntervalRef = useRef(null);

  const cleanupRemoteAudio = (uid) => {
    const el = remoteAudiosRef.current.get(uid);
    if (el) {
      el.srcObject = null;
      el.remove();
      remoteAudiosRef.current.delete(uid);
    }
  };

  const attachRemote = (uid, stream) => {
    cleanupRemoteAudio(uid);
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.style.display = "none";
    audio.srcObject = stream;
    document.body.appendChild(audio);
    remoteAudiosRef.current.set(uid, audio);
  };

  const startSpeakingMeter = async (stream) => {
    stopSpeakingMeter();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      await resumeAudioContextIfNeeded(ctx);
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      analyserRef.current = { ctx, analyser };
      const data = new Uint8Array(analyser.frequencyBinCount);
      speakIntervalRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const speaking = rms > 0.04;
        setIsSpeaking(speaking);
        onLocalSpeaking?.(speaking);
      }, 100);
    } catch {
      /* ignore */
    }
  };

  const stopSpeakingMeter = () => {
    if (speakIntervalRef.current) {
      clearInterval(speakIntervalRef.current);
      speakIntervalRef.current = null;
    }
    try {
      analyserRef.current?.ctx?.close?.();
    } catch {
      /* ignore */
    }
    analyserRef.current = null;
    setIsSpeaking(false);
    onLocalSpeaking?.(false);
  };

  const sendSignal = async (event, payload) => {
    const ch = signalChRef.current;
    if (!ch) return;
    await ch.send({ type: "broadcast", event, payload });
  };

  const handleOffer = useCallback(
    async (payload, iceServers) => {
      const from = String(payload.from ?? "");
      const sdp = payload.sdp;
      if (payload.to !== selfId || !from || sdp == null) return;
      if (from >= selfId) return;

      const RTCP = window.RTCPeerConnection;
      let pc = pcMap.current.get(from);
      if (!pc) {
        pc = new RTCP({ iceServers });
        pcMap.current.set(from, pc);
        localStreamRef.current?.getTracks?.().forEach((t) => pc.addTrack(t, localStreamRef.current));
        pc.onicecandidate = (e) => {
          if (e.candidate)
            void sendSignal(EVENTS.SIGNAL_ICE, {
              from: selfId,
              to: from,
              candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
            });
        };
        pc.ontrack = (e) => {
          const stream = e.streams[0];
          if (stream) attachRemote(from, stream);
        };
      }
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(EVENTS.SIGNAL_ANSWER, { from: selfId, to: from, sdp: answer.sdp });
    },
    [selfId],
  );

  const handleAnswer = useCallback(async (payload) => {
    if (payload.to !== selfId || !payload.from || payload.sdp == null) return;
    const pc = pcMap.current.get(String(payload.from));
    if (!pc) return;
    await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
  }, [selfId]);

  const handleIce = useCallback(async (payload) => {
    if (payload.to !== selfId || !payload.from || !payload.candidate) return;
    const pc = pcMap.current.get(String(payload.from));
    if (!pc) return;
    try {
      await pc.addIceCandidate(payload.candidate);
    } catch {
      /* ignore */
    }
  }, [selfId]);

  const makeOfferTo = useCallback(
    async (remoteId, iceServers) => {
      const RTCP = window.RTCPeerConnection;
      const pc = new RTCP({ iceServers });
      pcMap.current.set(remoteId, pc);
      localStreamRef.current?.getTracks?.().forEach((t) => pc.addTrack(t, localStreamRef.current));
      pc.onicecandidate = (e) => {
        if (e.candidate)
          void sendSignal(EVENTS.SIGNAL_ICE, {
            from: selfId,
            to: remoteId,
            candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate,
          });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (stream) attachRemote(remoteId, stream);
      };
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      await sendSignal(EVENTS.SIGNAL_OFFER, { from: selfId, to: remoteId, sdp: offer.sdp });
    },
    [selfId],
  );

  const connect = useCallback(async () => {
    if (!tripId || !supabase) return;
    setIsConnecting(true);
    setError(null);
    try {
      let iceServers = ICE_SERVERS;
      try {
        const ice = await fetchIceServers();
        if (ice?.iceServers?.length) iceServers = ice.iceServers;
      } catch {
        /* fallback STUN */
      }

      const stream = await getMicStreamForVoice();
      localStreamRef.current = stream;
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !isMuted;
      });
      await startSpeakingMeter(stream);

      const ch = supabase.channel(signalingChannel(tripId), { config: { broadcast: { self: true } } });
      signalChRef.current = ch;

      ch.on("broadcast", { event: EVENTS.SIGNAL_OFFER }, ({ payload }) => {
        void handleOffer(payload, iceServers);
      });
      ch.on("broadcast", { event: EVENTS.SIGNAL_ANSWER }, ({ payload }) => {
        void handleAnswer(payload);
      });
      ch.on("broadcast", { event: EVENTS.SIGNAL_ICE }, ({ payload }) => {
        void handleIce(payload);
      });
      ch.on("broadcast", { event: EVENTS.PEER_JOINED }, ({ payload }) => {
        const pid = String(payload.peerId ?? payload.from ?? "");
        if (!pid || pid === selfId) return;
        if (selfId < pid) void makeOfferTo(pid, iceServers);
      });
      ch.on("broadcast", { event: EVENTS.PEER_LEFT }, ({ payload }) => {
        const pid = String(payload.peerId ?? payload.from ?? "");
        const pc = pcMap.current.get(pid);
        pc?.close();
        pcMap.current.delete(pid);
        cleanupRemoteAudio(pid);
      });

      await new Promise((resolve, reject) => {
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR") reject(new Error("signal"));
        });
      });

      await sendSignal(EVENTS.PEER_JOINED, {
        peerId: selfId,
        displayName: displayName ?? selfId,
        role: role ?? "member",
      });

      setIsConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : micErrorMessage(e));
    } finally {
      setIsConnecting(false);
    }
  }, [tripId, selfId, displayName, role, isMuted, handleOffer, handleAnswer, handleIce, makeOfferTo]);

  const disconnect = useCallback(async () => {
    stopSpeakingMeter();
    localStreamRef.current?.getTracks?.().forEach((t) => t.stop());
    localStreamRef.current = null;
    for (const [, pc] of pcMap.current) pc.close();
    pcMap.current.clear();
    for (const uid of remoteAudiosRef.current.keys()) cleanupRemoteAudio(uid);
    if (signalChRef.current) {
      await sendSignal(EVENTS.PEER_LEFT, { peerId: selfId });
      await supabase.removeChannel(signalChRef.current);
      signalChRef.current = null;
    }
    setIsConnected(false);
  }, [selfId]);

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    localStreamRef.current?.getAudioTracks?.().forEach((t) => {
      t.enabled = !next;
    });
  }, [isMuted]);

  return {
    isConnected,
    isConnecting,
    isMuted,
    isSpeaking,
    activeMode,
    setActiveMode,
    error,
    connect,
    disconnect,
    toggleMute,
  };
}
