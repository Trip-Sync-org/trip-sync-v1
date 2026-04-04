/**
 * Mirror of repo root `shared/voiceConstants.js` — duplicated here so Metro resolves
 * without leaving the `mobile/` app root (fixes UnableToResolveError on Android).
 * Keep in sync when changing voice event names or ICE servers.
 */

export const ROLES = {
  ORGANIZER: 'organizer',
  CO_ADMIN: 'co_admin',
  MODERATOR: 'moderator',
  MEMBER: 'member',
};

export const TALK_MODES = {
  ALL: 'all',
  STAFF: 'staff',
};

export const STAFF_ROLES = ['organizer', 'co_admin', 'moderator'];

export const VOICE_PERMISSIONS = {
  organizer:  { canMute: true,  canBlock: true,  canAssignRole: true,  canKickFromVoice: true,  canSwitchMode: true,  canSpeak: true, canHearStaff: true },
  co_admin:   { canMute: true,  canBlock: true,  canAssignRole: false, canKickFromVoice: true,  canSwitchMode: false, canSpeak: true, canHearStaff: true },
  moderator:  { canMute: true,  canBlock: false, canAssignRole: false, canKickFromVoice: false, canSwitchMode: false, canSpeak: true, canHearStaff: true },
  member:     { canMute: false, canBlock: false, canAssignRole: false, canKickFromVoice: false, canSwitchMode: false, canSpeak: true, canHearStaff: false },
};

export const ASSIGNABLE_ROLES = ['member', 'moderator', 'co_admin'];

export const ROLE_LABELS = {
  organizer: 'Organizer',
  co_admin: 'Co-Admin',
  moderator: 'Moderator',
  member: 'Member',
};

export const ROLE_COLORS = {
  organizer: '#F5A623',
  co_admin: '#7B61FF',
  moderator: '#34C759',
  member: '#8E8E93',
};

// Supabase Realtime channel name per trip
export const tripChannel = (tripId) => `voice-trip-${tripId}`;

// WebRTC signaling channel name per trip
export const signalingChannel = (tripId) => `signal-trip-${tripId}`;

// Realtime event names
export const EVENTS = {
  ROLE_UPDATED:       'voice:role-updated',
  PARTICIPANT_MUTED:  'voice:muted',
  PARTICIPANT_KICKED: 'voice:kicked',
  MODE_CHANGED:       'voice:mode-changed',
  // WebRTC signaling events (handled client-to-client via Supabase Realtime)
  SIGNAL_OFFER:       'signal:offer',
  SIGNAL_ANSWER:      'signal:answer',
  SIGNAL_ICE:         'signal:ice',
  PEER_JOINED:        'signal:peer-joined',
  PEER_LEFT:          'signal:peer-left',
  /** Waiting room (pre-trip) — UI + speak queue, synced over Realtime broadcast */
  WAITING_VOICE_MODE:        'voice:waiting-mode',
  WAITING_SPEAK_REQUEST:     'voice:waiting-speak-request',
  WAITING_SPEAK_APPROVE:     'voice:waiting-speak-approve',
  WAITING_SPEAK_DENY:        'voice:waiting-speak-deny',
  WAITING_VOICE_JOIN:        'voice:waiting-join',
  WAITING_VOICE_LEAVE:       'voice:waiting-leave',
  RAISE_HAND:                'voice:raise-hand',
  LOWER_HAND:                'voice:lower-hand',
  SPEAK_APPROVED:            'voice:speak-approved',
};

export function isExpoGo() {
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    const ex =
      g.__expo_constants ??
      g.expo?.constants ??
      (typeof g.expo !== 'undefined' ? g.expo : null);
    if (ex?.appOwnership === 'expo') return true;
    if (g.__DEV__ && g.navigator?.userAgent?.includes?.('Expo')) return true;
  } catch {
    /* ignore */
  }
  return false;
}

// Free public STUN servers — no signup required
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },  // Cloudflare free STUN
];
