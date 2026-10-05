# Rider Comms project status

> Snapshot: 3 October 2026. This file is a handover/status snapshot, not a substitute for live GitHub state. Before changing code, re-check current `main`, open PRs, their exact HEAD SHAs/checks, and file overlap.

## Executive status

- **Lifecycle:** release candidate. The code is ready for store submission; the remaining steps need the owner and are listed in order in `LAUNCH_CHECKLIST.md`.
- **Main verification:** every change merges through a PR with a green CI `verify` job. Railway deploys the backend from `main` behind the `/ready` health check (a deploy that can't reach the database never takes traffic); GitHub Pages deploys the PWA.
- **Client parity:** `client-parity.json` records PWA/native parity for every tracked capability except **navigation**, which remains a `behavior-gap`: native navigation keeps guiding with the phone locked, which the PWA can't, and physical ride validation is pending.
- **Device evidence:** a two-rider ride over helmet intercoms works on real devices, and the installed-iPhone PWA chat composer fix (#386) is confirmed.
- **Recent work (#379–#390):**
  - PWA safety parity, report sources and filter-rejection counts (#379);
  - viewport, day-label and composer fixes (#380–#386);
  - full audit: visible backup failures, pinned LiveKit script with SRI, HSTS, per-account login limit (#387);
  - Railway volume backups, CI backup-and-restore drill, signup limit per address, accurate native permission strings, store listing and Google Play answers (#388);
  - dependency updates and coverage floors that count only each package's own code (#389);
  - readable backend handlers, minified PWA (app.js 83 KB to 47 KB gzipped), HEAD health probes, accessibility guards (#390).

## What is currently on `main`

### Accounts, identity and safety

- PostgreSQL-backed username/password accounts, password recovery, expiring/revocable sessions and account deletion.
- Profiles, selectable rider avatars, social-profile visibility controls, session management, blocks and reports.
- Actor-authorised API behavior and durable moderation data, with an admin moderation queue (review, suspend, unsuspend) and an append-only audit log.
- A staff dashboard (`docs/admin.html`, documented in `MODERATION.md`) with business metrics and 30-day trends, rider lookup, moderation and system health. It is admin-only and enforced by the backend.
- Block relationships now also gate private-ride coordinate responses in both directions, while preserving the requesting rider's own shared location.

### Friends and messaging

- Friends, requests, outgoing-request cancellation, direct messages, unread/read state and older-message pagination.
- Durable realtime social invalidation/events with PWA/native parity.
- Hideouts and social-profile privacy are available in both clients.

### Rides, location and hazards

- Private group rides: create, join, leave, end, host removal and explicit per-ride location-sharing consent.
- Public proximity presence with server-controlled radius and fresh/accurate location validation. A fix implying more than 250 mph since the rider's last one (kept 30 minutes) is rejected, and updates are limited to 20 per rider per minute, so fabricated positions can't be used to locate other riders.
- Crowdsourced hazards with matching PWA/native behavior. Nearby hazards no longer reveal who reported them, and voting is POST-only behind email verification.
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
- CI fails if line coverage drops below its floor: shared 95%, backend 93%, mobile node:test 96%, mobile Jest 89%. Backend and mobile reports count only their own code; shared code is measured in its own report.
- Operations:
  - A retention sweep runs every 15 minutes (`RETENTION.md`).
  - Encrypted database backups have a restore check (`BACKUP_RESTORE.md`).
  - App crash reports go to `POST /client-errors`.
  - Staff get batched error alert emails, at most one every 15 minutes, sent to `ALERT_EMAIL` or verified admins. Delivery was verified on production on 29 September.
- The PWA is edited in `docs/app/*.js` and assembled into `docs/app.js` with `npm run build:pwa-app`. Lint fails if the assembled file is stale.
- The native workspace has a Jest + `jest-expo` suite (`mobile/tests-jest`, 137 tests at this snapshot) covering the extracted map hooks (`usePresence`, `useRideProfiles`, `useNavigationSummary`, `useHazardReports`, `useInAppNavigation`), `useVoiceActivity`, and the Auth, Ride, Settings, Friends and MovementSafety contexts. It runs as part of root `npm test` alongside the legacy `node:test` client suite.
- `main` deploys the PWA through GitHub Pages.

## Open PRs at this snapshot

None besides the PR that updates this file, so there is no active file ownership to coordinate around. Live GitHub state stays authoritative.

## Current release blockers

The code-side App Store requirements are done (see `APP_REVIEW.md`). What remains needs the owner:

- legal: fill in `legal/site-details.json` and have a lawyer complete the bracketed sections of the published Privacy Policy and Terms;
- operations: a monitored support address, a staffed moderation queue (the app promises review within 24 hours), and scheduled encrypted backups with a real key;
- Apple: Developer Program membership, signing, TestFlight, the App Store Connect answers in `APP_REVIEW.md`, and a demo account for review;
- physical testing on a motorcycle: navigation, rerouting, degraded GPS, locked-screen voice and common Bluetooth helmet intercoms, plus the screen-reader and text-size checks in `ACCESSIBILITY.md`;
- later, not blocking a free launch: push notifications (needs APNs credentials), in-app purchase for wider Nearby ranges, offline maps, and Android.

Load and outage behaviour is documented in `LOAD_TESTING.md` and `OUTAGES.md`.

See `AUDIT.md` for the engineering risk register and `COMPLIANCE.md` for store/production readiness requirements. `AUDIT.md` is dated 18 September 2026, with addenda from 28 September and from the 29 September full code review, so current code and live CI take precedence where the repository has moved on.

## Source-of-truth order

When documents disagree, use this order:

1. current repository code on `main`;
2. live open PR diffs and exact-head CI checks;
3. `client-parity.json` for machine-tracked client parity;
4. `PROJECT_STATUS.md` for the latest documented handover snapshot;
5. `AUDIT.md`, `CLIENT_PARITY.md`, `COMPLIANCE.md` and `docs/spec.md` for engineering, parity, compliance and product intent.

Update this status file whenever a meaningful batch of PRs lands or the release posture changes.
