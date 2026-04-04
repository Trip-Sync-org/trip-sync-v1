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
