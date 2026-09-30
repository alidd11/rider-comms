# Rider Comms project status

> Snapshot: 30 September 2026. This file is a handover/status snapshot, not a substitute for live GitHub state. Before changing code, re-check current `main`, open PRs, their exact HEAD SHAs/checks, and file overlap.

## Executive status

- **Lifecycle:** pre-alpha / internal testing. The repository is suitable for continued development and controlled testing, not public production use.
- **Snapshot main:** `0c20df0` — merge of PR #370, **Move CI to Node 24 action releases and rate-limit presence updates**.
- **Main verification:** CI (`verify`) passed on the PR heads merged into that SHA; re-check live checks on `main` before relying on it.
- **Client parity:** `client-parity.json` currently records PWA/native parity for every tracked capability except **navigation**, which remains a `behavior-gap` pending production-grade background/locked-screen and physical ride validation.
- **Active development:** production hardening. Since #359:
  - backend Places proxy (#361);
  - react-navigation security upgrade (#362);
  - retention sweep, encrypted backups and a restore check (#363);
  - moderation queue with suspensions and an audit log, plus privacy/terms drafts (#364);
  - ESLint and coverage reporting (#365);
  - `server.ts` split into route modules (#366);
  - vendor-free crash reporting (#367);
  - PWA `docs/app.js` split into 20 feature files (#368);
  - full code-review fixes, error alert emails and coverage floors (#369);
  - Node 24 CI actions and a presence rate limit (#370).

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
- CI fails if line coverage drops below its floor: shared 95%, backend 88%, mobile node:test 88%, mobile Jest 84%.
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

The project remains pre-alpha mainly because implementation breadth is now ahead of production validation/operations. The principal blockers are:

- production navigation validation: routing and native place search now go through authenticated backend proxies (`/directions`, `/places/*`), so no Google web-service key ships in the app, but the Places key must be configured and quota-monitored on the backend;
- physical motorcycle testing for navigation, missed-turn rerouting, degraded GPS, background/locked-screen execution, LiveKit voice and common Bluetooth helmet/intercom systems;
- App Store / Google Play billing and receipt validation;
- operating the new retention, backup, alerting and moderation tooling in production: scheduling backups with a real encryption key, staffing the moderation queue, and rehearsing recovery;
- legal review of the drafts in `legal/`, then final privacy/terms/support/store declarations and account-deletion operational metadata;
- production Universal Link/App Link domain association using final Apple/Android signing identity;
- physical-device accessibility validation, including screen readers, text scaling, contrast and riding-safe non-audio cues;
- load/failure testing and documented degraded-mode behavior for dense rider events and third-party outages;
- continued dependency/security triage before release.

See `AUDIT.md` for the engineering risk register and `COMPLIANCE.md` for store/production readiness requirements. `AUDIT.md` is dated 18 September 2026, with addenda from 28 September and from the 29 September full code review, so current code and live CI take precedence where the repository has moved on.

## Source-of-truth order

When documents disagree, use this order:

1. current repository code on `main`;
2. live open PR diffs and exact-head CI checks;
3. `client-parity.json` for machine-tracked client parity;
4. `PROJECT_STATUS.md` for the latest documented handover snapshot;
5. `AUDIT.md`, `CLIENT_PARITY.md`, `COMPLIANCE.md` and `docs/spec.md` for engineering, parity, compliance and product intent.

Update this status file whenever a meaningful batch of PRs lands or the release posture changes.
