/**
 * Trip-Sync Socket.IO Server — DigitalOcean standalone
 *
 * Deploy to: /var/www/tripsync-socket/server.js
 *
 * Supports the mobile app's event protocol:
 *   Location : join-trip, leave-trip, location-update  →  location-updated, trip-state-sync, rider-left, rider-joined
 *   Voice    : LiveKit SFU — token issued via POST /get-voice-token
 *   Misc     : identify, request-positions, convoy-action
 *   Waiting  : voice:waiting-join, voice:waiting-leave, voice:raise-hand, voice:lower-hand, voice:speak-approved
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY    = '3d4b9e638d613281';
const LIVEKIT_API_SECRET = 'ce0d64f01c7c191dd535533962df9e0e837fa6750b24fa697912083a4879a077';

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
  res.json({
    status: 'ok',
    riders: tripCount,
    uptime: Math.floor(process.uptime()),
    connections: io.engine.clientsCount,
  });
});

// ─── LiveKit voice token endpoint ─────────────────────────────────────────────
// POST /get-voice-token  { roomName, participantName }
app.post('/get-voice-token', async (req, res) => {
  try {
    const { roomName, participantName } = req.body;
    if (!roomName || !participantName) {
      return res.status(400).json({ error: 'roomName and participantName are required' });
    }
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: String(participantName),
      ttl: '6h',
    });
    at.addGrant({
      roomJoin: true,
      room: String(roomName),
      canPublish: true,
      canSubscribe: true,
    });
    const token = await at.toJwt();
    res.json({ token });
  } catch (err) {
    console.error('[voice-token] error:', err);
    res.status(500).json({ error: 'Failed to generate token' });
  }
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

// userId → socketId mapping (used for trip/location routing)
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

    // Register userId→socketId for routing
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
  // WAITING ROOM VOICE EVENTS (forwarded to trip room)
  // These are used by useWaitingRoomVoice — relay them for real-time sync.
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
