# Rider Comms

Pre-alpha Expo/React Native app for proximity-based rider communication and private group rides. The monorepo contains the native client, a dependency-light Node.js prototype API, shared TypeScript logic, and a static design preview under `docs/`.

## Current status

Working and verified in this repository:

- Secure per-device guest sessions and readable Rider IDs.
- Actor-authorised profiles, rides, friendships, messages, hideouts, presence, blocks, reports, and account deletion.
- Instagram and TikTok profile usernames with Public, Friends only, or Private visibility.
- Private ride creation, joining, roster polling, host removal, leaving, and ending.
- Opt-in foreground GPS presence with server-controlled mutual radius.
- In-app plan preview, privacy/safety information, and direct-message block/report controls.
- Shared geo, ride-code, rate-limit, zone-transition, and audio-priority algorithms.
- Android and iOS Metro exports plus an EAS internal Android APK profile.

Still prototype-only:

- All API data is in memory and disappears on server restart.
- Nearby rider placement and the map background are illustrative; no production map/navigation SDK is connected.
- Live voice rooms, VOX, noise suppression, Bluetooth routing, and background audio are not connected.
- Store billing products and receipt validation are not connected; the plan UI cannot unlock a tier.
- The proposed video feed and scenic-routes tab are documented follow-ups, not shipped features.

Do not expose the API publicly or use real private data until durable authentication, storage, moderation, and production operations replace the prototype stores. See [COMPLIANCE.md](COMPLIANCE.md) for store-readiness requirements.

## Setup and verification

Node.js 22 or newer is required.

```bash
npm install
npm run check
npx expo-doctor mobile
```

Run the API:

```bash
npm run dev:backend
```

Run the mobile app on the same network:

```bash
npm run start --workspace=mobile
```

The development API host is normally derived from Expo. Override it for a deployed HTTPS API:

```bash
EXPO_PUBLIC_API_URL=https://api.example.com npm run start --workspace=mobile
```

With an authenticated Expo account, build an installable Android preview:

```bash
cd mobile
npx eas-cli build --profile preview --platform android
```

See [docs/spec.md](docs/spec.md) for the product specification and [AUDIT.md](AUDIT.md) for the engineering assessment.
