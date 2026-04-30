#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Trip-Sync Socket Server — Deploy / Update Script
# Run this ON your DigitalOcean server as root:
#   bash deploy-socket-server.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

SERVER_DIR="/var/www/tripsync-socket"
echo "==> Deploying to $SERVER_DIR"

# 1. Create directory if missing
mkdir -p "$SERVER_DIR"
cd "$SERVER_DIR"

# 2. Write package.json (ESM module)
cat > package.json << 'PKGJSON'
{
  "name": "tripsync-socket",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "socket.io": "^4.8.3",
    "express": "^4.21.2",
    "cors": "^2.8.5"
  }
}
PKGJSON

# 3. Write server.js (the fixed version)
cat > server.js << 'SERVERJS'
/**
 * Trip-Sync Socket.IO Server — DigitalOcean standalone
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
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
});

app.use(cors());
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    riders: Object.keys(tripLocations).length,
    voiceRooms: Object.keys(voiceRooms).length,
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
const tripLocations = {};
const voiceRooms = {};
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

  socket.on('identify', ({ userId, tripId, role }) => {
    if (!userId || !tripId) return;
    const uid = Number(userId);
    const tid = String(tripId);
    if (!Number.isFinite(uid)) return;
    socket.userId = uid;
    socket.tripId = tid;
    socket.role = role || 'member';
    if (!userSocketMap[tid]) userSocketMap[tid] = {};
    userSocketMap[tid][uid] = socket.id;
    console.log(`[socket] identified: userId=${uid} tripId=${tid} role=${role}`);
  });

  socket.on('join-trip', ({ tripId, userId }) => {
    if (!tripId || userId == null) return;
    const tid = String(tripId);
    const uid = Number(userId);
    socket.join(`trip_${tid}`);
    socket.tripId = tid;
    if (Number.isFinite(uid)) {
      socket.userId = uid;
      if (!userSocketMap[tid]) userSocketMap[tid] = {};
      userSocketMap[tid][uid] = socket.id;
    }
    console.log(`[socket] user ${uid} joined trip ${tid}`);
    const currentRiders = Object.entries(tripLocations[tid] ?? {})
      .filter(([ruid]) => Number(ruid) !== uid)
      .map(([ruid, loc]) => ({ userId: ruid, ...loc }));
    if (currentRiders.length > 0) {
      socket.emit('trip-state-sync', { riders: currentRiders });
    }
    socket.to(`trip_${tid}`).emit('rider-joined', { userId: uid });
  });

  socket.on('leave-trip', ({ tripId, userId }) => {
    if (!tripId || userId == null) return;
    const tid = String(tripId);
    const uid = Number(userId);
    socket.leave(`trip_${tid}`);
    cleanupRider(tid, uid, socket.id);
    socket.to(`trip_${tid}`).emit('rider-left', { userId: uid });
    console.log(`[socket] user ${uid} left trip ${tid}`);
  });

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

  socket.on('location-update', ({ tripId, userId, lat, lng }) => {
    if (!tripId || userId == null || lat == null || lng == null) return;
    if (!isFinite(lat) || !isFinite(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    const tid = String(tripId);
    const uid = Number(userId);
    if (!Number.isFinite(uid)) return;
    const prev = tripLocations[tid]?.[uid];
    if (prev) {
      const dist = haversineMeters(prev.lat, prev.lng, lat, lng);
      if (dist < 15) return;
    }
    if (!tripLocations[tid]) tripLocations[tid] = {};
    tripLocations[tid][uid] = { lat, lng, ts: Date.now() };
    socket.to(`trip_${tid}`).emit('location-updated', {
      u: String(uid),
      userId: uid,
      lat,
      lng,
    });
  });

  socket.on('convoy-action', (payload) => {
    const tid = payload?.tripId ? String(payload.tripId) : socket.tripId;
    if (!tid) return;
    io.to(`trip_${tid}`).emit('convoy-action', payload);
  });

  // ── VOICE (mobile protocol: voice-join/leave/signal → voice-peers/rider-joined/rider-left/signal) ──

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
    if (!userSocketMap[tid]) userSocketMap[tid] = {};
    userSocketMap[tid][uid] = socket.id;
    const existingPeerUserIds = [];
    voiceRooms[tid].forEach((existingUserId, existingSocketId) => {
      if (existingSocketId !== socket.id && Number.isFinite(existingUserId)) {
        existingPeerUserIds.push(existingUserId);
      }
    });
    socket.emit('voice-peers', { peers: existingPeerUserIds });
    socket.to(`voice_${tid}`).emit('voice-rider-joined', { userId: uid });
    console.log(`[voice] user ${uid} joined voice room ${tid} (${voiceRooms[tid].size} peers)`);
  });

  socket.on('voice-leave', ({ tripId, userId }) => {
    if (!tripId) return;
    const tid = String(tripId);
    const uid = userId != null ? Number(userId) : socket.voiceUserId;
    socket.leave(`voice_${tid}`);
    cleanupVoice(tid, socket.id);
    socket.to(`voice_${tid}`).emit('voice-rider-left', { userId: uid });
    console.log(`[voice] user ${uid} left voice room ${tid}`);
  });

  socket.on('voice-signal', ({ tripId, toUserId, fromUserId, signal }) => {
    if (!signal || typeof signal !== 'object') return;
    const tid = tripId ? String(tripId) : socket.voiceTripId ?? socket.tripId;
    if (!tid) return;
    const fromUid = Number(fromUserId ?? socket.voiceUserId ?? socket.userId);
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
    const targetSocketId = userSocketMap[tid]?.[toUid];
    if (targetSocketId) {
      io.to(targetSocketId).emit('voice-signal', {
        tripId: tid,
        toUserId: toUid,
        fromUserId: fromUid,
        signal,
      });
    } else {
      socket.to(`voice_${tid}`).emit('voice-signal', {
        tripId: tid,
        toUserId: toUid,
        fromUserId: fromUid,
        signal,
      });
      console.warn(`[voice] no socketId for userId=${toUid} in trip=${tid}, broadcasting to room`);
    }
  });

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

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
    if (socket.tripId != null && socket.userId != null) {
      cleanupRider(socket.tripId, socket.userId, socket.id);
      socket.to(`trip_${socket.tripId}`).emit('rider-left', { userId: socket.userId });
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

function cleanupRider(tripId, userId, _socketId) {
  const tid = String(tripId);
  const uid = Number(userId);
  if (tripLocations[tid] && Number.isFinite(uid)) {
    delete tripLocations[tid][uid];
    if (Object.keys(tripLocations[tid]).length === 0) delete tripLocations[tid];
  }
}

function cleanupVoice(tripId, socketId) {
  if (voiceRooms[tripId]) {
    voiceRooms[tripId].delete(socketId);
    if (voiceRooms[tripId].size === 0) delete voiceRooms[tripId];
  }
}

setInterval(() => {
  const now = Date.now();
  const STALE_MS = 30 * 60 * 1000;
  Object.keys(tripLocations).forEach((tripId) => {
    Object.keys(tripLocations[tripId]).forEach((userId) => {
      if (now - tripLocations[tripId][userId].ts > STALE_MS) delete tripLocations[tripId][userId];
    });
    if (Object.keys(tripLocations[tripId]).length === 0) delete tripLocations[tripId];
  });
  Object.keys(userSocketMap).forEach((tripId) => {
    if (Object.keys(userSocketMap[tripId]).length === 0) delete userSocketMap[tripId];
  });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`[server] Trip-Sync Socket.IO running on port ${PORT}`);
  console.log(`[server] Health: http://localhost:${PORT}/health`);
});
SERVERJS

# 4. Install dependencies
echo "==> Installing npm packages..."
npm install

# 5. Restart PM2
echo "==> Restarting PM2..."
pm2 delete tripsync-socket 2>/dev/null || true
pm2 start server.js --name tripsync-socket
pm2 save

# 6. Verify
echo ""
echo "==> Waiting 3 seconds for server to start..."
sleep 3
echo "==> Health check:"
curl -s http://localhost:4000/health
echo ""
echo ""
echo "==> PM2 status:"
pm2 status

echo ""
echo "✅ Deploy complete! Server is running on port 4000."
echo "   Test from your PC: curl http://165.232.179.143/health"
