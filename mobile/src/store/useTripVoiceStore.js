import { create } from 'zustand';

/**
 * Global LiveKit voice state for the active trip.
 * status: 'IDLE' | 'CONNECTED' | 'DISCONNECTED'
 */
const useTripVoiceStore = create((set) => ({
  status: 'IDLE',
  isMuted: false,
  isSpeakerOn: true,
  setStatus: (status) => set({ status }),
  setMuted: (isMuted) => set({ isMuted }),
  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
  toggleSpeaker: () => set((state) => ({ isSpeakerOn: !state.isSpeakerOn })),
  reset: () => set({ status: 'IDLE', isMuted: false, isSpeakerOn: true }),
}));

export default useTripVoiceStore;
