/**
 * Map between mobile waiting-room voice mode and API/DB talk mode.
 */

export type VoiceMode = "open" | "controlled";

export function voiceModeToApiMode(mode: VoiceMode): "all" | "staff" {
  return mode === "open" ? "all" : "staff";
}

export function apiModeToVoiceMode(mode: string | null | undefined): VoiceMode {
  return String(mode || "").toLowerCase() === "all" ? "open" : "controlled";
}
