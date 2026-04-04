/**
 * WebRTC peer mesh for waiting-room voice (P2P audio via free STUN; signaling over Supabase Realtime).
 * Requires a development build — Expo Go does not ship react-native-webrtc native code.
 */

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { NativeModules } from "react-native";
import { EVENTS, ICE_SERVERS, signalingChannel } from "../../shared/voiceConstants.js";

/** RN MediaStream shape we use — do not import react-native-webrtc at file load (it throws without native code). */
type RNMediaStream = {
  getTracks: () => Array<{ stop: () => void }>;
};

export type WaitingRoomP2PCallbacks = {
  onRemoteStreamsChange: (streams: Map<string, RNMediaStream>) => void;
  onStatus: (s: "idle" | "connecting" | "connected" | "error") => void;
  onError: (msg: string | null) => void;
};

type WrtcMod = {
  mediaDevices?: { getUserMedia: (c: { audio: boolean; video: boolean }) => Promise<MediaStream> };
  registerGlobals?: () => void;
  RTCPeerConnection: new (c: RTCConfiguration) => RTCPeerConnection;
  RTCSessionDescription: new (init: RTCSessionDescriptionInit) => RTCSessionDescription;
  RTCIceCandidate: new (init: Record<string, unknown>) => RTCIceCandidate;
};

/** Metro/babel often wraps CJS in `{ default: moduleExports }` — unwrap so `mediaDevices` exists. */
function unwrapReactNativeWebrtc(mod: unknown): WrtcMod {
  if (!mod || typeof mod !== "object") return mod as WrtcMod;
  const m = mod as Record<string, unknown>;
  if (m.mediaDevices && typeof m.mediaDevices === "object") {
    return mod as WrtcMod;
  }
  const d = m.default;
  if (d && typeof d === "object") {
    const inner = d as Record<string, unknown>;
    if (inner.mediaDevices || inner.RTCPeerConnection) {
      return d as WrtcMod;
    }
  }
  return mod as WrtcMod;
}

type SignalPayload = { from?: string; to?: string; sdp?: string };
type IcePayload = { from?: string; to?: string; candidate?: Record<string, unknown> };

/** Lower memberId creates the offer to higher id (avoids offer/answer glare). */
export class WaitingRoomP2P {
  private supabase: SupabaseClient;
  private tripId: string;
  private selfId: string;
  private wrtc: WrtcMod | null = null;
  private signalCh: RealtimeChannel | null = null;
  private localStream: RNMediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, RNMediaStream>();
  private cb: WaitingRoomP2PCallbacks;
  private iceServers: RTCConfiguration["iceServers"] = [];

  constructor(
    supabase: SupabaseClient,
    tripId: string,
    selfMemberId: string,
    callbacks: WaitingRoomP2PCallbacks,
  ) {
    this.supabase = supabase;
    this.tripId = tripId;
    this.selfId = selfMemberId;
    this.cb = callbacks;
  }

  async start(): Promise<void> {
    this.cb.onStatus("connecting");
    this.cb.onError(null);
    this.iceServers = ICE_SERVERS.map((s) => ({ ...s })) as RTCConfiguration["iceServers"];

    // Expo Go and other runtimes without the native module: never import react-native-webrtc (it throws in index.ts).
    const nm = NativeModules as { WebRTCModule?: unknown };
    if (nm.WebRTCModule == null) {
      this.cb.onError(
        "Expo Go has no WebRTC native module. Realtime (speak requests, mode) still works. For live audio, build a dev client: npx expo run:android or npx expo run:ios",
      );
      this.cb.onStatus("error");
      return;
    }

    try {
      const raw = await import("react-native-webrtc");
      this.wrtc = unwrapReactNativeWebrtc(raw);
      try {
        this.wrtc.registerGlobals?.();
      } catch {
        /* optional */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.cb.onError(`WebRTC: ${msg}`);
      this.cb.onStatus("error");
      return;
    }

    type Gum = (c: { audio: boolean; video: boolean }) => Promise<MediaStream>;
    let getUserMedia: Gum | undefined = this.wrtc.mediaDevices?.getUserMedia as Gum | undefined;
    if (!getUserMedia) {
      const nav = (globalThis as unknown as { navigator?: { mediaDevices?: { getUserMedia: Gum } } }).navigator;
      getUserMedia = nav?.mediaDevices?.getUserMedia;
    }
    if (!getUserMedia) {
      this.cb.onError(
        "WebRTC mediaDevices missing (bundler interop). Rebuild dev client: cd mobile && npx expo run:android",
      );
      this.cb.onStatus("error");
      return;
    }

    try {
      this.localStream = (await getUserMedia({
        audio: true,
        video: false,
      })) as unknown as RNMediaStream;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.cb.onError(`Microphone: ${msg}`);
      this.cb.onStatus("error");
      return;
    }

    this.signalCh = this.supabase.channel(signalingChannel(this.tripId), {
      config: { broadcast: { self: true } },
    });

    this.signalCh.on("broadcast", { event: EVENTS.SIGNAL_OFFER }, (msg: { payload: SignalPayload }) => {
      void this.handleOffer(msg.payload);
    });
    this.signalCh.on("broadcast", { event: EVENTS.SIGNAL_ANSWER }, (msg: { payload: SignalPayload }) => {
      void this.handleAnswer(msg.payload);
    });
    this.signalCh.on("broadcast", { event: EVENTS.SIGNAL_ICE }, (msg: { payload: IcePayload }) => {
      void this.handleIce(msg.payload);
    });

    await new Promise<void>((resolve, reject) => {
      this.signalCh!.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR") reject(new Error("signal channel error"));
      });
    });

    await this.sendSignal(EVENTS.PEER_JOINED, { peerId: this.selfId });
    this.cb.onStatus("connected");
  }

  /** Sync RTCPeerConnections when the set of peers in voice changes. */
  async syncRemotePeers(remoteVoiceMemberIds: string[]): Promise<void> {
    if (!this.wrtc || !this.localStream) return;
    const others = remoteVoiceMemberIds.filter((id) => id !== this.selfId);

    for (const rid of others) {
      if (this.peers.has(rid)) continue;
      if (this.selfId < rid) {
        await this.makeOfferTo(rid);
      }
    }

    for (const [rid, pc] of this.peers) {
      if (!others.includes(rid)) {
        pc.close();
        this.peers.delete(rid);
        this.remoteStreams.delete(rid);
        this.cb.onRemoteStreamsChange(new Map(this.remoteStreams));
      }
    }
  }

  private async makeOfferTo(remoteId: string): Promise<void> {
    if (!this.wrtc || !this.localStream) return;
    const { RTCPeerConnection } = this.wrtc;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(remoteId, pc);
    const pcAny = pc as unknown as {
      addTrack: (track: unknown, stream: RNMediaStream) => unknown;
      onicecandidate: ((e: { candidate: unknown }) => void) | null;
      ontrack: ((e: { streams: readonly RNMediaStream[] }) => void) | null;
    };
    for (const t of this.localStream.getTracks()) {
      pcAny.addTrack(t, this.localStream);
    }
    pcAny.onicecandidate = (e: { candidate: unknown }) => {
      if (e.candidate) {
        const c = e.candidate as { toJSON?: () => Record<string, unknown> };
        void this.sendSignal(EVENTS.SIGNAL_ICE, {
          from: this.selfId,
          to: remoteId,
          candidate: c.toJSON ? c.toJSON() : e.candidate,
        });
      }
    };
    pcAny.ontrack = (e: { streams: readonly RNMediaStream[] }) => {
      const stream = e.streams[0];
      if (stream) {
        this.remoteStreams.set(remoteId, stream);
        this.cb.onRemoteStreamsChange(new Map(this.remoteStreams));
      }
    };

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await this.sendSignal(EVENTS.SIGNAL_OFFER, { from: this.selfId, to: remoteId, sdp: offer.sdp ?? undefined });
  }

  private async handleOffer(payload: SignalPayload): Promise<void> {
    if (!this.wrtc || !this.localStream) return;
    if (payload.to !== this.selfId || !payload.from || payload.sdp == null) return;
    const from = payload.from;
    if (from >= this.selfId) return;

    const { RTCPeerConnection, RTCSessionDescription } = this.wrtc;
    let pc = this.peers.get(from);
    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: this.iceServers });
      this.peers.set(from, pc);
      const pcAny = pc as unknown as {
        addTrack: (track: unknown, stream: RNMediaStream) => unknown;
        onicecandidate: ((e: { candidate: unknown }) => void) | null;
        ontrack: ((e: { streams: readonly RNMediaStream[] }) => void) | null;
      };
      for (const t of this.localStream.getTracks()) {
        pcAny.addTrack(t, this.localStream);
      }
      pcAny.onicecandidate = (e: { candidate: unknown }) => {
        if (e.candidate) {
          const c = e.candidate as { toJSON?: () => Record<string, unknown> };
          void this.sendSignal(EVENTS.SIGNAL_ICE, {
            from: this.selfId,
            to: from,
            candidate: c.toJSON ? c.toJSON() : e.candidate,
          });
        }
      };
      pcAny.ontrack = (e: { streams: readonly RNMediaStream[] }) => {
        const stream = e.streams[0];
        if (stream) {
          this.remoteStreams.set(from, stream);
          this.cb.onRemoteStreamsChange(new Map(this.remoteStreams));
        }
      };
    }

    await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: payload.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await this.sendSignal(EVENTS.SIGNAL_ANSWER, { from: this.selfId, to: from, sdp: answer.sdp ?? undefined });
  }

  private async handleAnswer(payload: SignalPayload): Promise<void> {
    if (!this.wrtc) return;
    if (payload.to !== this.selfId || !payload.from || payload.sdp == null) return;
    const pc = this.peers.get(payload.from);
    if (!pc) return;
    await pc.setRemoteDescription(
      new this.wrtc.RTCSessionDescription({ type: "answer", sdp: payload.sdp }),
    );
  }

  private async handleIce(payload: IcePayload): Promise<void> {
    if (!this.wrtc) return;
    if (payload.to !== this.selfId || !payload.from || !payload.candidate) return;
    const pc = this.peers.get(payload.from);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new this.wrtc.RTCIceCandidate(payload.candidate));
    } catch {
      /* ignore late ice */
    }
  }

  private async sendSignal(event: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.signalCh) return;
    await this.signalCh.send({ type: "broadcast", event, payload });
  }

  stop(): void {
    for (const pc of this.peers.values()) {
      pc.close();
    }
    this.peers.clear();
    this.remoteStreams.clear();
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) {
        t.stop();
      }
      this.localStream = null;
    }
    if (this.signalCh) {
      void this.supabase.removeChannel(this.signalCh);
      this.signalCh = null;
    }
    this.wrtc = null;
    this.cb.onRemoteStreamsChange(new Map());
    this.cb.onStatus("idle");
  }
}
