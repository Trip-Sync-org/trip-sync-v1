/**
 * Factory for convoy voice: avoids loading react-native-webrtc in Expo Go (prevents crash at import).
 * Real WebRTC loads only in dev / release builds that include the native module.
 */

import Constants from "expo-constants";
import type { VoiceManagerApi } from "./voiceManagerTypes";

export type { VoiceMode, SignalPayload, VoiceManagerApi } from "./voiceManagerTypes";

export function createVoiceManager(myUserId: number, tripId: number): VoiceManagerApi {
  if (Constants.appOwnership === "expo") {
    const { StubVoiceManager } = require("./voiceManagerStub") as typeof import("./voiceManagerStub");
    return new StubVoiceManager(myUserId, tripId);
  }
  try {
    const { VoiceManager } = require("./voiceManagerImpl") as typeof import("./voiceManagerImpl");
    return new VoiceManager(myUserId, tripId);
  } catch {
    const { StubVoiceManager } = require("./voiceManagerStub") as typeof import("./voiceManagerStub");
    return new StubVoiceManager(myUserId, tripId);
  }
}
