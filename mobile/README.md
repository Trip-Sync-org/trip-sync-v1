# Trip-Sync (Expo / React Native)

**Expo SDK 54 only** (`mobile/package.json` → `expo ~54.0.27`). The web app in the repo root is **not** an Expo project.

### Important: never run bare `npx expo` from the repo root

If you run `npx expo start` or `npx expo install` in the **root** folder (`Trip-Sync/`), npm may install **Expo 55 canary** there, patch `tsconfig.json` with `expo/tsconfig.base`, and Metro will target the wrong project. That breaks Expo Go (SDK mismatch) and can crash the file watcher.

**Safe options:**

- From repo root: `npm run expo` or `npm run expo:clear` (Metro **with cache cleared** — same as `npx expo start --clear` but only inside `mobile/`).
- Or: `cd mobile` then `npx expo start -c`.

Run the API with `npm run dev` at the root; run the mobile app only from `mobile/` as above.

This app uses the **same Express API** as the web app in the repository root. Start the API before using the mobile client.

## Prerequisites

- Node.js
- [Expo Go](https://expo.dev/go) on a phone, or Xcode (iOS) / Android Studio (Android) for simulators

## Setup

```bash
cd mobile
npm install
cp .env.example .env
```

**`mobile/.env` mirrors the repo root `.env`:** same values, but Expo needs the `EXPO_PUBLIC_` prefix (see the mapping table at the top of `mobile/.env.example`). Copy `VITE_SUPABASE_*` from the root file into the matching `EXPO_PUBLIC_*` lines. Server-only keys (`SUPABASE_SERVICE_ROLE_KEY`, `MAPBOX_SECRET_TOKEN`, etc.) stay in the root `.env` only — never put them in `mobile/.env`.

Set `EXPO_PUBLIC_API_URL` for your environment (see below). **Restart Expo** after changing `.env`.

## Run the API

From the **repository root** (not `mobile/`):

```bash
npm install
npm run dev
```

The server listens on port **3000** by default.

## Run the mobile app (QR code + Expo Go)

**From the repo root** (starts Metro and shows a QR in the terminal / browser):

```bash
npm run expo
```

**From the `mobile/` folder** (do not use a script named `expo` here — it conflicts with the CLI):

```bash
npm start
```

(`npm run expo:start` is the same.)

That runs `expo start`, which prints a **QR code**. Open **Expo Go** on your phone and scan it (same Wi‑Fi as your computer).

If the phone cannot reach your PC (corporate network, etc.), use Expo’s tunnel:

```bash
npm run expo:tunnel
```

(Run from root or from `mobile/` — same pattern.)

Then press `i` / `a` in the terminal for iOS / Android simulators instead of the QR if you prefer.

### Expo Go: “Project is incompatible” / “Incompatible SDK version”

[Expo Go](https://expo.dev/go) tracks **one** SDK at a time (usually the latest stable). This app is pinned to **Expo SDK 54** to match current Expo Go. Do not use `expo@canary` with Expo Go.

- If the error says your project is **older** than Expo Go: pull latest, then `cd mobile && npm install`, and restart Metro from **`mobile/`**: `npx expo start -c` (do not run `npx expo` from the repo root).
- If the error says your project is **newer** than Expo Go: update Expo Go from the Play Store / App Store.
- Canary / bleeding-edge SDKs require a [development build](https://docs.expo.dev/develop/development-builds/introduction/), not Expo Go.

## API URL by environment

| Environment | Typical `EXPO_PUBLIC_API_URL` |
|-------------|-------------------------------|
| iOS Simulator | `http://localhost:3000` |
| Android Emulator | `http://10.0.2.2:3000` |
| Physical device (same Wi‑Fi as PC) | `http://<your-PC-LAN-IP>:3000` |

Ensure the machine running the API allows inbound connections on port 3000 if you use a physical device.

## What is implemented

- Auth (email login/signup against `/api/auth/*`), explore trips, trip detail, bookings, organizer coupons and a minimal create-trip flow. Live map / real-time trip features are placeholders until native maps and sockets are wired.

## Typecheck

```bash
cd mobile
npx tsc --noEmit
```
