/**
 * Role checks for the voice API — permissions are defined in shared/voiceConstants.js (no external API).
 * Replace getAuthContext with Supabase Auth JWT verification when you wire real auth.
 */

// backend/lib/permissions.js
// Role-based access control + auth context extraction

import { VOICE_PERMISSIONS, STAFF_ROLES } from '../../shared/voiceConstants.js';

/** Roles that may manage checkpoints and review map pins (trip context). */
export const TRIP_STAFF_ROLES = ['organizer', 'co_admin', 'moderator'];

/**
 * @param {unknown} role - voice / trip_members role
 */
export function isTripStaffRole(role) {
  const r = String(role || '')
    .toLowerCase()
    .replace(/-/g, '_');
  if (r === 'co_admin' || r === 'coadmin') return true;
  return TRIP_STAFF_ROLES.includes(r);
}

/**
 * Check if a role has a specific capability. Throws 403 if not.
 */
export function requireCapability(role, capability) {
  const perms = VOICE_PERMISSIONS[role];
  if (!perms?.[capability]) {
    const err = new Error(`FORBIDDEN: role '${role}' cannot '${capability}'`);
    err.status = 403;
    throw err;
  }
}

/**
 * Check if requesterRole can assign targetRole.
 * Returns false (never throws) — caller decides the response.
 */
export function canAssignRole(requesterRole, targetRole) {
  if (targetRole === 'organizer') return false; // organizer set directly in DB
  if (targetRole === 'co_admin')  return requesterRole === 'organizer';
  if (targetRole === 'moderator') return ['organizer', 'co_admin'].includes(requesterRole);
  if (targetRole === 'member')    return STAFF_ROLES.includes(requesterRole);
  return false;
}

/**
 * Extract auth context from the request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TODO: Replace this stub with your real auth before going to production.
 *
 * Options (all free):
 *   - Supabase Auth: verify the JWT from supabase.auth.getUser(token)
 *   - Use supabase admin client: supabase.auth.admin.getUserById(userId)
 *   - Roll your own: verify with jose or jsonwebtoken
 *
 * Example with Supabase Auth (recommended — it's already in your stack):
 *
 *   import { createClient } from '@supabase/supabase-js';
 *   const userClient = createClient(process.env.SUPABASE_URL, token);
 *   const { data: { user }, error } = await userClient.auth.getUser();
 *   if (error || !user) throw unauthorized();
 *   // then fetch their role from trip_members table
 *   return { userId: user.id, displayName: user.email, role, tripId };
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * For now: expects Authorization header with a base64-encoded JSON token:
 *   btoa(JSON.stringify({ userId, displayName, role, tripId }))
 */
export async function getAuthContext(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw Object.assign(new Error('UNAUTHORIZED: missing Bearer token'), { status: 401 });
  }

  const token = authHeader.slice(7);
  let payload;
  try {
    payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch {
    throw Object.assign(new Error('UNAUTHORIZED: invalid token format'), { status: 401 });
  }

  const { userId, displayName, role, tripId } = payload;
  if (!userId || !role || !tripId) {
    throw Object.assign(
      new Error('UNAUTHORIZED: token must contain userId, role, and tripId'),
      { status: 401 }
    );
  }

  if (!VOICE_PERMISSIONS[role]) {
    throw Object.assign(new Error(`UNAUTHORIZED: unknown role '${role}'`), { status: 401 });
  }

  return { userId, displayName: displayName ?? userId, role, tripId };
}

/**
 * Send a structured error response.
 */
export function sendError(res, err) {
  const status = err.status || 500;
  console.error(`[VoiceAPI] ${status} — ${err.message}`);
  res.status(status).json({ error: err.message || 'Internal Server Error' });
}

/**
 * Handle OPTIONS preflight for CORS.
 * Call this at the top of every handler.
 */
export function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}
