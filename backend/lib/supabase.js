/**
 * Supabase admin client — uses the open-source Supabase hosted Postgres + Auth APIs (free tier).
 * Service role key bypasses RLS for trusted server-side operations only.
 */

// backend/lib/supabase.js
// Supabase admin client — uses service_role key (bypasses RLS)
// Only used server-side, never exposed to clients

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
}

// Admin client — has full DB access, bypasses Row Level Security
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Get a trip member's current role and blocked status.
 * @returns {Promise<{role, is_blocked, is_muted, display_name} | null>}
 */
export async function getMember(tripId, userId) {
  const { data, error } = await supabase
    .from('trip_members')
    .select('role, is_blocked, is_muted, display_name')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Upsert a trip member (create or update).
 */
export async function upsertMember({ tripId, userId, displayName, role = 'member' }) {
  const { error } = await supabase
    .from('trip_members')
    .upsert({ trip_id: tripId, user_id: userId, display_name: displayName, role },
             { onConflict: 'trip_id,user_id', ignoreDuplicates: false });
  if (error) throw error;
}

/**
 * Update a member's role.
 */
export async function updateMemberRole(tripId, userId, newRole) {
  const { error } = await supabase
    .from('trip_members')
    .update({ role: newRole })
    .eq('trip_id', tripId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Set a member's muted state.
 */
export async function setMemberMuted(tripId, userId, isMuted) {
  const { error } = await supabase
    .from('trip_members')
    .update({ is_muted: isMuted })
    .eq('trip_id', tripId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Block a member (sets is_blocked=true so they cannot rejoin).
 */
export async function blockMember(tripId, userId) {
  const { error } = await supabase
    .from('trip_members')
    .update({ is_blocked: true })
    .eq('trip_id', tripId)
    .eq('user_id', userId);
  if (error) throw error;
}

/**
 * Get or create the voice mode state for a trip.
 * @returns {Promise<'all' | 'staff'>}
 */
export async function getTripVoiceMode(tripId) {
  const { data, error } = await supabase
    .from('trip_voice_state')
    .select('active_mode')
    .eq('trip_id', tripId)
    .maybeSingle();
  if (error) throw error;
  return data?.active_mode ?? 'all';
}

/**
 * Set the voice mode for a trip.
 */
export async function setTripVoiceMode(tripId, mode, updatedBy) {
  const { error } = await supabase
    .from('trip_voice_state')
    .upsert({ trip_id: tripId, active_mode: mode, updated_by: updatedBy },
             { onConflict: 'trip_id' });
  if (error) throw error;
}

/**
 * List all non-blocked members of a trip.
 */
export async function listTripMembers(tripId) {
  const { data, error } = await supabase
    .from('trip_members')
    .select('user_id, display_name, role, is_muted, is_blocked')
    .eq('trip_id', tripId)
    .eq('is_blocked', false)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
