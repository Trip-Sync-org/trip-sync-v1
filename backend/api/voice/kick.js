/**
 * POST /api/voice/kick — blocks and/or mutes in Supabase; clients must tear down WebRTC when they receive PARTICIPANT_KICKED.
 */

import { blockMember, setMemberMuted } from '../../lib/supabase.js';
import { broadcast, EVENTS } from '../../lib/realtime.js';
import { getAuthContext, sendError, handleOptions, requireCapability } from '../../lib/permissions.js';

// The client that receives PARTICIPANT_KICKED must close its RTCPeerConnection and disconnect from the voice channel.

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
    requireCapability(role, 'canKickFromVoice');

    const body = parseBody(req);
    const { targetUserId, block } = body;

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw Object.assign(new Error('BAD_REQUEST: targetUserId required'), { status: 400 });
    }

    if (block === true) {
      await blockMember(tripId, targetUserId);
    }
    await setMemberMuted(tripId, targetUserId, true);

    await broadcast(tripId, EVENTS.PARTICIPANT_KICKED, {
      userId: targetUserId,
      kickedBy: userId,
      block: Boolean(block),
    });

    res.status(200).json({ success: true, block: Boolean(block) });
  } catch (err) {
    sendError(res, err);
  }
}
