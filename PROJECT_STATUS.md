# Rider Comms project status

> Snapshot: 28 September 2026. This file is a handover/status snapshot, not a substitute for live GitHub state. Before changing code, re-check current `main`, open PRs, their exact HEAD SHAs/checks, and file overlap.

## Executive status

- **Lifecycle:** pre-alpha / internal testing. The repository is suitable for continued development and controlled testing, not public production use.
- **Snapshot main:** `579aa51a542270bbbaea40e4321cf80044fe69d8` — merge of PR #359, **Bump @playwright/test to 1.55.1 to clear the high-severity advisory**.
- **Main verification:** CI (`verify`) passed on the PR heads merged into that SHA; re-check live checks on `main` before relying on it.
- **Client parity:** `client-parity.json` currently records PWA/native parity for every tracked capability except **navigation**, which remains a `behavior-gap` pending production-grade background/locked-screen and physical ride validation.
- **Active development:** the Settings, friend-profile, navigation header/dock and Road ahead PRs listed in the previous snapshot (#276, #279, #280, #282, #285) have all merged. Since then, work has focused on hardening: a server-side Directions proxy (#315, #318), Places/Directions billing reductions (#334, #335), refactors splitting `MapScreen`/`server.ts`, a native Jest suite (#348–#358), and the Playwright 1.55.1 security bump (#359).

## What is currently on `main`

### Accounts, identity and safety

- PostgreSQL-backed username/password accounts, password recovery, expiring/revocable sessions and account deletion.
- Profiles, selectable rider avatars, social-profile visibility controls, session management, blocks and reports.
- Actor-authorised API behavior and durable moderation data.
- Block relationships now also gate private-ride coordinate responses in both directions, while preserving the requesting rider's own shared location.

### Friends and messaging

- Friends, requests, outgoing-request cancellation, direct messages, unread/read state and older-message pagination.
- Durable realtime social invalidation/events with PWA/native parity.
- Hideouts and social-profile privacy are available in both clients.

### Rides, location and hazards

- Private group rides: create, join, leave, end, host removal and explicit per-ride location-sharing consent.
- Public proximity presence with server-controlled radius and fresh/accurate location validation.
- Crowdsourced hazards with matching PWA/native behavior.
- Shared Ride Safe behavior at approximately 8 mph sustained movement; stale/unknown GPS warns rather than falsely locking the UI.

### Maps, routes and navigation

- Provider-backed maps and place search, plus scenic-route discovery.
- Account-scoped navigation provider choice: Rider Comms in-app guidance or explicit handoff to Google Maps, Waze or Apple Maps.
- In-app route geometry, maneuver steps, ETA/distance, arrival, rerouting and GPS-loss/recovery behavior.
- Adaptive navigation camera behavior, smoother PWA camera transitions, glanceable maneuver glyphs and current GPS-derived speed display.
- Rider Comms does not fabricate lane guidance, posted speed limits, traffic-light positions or other provider-owned navigation metadata when the active provider does not supply it.

### Voice

- LiveKit-backed public/private proximity voice and VOX plumbing.
- Private-ride voice now uses short-lived authorization, revokes affected LiveKit participants on block/leave/removal/ride end, and denies fresh ride tokens where a current block forbids re-entry.
- Native audio-session/Bluetooth coexistence infrastructure and navigation-prompt priority/ducking.
- Physical-device validation remains important for helmet/intercom behavior, wind/engine noise, background execution and locked-screen continuity.

### Delivery and verification

- Node 22+ monorepo with shared, backend and Expo/React Native workspaces.
- PostgreSQL-backed automated tests, TypeScript/lint checks, PWA build, Playwright visual audit, Android export and iOS export are exercised by CI.
- The native workspace has a Jest + `jest-expo` suite (`mobile/tests-jest`, 120 tests across 11 suites at this snapshot) covering the extracted map hooks (`usePresence`, `useRideProfiles`, `useNavigationSummary`, `useHazardReports`, `useInAppNavigation`), `useVoiceActivity`, and the Auth, Ride, Settings, Friends and MovementSafety contexts. It runs as part of root `npm test` alongside the legacy `node:test` client suite.
- `main` deploys the PWA through GitHub Pages.

## Open PRs at this snapshot

None besides the PR that updates this file, so there is no active file ownership to coordinate around. Live GitHub state stays authoritative.

## Current release blockers

The project remains pre-alpha mainly because implementation breadth is now ahead of production validation/operations. The principal blockers are:

- production-grade navigation delivery: routing now goes through the authenticated backend `/directions` proxy, but the native place-search key (`EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`) still ships in the app bundle and needs a decision (see `AUDIT.md`);
- physical motorcycle testing for navigation, missed-turn rerouting, degraded GPS, background/locked-screen execution, LiveKit voice and common Bluetooth helmet/intercom systems;
- App Store / Google Play billing and receipt validation;
- production retention, backups/restore, monitoring/alerting, moderation operations and recovery procedures;
- final privacy/terms/support/store declarations and account-deletion operational metadata;
- production Universal Link/App Link domain association using final Apple/Android signing identity;
- physical-device accessibility validation, including screen readers, text scaling, contrast and riding-safe non-audio cues;
- load/failure testing and documented degraded-mode behavior for dense rider events and third-party outages;
- continued dependency/security triage before release.

See `AUDIT.md` for the engineering risk register and `COMPLIANCE.md` for store/production readiness requirements. `AUDIT.md` is dated 18 September 2026 with a 28 September addendum, so current code and live CI take precedence where the repository has moved on.

## Source-of-truth order

When documents disagree, use this order:

1. current repository code on `main`;
2. live open PR diffs and exact-head CI checks;
3. `client-parity.json` for machine-tracked client parity;
4. `PROJECT_STATUS.md` for the latest documented handover snapshot;
5. `AUDIT.md`, `CLIENT_PARITY.md`, `COMPLIANCE.md` and `docs/spec.md` for engineering, parity, compliance and product intent.

Update this status file whenever a meaningful batch of PRs lands or the release posture changes.
