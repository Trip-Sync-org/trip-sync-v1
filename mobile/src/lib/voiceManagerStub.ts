/**
 * No-op voice manager for Expo Go / missing native WebRTC — avoids importing react-native-webrtc at load time.
 */

import type { SignalPayload, VoiceManagerApi, VoiceMode } from "./voiceManagerTypes";

export class StubVoiceManager implements VoiceManagerApi {
  onRemoteStream?: (userId: number, stream: unknown) => void;
  onStreamRemoved?: (userId: number) => void;
  onSignal?: (payload: SignalPayload) => void;

  constructor(
    _myUserId: number,
    _tripId: number,
  ) {}

  async start(): Promise<void> {
    throw new Error(
      "WEBRTC_UNAVAILABLE: Convoy voice needs native WebRTC. Use a dev build: npx expo prebuild && npx expo run:android (or run:ios). Expo Go does not include WebRTC.",
    );
  }

  stop(): void {}

  async callRider(_remoteUserId: number): Promise<void> {}

  async handleOffer(_fromUserId: number, _sdp: string): Promise<void> {}

  async handleAnswer(_fromUserId: number, _sdp: string): Promise<void> {}

  async handleIceCandidate(_fromUserId: number, _candidate: Record<string, unknown>): Promise<void> {}

  removeRider(_userId: number): void {}

  setMuted(_muted: boolean): void {}

  getMuted(): boolean {
    return true;
  }

  setVoiceMode(_mode: VoiceMode, _canSpeak: boolean): void {}

  setBlocked(_userId: number, _blocked: boolean): void {}

  setRemoteMuted(_userId: number, _muted: boolean): void {}

  getConnectedRiders(): number[] {
    return [];
  }
}
