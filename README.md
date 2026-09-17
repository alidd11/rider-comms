# Rider Comms

Pre-alpha Expo/React Native and installable PWA for proximity-based rider communication and private group rides. The monorepo contains both clients, a dependency-light Node.js API, PostgreSQL persistence, and shared TypeScript logic.

## Current status

Working and verified in this repository:

- Postgres-backed username/password accounts with expiring, revocable bearer sessions; native tokens use SecureStore.
- Actor-authorised profiles, rides, friendships, messages, hideouts, presence, blocks, reports, and account deletion.
- Instagram and TikTok profile usernames with Public, Friends only, or Private visibility.
- Private ride creation, joining, roster polling, host removal, leaving, and ending.
- Opt-in foreground GPS presence with server-controlled mutual radius, fresh/accurate fix validation, indexed geographic candidate queries and durable cross-replica transition state.
- In-app plan preview, privacy/safety information, and direct-message block/report controls.
- Shared geo, ride-code, rate-limit, zone-transition, and audio-priority algorithms.
- Shared 8 mph Ride Safe behavior in native and PWA: sustained movement at/above the threshold locks distracting controls; unknown/stale GPS shows a warning without making product areas disappear, and confirmed below-threshold movement unlocks after the shared hysteresis delay.
- Active-ride voice surfaces report token, LiveKit and native audio-routing failures explicitly. While movement-locked, voice remains hands-free and the ride bar exposes only the essential leave action. Unsupported media-session controls are feature-detected and disabled instead of throwing.
- Android and iOS Metro exports plus an EAS internal Android APK profile.

Still prototype-only:

- Account credentials, expiring sessions, profiles, rides, friendships, messages, hideouts, presence, hazards, moderation records and scenic-route submissions are durable in Postgres. Anonymous guest sessions are process-local and disappear on restart by design; they are not recoverable accounts.
- The native client uses a real Apple Maps/Google Maps surface for the rider's own location, selected places, shared destinations and hazard coordinates. Nearby riders are deliberately shown as a privacy-preserving count because the public presence API does not expose their exact coordinates. A production Android build still needs a restricted Maps SDK key.
- LiveKit ride/public proximity voice, VOX gating, and native audio-session/Bluetooth routing are wired for testing. Physical helmet/noise tuning, production-grade noise suppression, and real nav/chat/music gain application still require device validation and native mixer work.
- Store billing products and receipt validation are not connected; the plan UI cannot unlock a tier.
- The proposed stationary-only video feed remains a documented follow-up. Scenic-route discovery is available, but still needs broader route coverage and live road-condition data.

Do not treat the API as production-ready or use real private data until account recovery, documented retention, moderation operations, backups, monitoring and recovery controls are completed. See [COMPLIANCE.md](COMPLIANCE.md) for store-readiness requirements.

## Setup and verification

Node.js 22 or newer is required.

```bash
npm install
npm run check
npm run test:pwa:visual
npx expo-doctor mobile
```

The PWA visual smoke audit captures Map, Group Ride, Routes, Friends,
Settings and Search, plus Ride Safe warning behavior, at small-phone,
modern-phone, WebKit iPhone, tablet and landscape viewports. It fails on application runtime
errors or horizontal viewport overflow. CI publishes the resulting screenshots
and HTML report in the `pwa-visual-audit` artifact.

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

For a deployed API, configure the exact browser origins that may call it:

```bash
CORS_ALLOWED_ORIGINS=https://alidd11.github.io
TRUST_PROXY=true
HOST=0.0.0.0
PORT=4000
```

Private Railway PostgreSQL URLs can omit `sslmode`. External PostgreSQL URLs
must use `sslmode=require`, `verify-ca`, or `verify-full`; certificates are
always verified. If the provider uses a private CA, set `DATABASE_CA_CERT` to
its PEM chain (literal newlines or escaped `\n` are accepted).

`CORS_ALLOWED_ORIGINS` is a comma-separated allowlist. Production origins must
use HTTPS and must not include a path. Set `TRUST_PROXY=true` only when the API
is behind a trusted reverse proxy that replaces `X-Forwarded-For`; otherwise
leave it false. The API exposes `/health` and `/ready`, emits structured JSON
request logs, carries a safe `X-Request-ID`, and shuts down gracefully on
`SIGTERM`/`SIGINT`. `/health` is process liveness only; `/ready` verifies the
PostgreSQL connection and migration state. Production startup applies all
pending migrations before opening the HTTP listening socket, and graceful
shutdown drains both HTTP traffic and the PostgreSQL pool.

### PWA deployment and Google Maps

Pushing `main` runs `.github/workflows/pages.yml`, verifies the repository,
builds the static PWA, and deploys it to GitHub Pages. The service worker checks
the network first and announces waiting updates inside the installed app, so
testers do not need to clear browser storage between releases.

To enable Google Maps in the PWA, add a GitHub Actions repository secret named
`GOOGLE_MAPS_API_KEY`. Restrict that browser key in Google Cloud to the Maps
JavaScript API and the exact GitHub Pages HTTPS origin. The workflow injects it
into the deployed artifact; it is never committed to source. Without a valid
key, the PWA uses its accessible simplified rider map instead of failing blank.

The native Expo client uses `react-native-maps`, which can be tested in Expo Go
without additional native setup. iOS uses Apple Maps by default. A standalone
Android release still requires the Maps SDK for Android to be enabled and a
restricted key tied to `com.ridercomms.app` plus the signing certificate SHA-1;
configure that key through the `react-native-maps` Expo plugin for the release
build. The Google Places search key remains a separate build-time setting.

### Native app links and maps handoff

The native client accepts validated navigation links in these forms:

```text
https://alidd11.github.io/rider-comms/navigate?lat=51.5074&lon=-0.1278&label=Tower%20Bridge
ridercomms://navigate?lat=51.5074&lon=-0.1278&label=Tower%20Bridge
```

Cold-start and running-app links are filtered through the same coordinate
parser before React Navigation opens the Map tab. Hideout locations can be
handed to the device's maps/navigation apps with an Apple Maps HTTPS URL on
iOS or a standard `geo:` URI on Android. This is OS-level linking only; it does
not provide or imply an Uber Eats, Deliveroo, or other partner integration.

Production App Link and Universal Link verification is still required. The
corresponding `assetlinks.json` and `apple-app-site-association` files must be
served from `https://alidd11.github.io/.well-known/` (or, preferably, a
controlled production domain) with the final Android signing certificate and
Apple Team ID. A project-level GitHub Pages path cannot by itself publish those
domain-root association files, so the configured `autoVerify` and associated
domain are declarations rather than verified production links until that
hosting work is completed.

With an authenticated Expo account, build an installable Android preview:

```bash
cd mobile
npx eas-cli build --profile preview --platform android
```

See [docs/spec.md](docs/spec.md) for the product specification, [CLIENT_PARITY.md](CLIENT_PARITY.md) for the PWA/native parity contract, and [AUDIT.md](AUDIT.md) for the engineering assessment.
