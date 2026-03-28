<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Trip-Sync v1

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8fcce85f-9875-4d84-861c-93d1c61a50ad

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and set Supabase, Mapbox, and optional `GEMINI_API_KEY` as needed.
3. Run the app: `npm run dev`

The dev server listens on port **3000** (Express + Vite). Open `http://localhost:3000`.

## React Native (Expo SDK 54)

The **`mobile/`** folder is an Expo **SDK 54** app (see `mobile/package.json`) that talks to the same API.

**Do not run `npx expo start` in the repo root** — there is no `expo` package there, so you get *“Cannot determine the project's Expo SDK version”*. From the root, use **`npm run expo`** or **`npm run expo:clear`** (starts Metro with cache cleared). Or first run **`cd mobile`**, then `npx expo start` or `npx expo start --clear`.

With the API running (`npm run dev`), install and start the app:

```bash
cd mobile && npm install && npm start
```

Or from the repo root: `npm run expo` (QR for Expo Go) — same as `npm run mobile`. Copy `mobile/.env.example` to `mobile/.env` and set `EXPO_PUBLIC_API_URL` (see `mobile/README.md` for simulator vs device URLs) and Supabase keys matching the web app.

