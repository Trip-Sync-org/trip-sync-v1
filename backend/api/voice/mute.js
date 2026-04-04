/**
 * POST /api/voice/mute — updates mute flag in Supabase; WebRTC mute is enforced on the client when clients receive the broadcast.
 */

import { setMemberMuted } from '../../lib/supabase.js';
import { broadcast, EVENTS } from '../../lib/realtime.js';
import { getAuthContext, sendError, handleOptions, requireCapability } from '../../lib/permissions.js';

// WebRTC mute is enforced CLIENT-SIDE: the client listens for PARTICIPANT_MUTED and sets
// audioTrack.enabled = false on the target peer's received track. For self-mute, the client mutes locally.
// This is the correct model for P2P WebRTC.

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
    requireCapability(role, 'canMute');

    const body = parseBody(req);
    const { targetUserId, mute } = body;

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw Object.assign(new Error('BAD_REQUEST: targetUserId required'), { status: 400 });
    }
    if (typeof mute !== 'boolean') {
      throw Object.assign(new Error('BAD_REQUEST: mute must be a boolean'), { status: 400 });
    }

    await setMemberMuted(tripId, targetUserId, mute);
    await broadcast(tripId, EVENTS.PARTICIPANT_MUTED, {
      userId: targetUserId,
      mutedBy: userId,
      mute,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
}
