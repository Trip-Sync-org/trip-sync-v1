# Voice channel backend (Trip Sync)

Serverless API on **Vercel** using **Supabase** (Postgres + Realtime) and **WebRTC** signaling conventions. Stack uses only free, open-source building blocks: Supabase free tier, browser/RN WebRTC, public STUN servers, Vercel serverless.

## How the full voice flow works

**USER JOINS VOICE CHANNEL**

- Client → calls `GET /api/signal/ice` to get STUN config
- Client → creates `RTCPeerConnection` with those ICE servers
- Client → subscribes to Supabase Realtime channel `signal-trip-{tripId}`
- Client → broadcasts `PEER_JOINED` event with their `userId`

**WEBRTC PEER NEGOTIATION** (client-to-client via Supabase Realtime, no backend needed)

- Peer A creates offer → broadcasts via signal channel → Peer B receives
- Peer B creates answer → broadcasts back → Peer A receives
- Both exchange ICE candidates via signal channel
- `RTCPeerConnection` established → direct P2P audio

**ADMIN ACTIONS** (go through backend API)

- Organizer mutes user → `POST /api/voice/mute`
- Backend updates DB + broadcasts `PARTICIPANT_MUTED` via Supabase Realtime
- Target client receives broadcast → disables their audio track locally

**ROLE ASSIGNMENT** (persists for entire trip)

- Organizer → `POST /api/voice/role` `{ targetUserId, newRole }`
- Backend → updates `trip_members` in Supabase
- Backend → broadcasts `ROLE_UPDATED` via Supabase Realtime
- All clients update their local role state

**TALK MODE SWITCH**

- Organizer → `POST /api/voice/mode` `{ mode: 'staff' }`
- Backend → updates `trip_voice_state`
- Backend → broadcasts `MODE_CHANGED` via Supabase Realtime
- Member clients that receive this → close their `RTCPeerConnection` and leave
- Staff clients → stay connected (or reform connections among themselves)

## Local development

```bash
cd backend
npm install
npm run dev
```

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`). Run `supabase/schema.sql` once in the Supabase SQL editor.

## Deploy

```bash
cd backend
npm run deploy
```

Point the Vercel project at the `backend/` directory (or merge these routes into your root Vercel config) so `/api/voice/*` and `/api/signal/*` resolve to the serverless handlers in `api/`.
