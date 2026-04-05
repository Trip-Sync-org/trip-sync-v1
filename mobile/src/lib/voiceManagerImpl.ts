/**
 * WebRTC mesh for convoy voice — loaded only when native react-native-webrtc exists (dev / release builds).
 */

import InCallManager from "react-native-incall-manager";
import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
} from "react-native-webrtc";
import type { SignalPayload, VoiceManagerApi, VoiceMode } from "./voiceManagerTypes";

export type { VoiceMode, SignalPayload } from "./voiceManagerTypes";

const ICE_SERVERS: RTCConfiguration["iceServers"] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export class VoiceManager implements VoiceManagerApi {
  private localStream: MediaStream | null = null;
  private peers = new Map<number, RTCPeerConnection>();
  private remoteStreams = new Map<number, MediaStream>();
  private myUserId: number;
  private tripId: number;
  private isMuted = false;
  private blockedUserIds = new Set<number>();
  private voiceMode: VoiceMode = "open";
  private canSpeak = true;

  onRemoteStream?: (userId: number, stream: unknown) => void;
  onStreamRemoved?: (userId: number) => void;
  onSignal?: (payload: SignalPayload) => void;

  constructor(myUserId: number, tripId: number) {
    this.myUserId = myUserId;
    this.tripId = tripId;
  }

  async start(): Promise<void> {
    this.localStream = await mediaDevices.getUserMedia({
      // RN accepts extended audio constraints; DOM typings omit them.
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    } as Parameters<typeof mediaDevices.getUserMedia>[0]);

    try {
      InCallManager.start({ media: "audio", ringback: "" });
      InCallManager.setForceSpeakerphoneOn(true);
      InCallManager.setSpeakerphoneOn(true);
    } catch (err) {
      console.warn("[voice] InCallManager start failed (non-fatal):", err);
    }

    console.log("[voice] local stream started");
  }

  stop(): void {
    this.peers.forEach((pc, userId) => {
      pc.close();
      this.onStreamRemoved?.(userId);
    });
    this.peers.clear();
    this.remoteStreams.clear();

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;

    try {
      InCallManager.stop();
    } catch (err) {
      console.warn("[voice] InCallManager stop failed (non-fatal):", err);
    }

    console.log("[voice] stopped");
  }

  private createPeer(remoteUserId: number): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const ev = pc as RTCPeerConnection & {
      addEventListener(type: string, listener: (e: unknown) => void): void;
    };

    this.localStream?.getTracks().forEach((track) => {
      if (this.localStream) pc.addTrack(track, this.localStream);
    });

    ev.addEventListener("track", (e: unknown) => {
      const event = e as { streams?: MediaStream[] };
      const stream = event.streams?.[0];
      if (!stream) return;
      if (this.blockedUserIds.has(remoteUserId)) return;

      this.remoteStreams.set(remoteUserId, stream);
      this.onRemoteStream?.(remoteUserId, stream);
    });

    ev.addEventListener("icecandidate", (e: unknown) => {
      const event = e as { candidate?: RTCIceCandidate | null };
      if (!event.candidate) return;
      const c = event.candidate.toJSON ? event.candidate.toJSON() : (event.candidate as unknown as Record<string, unknown>);
      this.onSignal?.({
        type: "voice-ice",
        fromUserId: this.myUserId,
        toUserId: remoteUserId,
        candidate: c as Record<string, unknown>,
      });
    });

    ev.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        try {
          pc.restartIce();
        } catch {
          /* noop */
        }
      }
    });

    this.peers.set(remoteUserId, pc);
    return pc;
  }

  async callRider(remoteUserId: number): Promise<void> {
    if (this.peers.has(remoteUserId)) return;
    const pc = this.createPeer(remoteUserId);

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await pc.setLocalDescription(offer);

    this.onSignal?.({
      type: "voice-offer",
      fromUserId: this.myUserId,
      toUserId: remoteUserId,
      sdp: offer.sdp ?? "",
    });
  }

  async handleOffer(fromUserId: number, sdp: string): Promise<void> {
    const existing = this.peers.get(fromUserId);
    const pc = existing ?? this.createPeer(fromUserId);

    await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.onSignal?.({
      type: "voice-answer",
      fromUserId: this.myUserId,
      toUserId: fromUserId,
      sdp: answer.sdp ?? "",
    });
  }

  async handleAnswer(fromUserId: number, sdp: string): Promise<void> {
    const pc = this.peers.get(fromUserId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
  }

  async handleIceCandidate(fromUserId: number, candidate: Record<string, unknown>): Promise<void> {
    const pc = this.peers.get(fromUserId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      /* ignore */
    }
  }

  removeRider(userId: number): void {
    const pc = this.peers.get(userId);
    if (pc) {
      pc.close();
      this.peers.delete(userId);
    }
    this.remoteStreams.delete(userId);
    this.onStreamRemoved?.(userId);
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.onSignal?.({
      type: "voice-muted",
      userId: this.myUserId,
      muted,
    });
  }

  getMuted(): boolean {
    return this.isMuted;
  }

  setVoiceMode(mode: VoiceMode, canSpeak: boolean): void {
    this.voiceMode = mode;
    this.canSpeak = canSpeak;

    if (mode === "controlled" && !canSpeak) {
      this.localStream?.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
      this.isMuted = true;
    } else if (mode === "open") {
      this.localStream?.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
      this.isMuted = false;
    } else if (mode === "controlled" && canSpeak) {
      this.localStream?.getAudioTracks().forEach((t) => {
        t.enabled = !this.isMuted;
      });
    }
  }

  setBlocked(userId: number, blocked: boolean): void {
    if (blocked) {
      this.blockedUserIds.add(userId);
      const stream = this.remoteStreams.get(userId);
      stream?.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
    } else {
      this.blockedUserIds.delete(userId);
      const stream = this.remoteStreams.get(userId);
      stream?.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
    }
  }

  setRemoteMuted(userId: number, muted: boolean): void {
    const stream = this.remoteStreams.get(userId);
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  getConnectedRiders(): number[] {
    return Array.from(this.peers.keys());
  }
}
