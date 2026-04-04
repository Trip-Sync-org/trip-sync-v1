/**
 * Web-only: microphone permission + AudioContext policies (Chrome/Edge/Safari).
 * getUserMedia requires a secure context (HTTPS or localhost).
 */

export function assertMicEnvironment(): void {
  if (typeof window === "undefined") return;
  if (!window.isSecureContext) {
    throw new Error(
      "Microphone needs a secure page (HTTPS or localhost). Open this trip over https:// or http://localhost — not a raw IP without HTTPS.",
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "This browser cannot access the microphone here. Use a current Chrome, Edge, or Firefox, or enable microphone access in site settings.",
    );
  }
}

export function micErrorMessage(err: unknown): string {
  const d = err as DOMException & { name?: string };
  const name = d?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Microphone permission denied. Use the lock or tune icon in the address bar → Site settings → Microphone → Allow, then click Join Voice Channel again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone detected. Plug in a mic or pick one in your system sound settings.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone is busy or unavailable. Close other tabs or apps using the mic and try again.";
  }
  if (name === "OverconstrainedError") {
    return "Your device could not satisfy the audio settings. Try again or use another browser.";
  }
  if (name === "SecurityError") {
    return "Microphone is blocked for this page. Use HTTPS (or localhost) and allow the site to use the microphone.";
  }
  const msg = typeof d?.message === "string" ? d.message : "";
  if (msg) return msg;
  return "Microphone access failed. Check browser permissions and try Join again.";
}

/** Request mic with processing; fall back to plain audio if constraints fail (some browsers). */
export async function getMicStreamForVoice(): Promise<MediaStream> {
  assertMicEnvironment();
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (first) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (second) {
      throw new Error(micErrorMessage(second));
    }
  }
}

/** Browsers often start AudioContext in "suspended" until after a user gesture; resume after mic is granted. */
export async function resumeAudioContextIfNeeded(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}
