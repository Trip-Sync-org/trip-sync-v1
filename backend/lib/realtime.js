/**
 * Supabase Realtime broadcast helpers — uses the open-source Realtime server (included with Supabase).
 * No third-party paid pub/sub; events go over your Supabase project’s Realtime channels.
 */

// backend/lib/realtime.js
// Broadcasts events to all connected clients via Supabase Realtime.
// Supabase Realtime is free and open source — no Pusher needed.

import { supabase } from './supabase.js';
import { EVENTS, tripChannel } from '../../shared/voiceConstants.js';

export { EVENTS };

/**
 * Socket.IO (Express + socket.io) — checkpoint / map-pin events. No-op if `io` is missing (e.g. serverless).
 * Room name matches `server.impl.ts`: `trip-${tripId}`.
 *
 * @param {import('socket.io').Server | null | undefined} io
 * @param {number} tripId
 * @param {object} [payload]
 */
export function emitCheckpointsUpdated(io, tripId, payload) {
  if (!io || !Number.isFinite(Number(tripId))) return;
  io.to(`trip-${Number(tripId)}`).emit('checkpoints:updated', payload ?? { tripId: Number(tripId) });
}

/**
 * Emit only to sockets in the trip room whose `socket.tripRole` is staff (set in server identify).
 * Room name matches server.impl.ts: `trip-${tripId}`.
 *
 * @param {import('socket.io').Server | null | undefined} io
 * @param {number} tripId
 * @param {string} event
 * @param {object} payload
 */
export function emitToPrivileged(io, tripId, event, payload) {
  if (!io || !Number.isFinite(Number(tripId))) return;
  const roomName = `trip-${Number(tripId)}`;
  const room = io.sockets.adapter.rooms.get(roomName);
  if (!room) return;
  for (const socketId of room) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) continue;
    const r = String(s.tripRole ?? '')
      .toLowerCase()
      .replace(/-/g, '_');
    if (r === 'organizer' || r === 'co_admin' || r === 'moderator') {
      s.emit(event, payload);
    }
  }
}

/**
 * Legacy helper — prefer `emitToPrivileged` with explicit tripId.
 * Kept for callers that still pass tripUserRoles maps; forwards to room-based emit when payload has tripId.
 *
 * @param {import('socket.io').Server | null | undefined} io
 * @param {Map<number, Map<number, string>> | undefined} tripUserRoles
 * @param {Map<number, string> | undefined} ridersForTrip
 * @param {object} payload
 */
export function emitMapPinRequestedToStaff(io, tripUserRoles, ridersForTrip, payload) {
  const tid = payload?.tripId ?? payload?.request?.trip_id;
  if (io && tid != null && Number.isFinite(Number(tid))) {
    emitToPrivileged(io, Number(tid), 'map_pin:requested', payload);
    return;
  }
  if (!io || !ridersForTrip?.size) return;
  for (const [uid, socketId] of ridersForTrip.entries()) {
    const r = String(tripUserRoles?.get(uid) ?? 'member').toLowerCase().replace(/-/g, '_');
    if (r === 'organizer' || r === 'co_admin' || r === 'moderator') {
      io.to(socketId).emit('map_pin:requested', payload);
    }
  }
}

/**
 * @param {import('socket.io').Server | null | undefined} io
 * @param {string} targetSocketId
 * @param {object} payload
 */
export function emitMapPinReviewedToUser(io, targetSocketId, payload) {
  if (!io || !targetSocketId || typeof targetSocketId !== 'string') return;
  io.to(targetSocketId).emit('map_pin:reviewed', payload);
}

/**
 * Broadcast an event to all clients subscribed to a trip's voice channel.
 * Uses Supabase's broadcast feature (part of Realtime, free tier).
 *
 * @param {string} tripId
 * @param {string} event    - one of EVENTS.*
 * @param {object} payload  - data to send to clients
 */
export async function broadcast(tripId, event, payload) {
  const channel = supabase.channel(tripChannel(tripId));

  // Supabase broadcast: send once then unsubscribe
  return new Promise((resolve) => {
    channel
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.send({
            type: 'broadcast',
            event,
            payload,
          });
          await supabase.removeChannel(channel);
          resolve();
        }
      });

    // Timeout safety
    setTimeout(() => {
      supabase.removeChannel(channel);
      resolve(); // don't fail the API call if broadcast times out
    }, 3000);
  });
}
