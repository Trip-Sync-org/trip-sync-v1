/**
 * voiceManagerImpl — LiveKit migration stub
 *
 * The old WebRTC P2P voice manager has been replaced by LiveKit SFU (useConvoyVoice.ts).
 * This file is kept as a stub so voiceManager.ts factory doesn't break at import time.
 * It delegates to StubVoiceManager which is a no-op — actual voice is handled by LiveKit.
 */

export { StubVoiceManager as VoiceManager } from "./voiceManagerStub";
export type { VoiceMode, SignalPayload } from "./voiceManagerTypes";
