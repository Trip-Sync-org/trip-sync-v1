/**
 * POST /api/voice/mode — stores talk mode in Supabase; members must leave voice when mode is staff-only (client-side).
 */

import { setTripVoiceMode } from '../../lib/supabase.js';
import { broadcast, EVENTS } from '../../lib/realtime.js';
import { getAuthContext, sendError, handleOptions, requireCapability } from '../../lib/permissions.js';
import { TALK_MODES } from '../../../shared/voiceConstants.js';

// Clients with role 'member' that receive mode='staff' must close their RTCPeerConnection and leave the voice channel.

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = typeof req.body === 'string' ? req.body : '';
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { userId, role, tripId } = await getAuthContext(req);
    requireCapability(role, 'canSwitchMode');

    const body = parseBody(req);
    const { mode } = body;

    if (mode !== TALK_MODES.ALL && mode !== TALK_MODES.STAFF) {
      throw Object.assign(new Error("BAD_REQUEST: mode must be 'all' or 'staff'"), { status: 400 });
    }

    await setTripVoiceMode(tripId, mode, userId);
    await broadcast(tripId, EVENTS.MODE_CHANGED, {
      mode,
      changedBy: userId,
    });

    res.status(200).json({ success: true, mode });
  } catch (err) {
    sendError(res, err);
  }
}
