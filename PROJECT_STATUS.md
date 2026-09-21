# Rider Comms project status

> Snapshot: 21 September 2026. This file is a handover/status snapshot, not a substitute for live GitHub state. Before changing code, re-check current `main`, open PRs, their exact HEAD SHAs/checks, and file overlap.

## Executive status

- **Lifecycle:** pre-alpha / internal testing. The repository is suitable for continued development and controlled testing, not public production use.
- **Snapshot main:** `7fdbedb77ade2eb9ae9ea1021fabbf29f15d2e68` — merge of PR #283, **Enforce blocks on private ride locations**.
- **Main verification:** CI, PWA deployment and GitHub Pages deployment all completed successfully on that exact main SHA.
- **Client parity:** `client-parity.json` currently records PWA/native parity for every tracked capability except **navigation**, which remains a `behavior-gap` pending production-grade background/locked-screen and physical ride validation.
- **Active development:** Settings parity, clicked-friend profile alignment, navigation header/control refinement and route-aware Road ahead alerts are in separate open PRs. PR #283's private-ride location privacy fix is now merged.

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
- Native audio-session/Bluetooth coexistence infrastructure and navigation-prompt priority/ducking.
- Physical-device validation remains important for helmet/intercom behavior, wind/engine noise, background execution and locked-screen continuity.

### Delivery and verification

- Node 22+ monorepo with shared, backend and Expo/React Native workspaces.
- PostgreSQL-backed automated tests, TypeScript/lint checks, PWA build, Playwright visual audit, Android export and iOS export are exercised by CI.
- `main` deploys the PWA through GitHub Pages.

## Open PRs at this snapshot

| PR | State | Exact head at review | Scope |
| --- | --- | --- | --- |
| #276 | Draft | `e8047a12e0f670239d7637614c207a9f4911eb7e` | Settings information architecture. Native redesign is implemented; the PWA parity pass is intentionally waiting for overlapping shared-PWA work to land. |
| #279 | Draft | `e11e95c1ab24f7343ada644a4ad4cf9a19af820e` | Align the clicked-friend profile with the approved compact sheet while preserving real privacy/location state. |
| #280 | Draft | `cba6d9fd62a8f39e33188a83ed5a7f46352e6668` | Navigation header hierarchy, prominent live-speed badge, larger in-navigation rider avatar and explicit route-finish marker. |
| #285 | Draft | `3ad40cd5670134cf0ab621844894e393b363a2f8` | Current-main successor to closed #281; docks Report/Mute/Overview controls together above the ETA summary. |
| #282 | Draft | `81a74cba39c34d2a01d2ec09d3c3667c943873ac` | Route-aware **Road ahead** alerts using Rider Comms' own hazard/report data only. |

Exact-head CI was checked before this snapshot. PR state and checks can change after this file is committed, so live GitHub checks remain authoritative for merge decisions.

## Active file ownership / coordination

Do not casually edit or rebase files already owned by the active PRs. At this snapshot:

- **#276** owns `client-parity.json`, `mobile/src/screens/SettingsScreen.tsx` and `mobile/tests/settingsLayout.test.ts`.
- **#279** owns the shared PWA shell (`docs/app.css`, `docs/app.js`, `docs/index.html`, `docs/sw.js`), the native Friends screen and PWA visual tests.
- **#280** owns shared PWA navigation shell files, `docs/map-rendering.md`, native navigation guidance/MapScreen work, avatar/parity guards and PWA visual tests.
- **#285** overlaps navigation CSS/index/service-worker files, `docs/map-rendering.md`, native `MapScreen.tsx`, the parity guard and PWA visual tests.
- **#282** overlaps the shared PWA shell, `client-parity.json`, navigation/MapScreen/parity/build files and adds the Road ahead implementation/tests/docs.

PR #281 was closed without merge and superseded by current-main PR #285. PR #283 has merged, so its backend files are no longer active-PR-owned. The highest-overlap area is the shared PWA/navigation surface. Those branches must be refreshed and reconciled against the newest `main` one at a time before final merge. Settings should not be marked complete until its PWA pass is performed after that overlap clears.

## Current release blockers

The project remains pre-alpha mainly because implementation breadth is now ahead of production validation/operations. The principal blockers are:

- production-grade routing/navigation delivery rather than shipping a reusable client-side web-service credential;
- physical motorcycle testing for navigation, missed-turn rerouting, degraded GPS, background/locked-screen execution, LiveKit voice and common Bluetooth helmet/intercom systems;
- App Store / Google Play billing and receipt validation;
- production retention, backups/restore, monitoring/alerting, moderation operations and recovery procedures;
- final privacy/terms/support/store declarations and account-deletion operational metadata;
- production Universal Link/App Link domain association using final Apple/Android signing identity;
- physical-device accessibility validation, including screen readers, text scaling, contrast and riding-safe non-audio cues;
- load/failure testing and documented degraded-mode behavior for dense rider events and third-party outages;
- continued dependency/security triage before release.

See `AUDIT.md` for the engineering risk register and `COMPLIANCE.md` for store/production readiness requirements. `AUDIT.md` is dated 18 September 2026, so current code and live CI take precedence where the repository has moved on.

## Source-of-truth order

When documents disagree, use this order:

1. current repository code on `main`;
2. live open PR diffs and exact-head CI checks;
3. `client-parity.json` for machine-tracked client parity;
4. `PROJECT_STATUS.md` for the latest documented handover snapshot;
5. `AUDIT.md`, `CLIENT_PARITY.md`, `COMPLIANCE.md` and `docs/spec.md` for engineering, parity, compliance and product intent.

Update this status file whenever a meaningful batch of PRs lands or the release posture changes.
