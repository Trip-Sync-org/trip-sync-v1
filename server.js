/**
 * Trip-Sync Socket.IO Server — DigitalOcean standalone
 *
 * Deploy to: /var/www/tripsync-socket/server.js
 *
 * Supports the mobile app's event protocol:
 *   Location : join-trip, leave-trip, location-update  →  location-updated, trip-state-sync, rider-left, rider-joined
 *   Voice    : voice-join, voice-leave, voice-signal   →  voice-peers, voice-rider-joined, voice-rider-left, voice-signal
 *   Misc     : identify, request-positions, convoy-action
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  // Allow both polling (initial) and websocket upgrade — matches mobile transports: ["polling","websocket"]
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
  // Increase buffer for mobile reconnects
  connectTimeout: 45000,
});

app.use(cors());
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const tripCount = Object.keys(tripLocations).length;
  const voiceCount = Object.keys(voiceRooms).length;
  res.json({
    status: 'ok',
    riders: tripCount,
    voiceRooms: voiceCount,
    uptime: Math.floor(process.uptime()),
    connections: io.engine.clientsCount,
  });
});

// ─── HTTP polling fallback for live rider positions ────────────────────────────
app.get('/socket-api/trips/:tripId/riders', (req, res) => {
  const { tripId } = req.params;
  const riders = Object.entries(tripLocations[tripId] ?? {}).map(([userId, loc]) => ({
    userId,
    ...loc,
  }));
  res.json({ riders });
});

// ─── In-memory stores ─────────────────────────────────────────────────────────
// tripLocations[tripId][userId] = { lat, lng, ts }
const tripLocations = {};

// voiceRooms[tripId] = Map<socketId, userId(number)>
const voiceRooms = {};

// userId → socketId mapping (for voice signal routing by userId)
// userSocketMap[tripId][userId] = socketId
const userSocketMap = {};

// ─── Haversine distance (meters) ──────────────────────────────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // ── IDENTIFY (mobile sends role/userId after connect) ─────────────────────
  socket.on('identify', ({ userId, tripId, role }) => {
    if (!userId || !tripId) return;
    const uid = Number(userId);
    const tid = String(tripId);
    if (!Number.isFinite(uid)) return;

    socket.userId = uid;
    socket.tripId = tid;
    socket.role = role || 'member';

    // Register userId→socketId for voice signal routing
    if (!userSocketMap[tid]) userSocketMap[tid] = {};
    userSocketMap[tid][uid] = socket.id;

    console.log(`[socket] identified: userId=${uid} tripId=${tid} role=${role}`);
  });

  // ── JOIN TRIP ──────────────────────────────────────────────────────────────
  socket.on('join-trip', ({ tripId, userId }) => {
    if (!tripId || userId == null) return;

    const tid = String(tripId);
    const uid = Number(userId);

    socket.join(`trip_${tid}`);
    socket.tripId = tid;
    if (Number.isFinite(uid)) {
      socket.userId = uid;
      // Register userId→socketId
      if (!userSocketMap[tid]) userSocketMap[tid] = {};
      userSocketMap[tid][uid] = socket.id;
    }

    console.log(`[socket] user ${uid} joined trip ${tid}`);

    // Send current positions of all other riders immediately (reconnect sync)
    const currentRiders = Object.entries(tripLocations[tid] ?? {})
      .filter(([ruid]) => Number(ruid) !== uid)
      .map(([ruid, loc]) => ({ userId: ruid, ...loc }));

    if (currentRiders.length > 0) {
      socket.emit('trip-state-sync', { riders: currentRiders });
    }

    // Announce this rider to others in the room
    socket.to(`trip_${tid}`).emit('rider-joined', { userId: uid });

    // If this rider has a last known position, broadcast it to existing riders immediately
    // so they don't have to wait for the next location-update from this rider
    const lastPos = tripLocations[tid]?.[uid];
    if (lastPos) {
      socket.to(`trip_${tid}`).emit('location-updated', {
        u: String(uid),
        userId: uid,
        lat: lastPos.lat,
        lng: lastPos.lng,
      });
    }
  });

  // ── LEAVE TRIP ────────────────────────────────────────────────────────────
  socket.on('leave-trip', ({ tripId, userId }) => {
    if (!tripId || userId == null) return;
    const tid = String(tripId);
    const uid = Number(userId);
    socket.leave(`trip_${tid}`);
    cleanupRider(tid, uid, socket.id);
    socket.to(`trip_${tid}`).emit('rider-left', { userId: uid });
    console.log(`[socket] user ${uid} left trip ${tid}`);
  });

  // ── REQUEST POSITIONS (mobile asks for current state on reconnect) ─────────
  socket.on('request-positions', ({ tripId, userId }) => {
    if (!tripId) return;
    const tid = String(tripId);
    const uid = userId != null ? Number(userId) : null;

    const currentRiders = Object.entries(tripLocations[tid] ?? {})
      .filter(([ruid]) => uid == null || Number(ruid) !== uid)
      .map(([ruid, loc]) => ({ userId: ruid, ...loc }));

    if (currentRiders.length > 0) {
      socket.emit('trip-state-sync', { riders: currentRiders });
    }
  });

  // ── LOCATION UPDATE ────────────────────────────────────────────────────────
  socket.on('location-update', ({ tripId, userId, lat, lng }) => {
    if (!tripId || userId == null || lat == null || lng == null) return;
    if (!isFinite(lat) || !isFinite(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    const tid = String(tripId);
    const uid = Number(userId);
    if (!Number.isFinite(uid)) return;

    // SERVER-SIDE MOVEMENT FILTER — ignore GPS jitter < 15m
    // Skip filter for first position (prev is null) so new riders appear immediately
    const prev = tripLocations[tid]?.[uid];
    if (prev) {
      const dist = haversineMeters(prev.lat, prev.lng, lat, lng);
      if (dist < 15) return; // didn't actually move, skip broadcast
    }
    // First position: always broadcast so existing riders see the new rider immediately

    // Store in memory
    if (!tripLocations[tid]) tripLocations[tid] = {};
    tripLocations[tid][uid] = { lat, lng, ts: Date.now() };

    // Broadcast to trip room, exclude sender, use short key for bandwidth
    socket.to(`trip_${tid}`).emit('location-updated', {
      u: String(uid),   // short key — mobile reads payload.userId ?? payload.u
      userId: uid,      // also send full key for compatibility
      lat,
      lng,
    });
  });

  // ── CONVOY ACTION (SOS, regroup, line-up, etc.) ───────────────────────────
  socket.on('convoy-action', (payload) => {
    const tid = payload?.tripId ? String(payload.tripId) : socket.tripId;
    if (!tid) return;
    // Broadcast to everyone in the trip room including sender
    io.to(`trip_${tid}`).emit('convoy-action', payload);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // VOICE — Mobile app protocol:
  //   emit:    voice-join, voice-leave, voice-signal
  //   listen:  voice-peers, voice-rider-joined, voice-rider-left, voice-signal
  //
  // voice-signal payload: { tripId, toUserId, fromUserId, signal: { type, ... } }
  //   type = "voice-offer"  → sdp
  //   type = "voice-answer" → sdp
  //   type = "voice-ice"    → candidate
  //   type = "voice-muted"  → userId, muted  (broadcast toUserId=-1)
  //   type = "voice-force-mute" → userId, muted
  // ─────────────────────────────────────────────────────────────────────────

  // ── VOICE JOIN ────────────────────────────────────────────────────────────
  socket.on('voice-join', ({ tripId, userId }) => {
    if (!tripId || userId == null) return;
    const tid = String(tripId);
    const uid = Number(userId);
    if (!Number.isFinite(uid)) return;

    socket.join(`voice_${tid}`);
    socket.voiceTripId = tid;
    socket.voiceUserId = uid;

    if (!voiceRooms[tid]) voiceRooms[tid] = new Map();
    voiceRooms[tid].set(socket.id, uid);

    // Register userId→socketId for signal routing
    if (!userSocketMap[tid]) userSocketMap[tid] = {};
    userSocketMap[tid][uid] = socket.id;

    // Tell this user who is already in the voice room (as userId array — mobile protocol)
    const existingPeerUserIds = [];
    voiceRooms[tid].forEach((existingUserId, existingSocketId) => {
      if (existingSocketId !== socket.id && Number.isFinite(existingUserId)) {
        existingPeerUserIds.push(existingUserId);
      }
    });
    socket.emit('voice-peers', { peers: existingPeerUserIds });

    // Tell everyone else a new peer joined
    socket.to(`voice_${tid}`).emit('voice-rider-joined', { userId: uid });

    console.log(
      `[voice] user ${uid} joined voice room ${tid} (${voiceRooms[tid].size} peers)`,
    );
  });

  // ── VOICE LEAVE ───────────────────────────────────────────────────────────
  socket.on('voice-leave', ({ tripId, userId }) => {
    if (!tripId) return;
    const tid = String(tripId);
    const uid = userId != null ? Number(userId) : socket.voiceUserId;
    socket.leave(`voice_${tid}`);
    cleanupVoice(tid, socket.id);
    socket.to(`voice_${tid}`).emit('voice-rider-left', { userId: uid });
    console.log(`[voice] user ${uid} left voice room ${tid}`);
  });

  // ── VOICE SIGNAL RELAY ────────────────────────────────────────────────────
  // Routes by toUserId (numeric) using userSocketMap
  socket.on('voice-signal', ({ tripId, toUserId, fromUserId, signal }) => {
    if (!signal || typeof signal !== 'object') return;

    const tid = tripId ? String(tripId) : socket.voiceTripId ?? socket.tripId;
    if (!tid) return;

    const fromUid = Number(fromUserId ?? socket.voiceUserId ?? socket.userId);

    // Broadcast (mute status) — toUserId === -1 means send to all in voice room
    if (toUserId === -1 || toUserId == null) {
      socket.to(`voice_${tid}`).emit('voice-signal', {
        tripId: tid,
        toUserId,
        fromUserId: fromUid,
        signal,
      });
      return;
    }

    const toUid = Number(toUserId);
    if (!Number.isFinite(toUid)) return;

    // Route to specific peer by userId
    const targetSocketId = userSocketMap[tid]?.[toUid];
    if (targetSocketId) {
      io.to(targetSocketId).emit('voice-signal', {
        tripId: tid,
        toUserId: toUid,
        fromUserId: fromUid,
        signal,
      });
    } else {
      // Fallback: broadcast to voice room (peer may have reconnected with new socketId)
      socket.to(`voice_${tid}`).emit('voice-signal', {
        tripId: tid,
        toUserId: toUid,
        fromUserId: fromUid,
        signal,
      });
      console.warn(
        `[voice] no socketId for userId=${toUid} in trip=${tid}, broadcasting to room`,
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WAITING ROOM VOICE EVENTS (forwarded to trip room)
  // These are used by useWaitingRoomVoice via Supabase Realtime, but some
  // clients may also use socket for these — relay them just in case.
  // ─────────────────────────────────────────────────────────────────────────
  socket.on('voice:waiting-join', ({ tripId, userId }) => {
    if (!tripId) return;
    socket.to(`trip_${tripId}`).emit('voice:waiting-join', { userId });
  });

  socket.on('voice:waiting-leave', ({ tripId, userId }) => {
    if (!tripId) return;
    socket.to(`trip_${tripId}`).emit('voice:waiting-leave', { userId });
  });

  socket.on('voice:raise-hand', ({ tripId, userId }) => {
    if (!tripId) return;
    socket.to(`trip_${tripId}`).emit('voice:raise-hand', { userId });
  });

  socket.on('voice:lower-hand', ({ tripId, userId }) => {
    if (!tripId) return;
    socket.to(`trip_${tripId}`).emit('voice:lower-hand', { userId });
  });

  socket.on('voice:speak-approved', ({ tripId, userId, approvedBy }) => {
    if (!tripId) return;
    socket.to(`trip_${tripId}`).emit('voice:speak-approved', { userId, approvedBy });
  });

  // ── DISCONNECT CLEANUP ────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);

    if (socket.tripId != null && socket.userId != null) {
      cleanupRider(socket.tripId, socket.userId, socket.id);
      socket.to(`trip_${socket.tripId}`).emit('rider-left', {
        userId: socket.userId,
      });
      // Clean up userId→socketId mapping
      if (userSocketMap[socket.tripId]?.[socket.userId] === socket.id) {
        delete userSocketMap[socket.tripId][socket.userId];
      }
    }

    if (socket.voiceTripId != null) {
      cleanupVoice(socket.voiceTripId, socket.id);
      socket.to(`voice_${socket.voiceTripId}`).emit('voice-rider-left', {
        userId: socket.voiceUserId,
      });
    }
  });
});

// ─── Cleanup helpers ──────────────────────────────────────────────────────────
function cleanupRider(tripId, userId, _socketId) {
  const tid = String(tripId);
  const uid = Number(userId);
  if (tripLocations[tid] && Number.isFinite(uid)) {
    delete tripLocations[tid][uid];
    if (Object.keys(tripLocations[tid]).length === 0) {
      delete tripLocations[tid];
    }
  }
}

function cleanupVoice(tripId, socketId) {
  if (voiceRooms[tripId]) {
    voiceRooms[tripId].delete(socketId);
    if (voiceRooms[tripId].size === 0) {
      delete voiceRooms[tripId];
    }
  }
}

// ─── Memory cleanup (prevent leaks on long runs) ──────────────────────────────
setInterval(() => {
  const now = Date.now();
  const STALE_MS = 30 * 60 * 1000; // 30 minutes

  Object.keys(tripLocations).forEach((tripId) => {
    Object.keys(tripLocations[tripId]).forEach((userId) => {
      if (now - tripLocations[tripId][userId].ts > STALE_MS) {
        delete tripLocations[tripId][userId];
      }
    });
    if (Object.keys(tripLocations[tripId]).length === 0) {
      delete tripLocations[tripId];
    }
  });

  // Clean up stale userSocketMap entries
  Object.keys(userSocketMap).forEach((tripId) => {
    if (Object.keys(userSocketMap[tripId]).length === 0) {
      delete userSocketMap[tripId];
    }
  });
}, 5 * 60 * 1000); // run every 5 minutes

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`[server] Trip-Sync Socket.IO running on port ${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/health`);
});
