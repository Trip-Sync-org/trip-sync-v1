/**
 * Shared types for convoy voice (no react-native-webrtc import — safe in Expo Go).
 */

export type VoiceMode = "open" | "controlled";

export type SignalPayload =
  | { type: "voice-offer"; fromUserId: number; toUserId: number; sdp: string }
  | { type: "voice-answer"; fromUserId: number; toUserId: number; sdp: string }
  | { type: "voice-ice"; fromUserId: number; toUserId: number; candidate: Record<string, unknown> }
  | { type: "voice-muted"; userId: number; muted: boolean };

/** Public API implemented by the real WebRTC manager and the Expo Go stub. */
export interface VoiceManagerApi {
  onRemoteStream?: (userId: number, stream: unknown) => void;
  onStreamRemoved?: (userId: number) => void;
  onSignal?: (payload: SignalPayload) => void;

  start(): Promise<void>;
  stop(): void;
  callRider(remoteUserId: number): Promise<void>;
  handleOffer(fromUserId: number, sdp: string): Promise<void>;
  handleAnswer(fromUserId: number, sdp: string): Promise<void>;
  handleIceCandidate(fromUserId: number, candidate: Record<string, unknown>): Promise<void>;
  removeRider(userId: number): void;
  setMuted(muted: boolean): void;
  getMuted(): boolean;
  setVoiceMode(mode: VoiceMode, canSpeak: boolean): void;
  setBlocked(userId: number, blocked: boolean): void;
  setRemoteMuted(userId: number, muted: boolean): void;
  getConnectedRiders(): number[];
}
