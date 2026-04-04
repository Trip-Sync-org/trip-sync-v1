/**
 * POST /api/voice/role — persists role changes in Supabase Postgres; notifies clients via Supabase Realtime.
 */

import { updateMemberRole } from '../../lib/supabase.js';
import { broadcast, EVENTS } from '../../lib/realtime.js';
import {
  getAuthContext,
  sendError,
  handleOptions,
  requireCapability,
  canAssignRole,
} from '../../lib/permissions.js';
import { ASSIGNABLE_ROLES } from '../../../shared/voiceConstants.js';

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
    requireCapability(role, 'canAssignRole');

    const body = parseBody(req);
    const { targetUserId, newRole } = body;

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw Object.assign(new Error('BAD_REQUEST: targetUserId required'), { status: 400 });
    }
    if (!newRole || typeof newRole !== 'string') {
      throw Object.assign(new Error('BAD_REQUEST: newRole required'), { status: 400 });
    }
    if (!ASSIGNABLE_ROLES.includes(newRole)) {
      throw Object.assign(new Error(`BAD_REQUEST: invalid newRole '${newRole}'`), { status: 400 });
    }
    if (!canAssignRole(role, newRole)) {
      throw Object.assign(new Error('FORBIDDEN: cannot assign this role'), { status: 403 });
    }

    await updateMemberRole(tripId, targetUserId, newRole);
    await broadcast(tripId, EVENTS.ROLE_UPDATED, {
      userId: targetUserId,
      newRole,
      updatedBy: userId,
    });

    res.status(200).json({ success: true, userId: targetUserId, newRole });
  } catch (err) {
    sendError(res, err);
  }
}
