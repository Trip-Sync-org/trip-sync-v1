<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Trip-Sync v1

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8fcce85f-9875-4d84-861c-93d1c61a50ad

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and set Supabase, map provider keys, and optional `GEMINI_API_KEY` as needed.
3. Run the app: `npm run dev`

The dev server listens on port **3000** (Express + Vite). Open `http://localhost:3000`.

## Deployment Strategy (Recommended)

- Deploy **web frontend** (`Vite`) on **Vercel**.
- Deploy **backend API** (`Express + Socket.IO`) on an always-on backend host (Render/Railway/Fly/VM).
- Keep a **single backend** for both web and mobile clients (good approach).

Project is now organized with top-level folders for clarity:

- `frontend/` -> web deployment entrypoint (Vercel root can be this folder)
- `backend/` -> backend runtime entrypoint (separate host root can be this folder)
- `mobile/` -> Expo app (APK later)
- Web source now lives in `frontend/src/` (root only keeps compatibility wrappers)

Why: Vercel serverless is great for frontend and stateless endpoints, but long-lived realtime sockets are not ideal there. Keeping backend separate avoids socket/realtime instability.

### Keep backend from sleeping

If your backend host idles/freezes on inactivity:

1. Set these in web `.env`:
   - `VITE_BACKEND_URL=https://your-backend-host`
   - `VITE_ENABLE_KEEPALIVE=true`
2. Web app sends periodic lightweight `GET /api/health` pings while a tab is open.

For stricter uptime, also configure an external uptime monitor/cron to hit `/api/health` every 5-10 minutes.

## Updated commands

- Start backend + web dev: `npm run dev`
- Build frontend: `npm run build`
- Preview frontend build: `npm run preview`
- Frontend-only dev: `npm run frontend:dev`
- Backend-only dev: `npm run backend:dev`

### Separate deployment roots

- Frontend project (Vercel):
  - Root Directory: `frontend`
  - Uses `frontend/package.json`, `frontend/vite.config.js`, `frontend/index.html`, `frontend/vercel.json`
  - Build Command: `npm run build`
  - Output Directory: `dist`
- Backend project (separate):
  - Root Directory: `backend`
  - Uses `backend/package.json`, `backend/vercel.json`, and serverless handlers under `backend/api/` (voice + signal ICE)
  - Build Command: `npm run build` (or default Vercel build if you add one)
  - Output Directory: _(leave empty)_
  - Set backend env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) in backend host
  - Voice REST routes: `/api/voice/*`, `/api/signal/ice` — see `backend/README.md`
  - Local Express API (live trip map, etc.): still available via `npm run dev` from repo root (`backend/server.ts`)

## React Native (Expo SDK 54)

The **`mobile/`** folder is an Expo **SDK 54** app (see `mobile/package.json`) that talks to the same API.

**Do not run `npx expo start` in the repo root** — there is no `expo` package there, so you get *“Cannot determine the project's Expo SDK version”*. From the root, use **`npm run expo`** or **`npm run expo:clear`** (starts Metro with cache cleared). Or first run **`cd mobile`**, then `npx expo start` or `npx expo start --clear`.

With the API running (`npm run dev`), install and start the app:

```bash
cd mobile && npm install && npm start
```

Or from the repo root: `npm run expo` (QR for Expo Go) — same as `npm run mobile`. Copy `mobile/.env.example` to `mobile/.env` and set `EXPO_PUBLIC_API_URL` (see `mobile/README.md` for simulator vs device URLs) and Supabase keys matching the web app.

# Trip-Sync-v1

