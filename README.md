# Rider Comms

Hands-free, proximity-based group voice + real navigation for moped/motorcycle riders. Full product spec: [`docs/spec.md`](docs/spec.md).

This repo is a first working slice of the system, built in an environment with **no npm registry access** (network egress was blocked to `registry.npmjs.org`) and **no Mac/Android Studio/physical device**. That shaped what could actually be built and verified here — see "What's real vs. stubbed" below before assuming anything works beyond what's described.

## Layout

```
shared/    Pure TypeScript logic shared by backend + mobile — zone matching,
           geo-bucketing, ride codes, rate limiting, the audio priority
           mixer. Zero runtime dependencies. Fully tested.
backend/   Node.js HTTP service implementing ride creation/joining and the
           public-zone presence/matching endpoints. Zero dependencies
           beyond @rider-comms/shared and Node's standard library.
           Fully tested, and runs as a real process (see below).
mobile/    React Native (Expo) app scaffold — screens, navigation, an
           API client, and the audio-engine/media-control interfaces.
           NOT installed or run anywhere — see limitations below.
docs/      The full product spec this code implements pieces of.
```

## What's real vs. stubbed

**Fully real, tested, and runnable right now**, with zero external dependencies (everything uses Node 22's built-in TypeScript support and test runner — `node --experimental-strip-types --test`):

- `shared/` — the mutual-radius "zone" matching rule (Section 5 of the spec), geo-bucketing with the boundary-neighbor fix, ride-code generation/entropy/expiration, a rate limiter, and the nav/chat/music audio-priority mixer. 37 tests.
- `backend/` — a real HTTP server (`POST /rides`, `POST /rides/join`, `POST /presence`, `GET /health`) built on `shared/` and Node's `http` module. 9 tests, including full end-to-end HTTP tests that prove two nearby riders get matched into the same zone and that ride-code brute-forcing gets rate-limited. It also runs as an actual standalone process — `npm run dev:backend` — and has been smoke-tested live with `curl`.
- `mobile/src/api/client.ts` — the HTTP client the app would use to talk to the backend. 3 tests, using a mocked `fetch` so it needs no React Native install to verify.

**Written but unverified — needs a real dev machine, not this sandbox:**

- Everything else under `mobile/`. React Native, Expo, React Navigation, and LiveKit can't be installed here at all (same registry block), and there's no Xcode/Android Studio/physical device to build or run on regardless. The screens, navigation, `AudioEngine`, and `NowPlayingBridge` are written to be structurally correct against those libraries' real APIs, with `TODO(native)` comments marking every place that needs an actual native module (VAD/noise suppression, LiveKit room connection, OS media-session bridging, GPS) this environment couldn't touch.

Run `npm install` and `npx expo start` on a real machine to actually build the app — that's the point where the stubbed pieces get filled in.

## Running the tests

```bash
npm install     # workspace linking only — no external packages to fetch
npm test        # runs shared + backend + mobile-client suites (49 tests)
```

Run one workspace at a time if you want to see a single suite:

```bash
npm run test --workspace=shared
npm run test --workspace=backend
npm run test:client --workspace=mobile
```

## Running the backend for real

```bash
npm run dev:backend
# in another terminal:
curl -X POST http://localhost:4000/rides -H 'Content-Type: application/json' -d '{"riderId":"ali"}'
```

## What to build next

In priority order, per Section 17 of the spec:

1. **Security/reliability hardening** (spec Section 13-14) before any real users touch this — the ride-code rate limiting and mutual-radius logic here are real, but multi-region deployment, GPS-spoofing checks, and a real auth system are not built yet.
2. **The actual voice layer.** This repo has the *decision* logic (who's in zone, what the audio mixer should do) but not a LiveKit room connection, VOX/noise-suppression pipeline, or Bluetooth headset audio routing — all native-module work that needs a real device.
3. **Turn-by-turn navigation** (Mapbox Navigation SDK), ducked against the chat/music buses using the same `computeAudioGains` logic already built and tested in `shared/`.

See `docs/spec.md` for the full reasoning behind every decision above (why mutual radius, why geo-bucketing, why VOX over push-to-talk, etc).
