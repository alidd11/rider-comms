# Rider Comms engineering audit

Audit date: 2026-09-18

This document records the current engineering assessment of `main`. Repository code, CI and the machine-readable parity manifest remain authoritative if this document becomes stale.

## Current verified state

Rider Comms remains a pre-alpha, but several blockers listed in the 2026-09-15 audit have since been implemented.

Current verified foundations include:

- PostgreSQL-backed username/password accounts with expiring, revocable sessions.
- Actor-authorised profiles, friendships, direct messages, Hideouts, public presence, private rides, hazards, blocks, reports and account deletion.
- Transaction-backed account deletion and durable moderation records.
- Password-recovery flows in both clients.
- Private-ride create/join/leave/end, host removal and explicit per-ride location sharing.
- LiveKit-backed public/private rider voice plumbing, native audio routing and navigation-prompt priority/ducking.
- PWA/native Ride Safe parity using the shared 8 mph rule: only confirmed sustained movement locks distracting controls; unknown or stale GPS is warning-only.
- PWA/native direct-message, Hideout, block/report, account/session, Recent Places, hazard, profile/avatar and billing-preview parity.
- Selectable Rider Comms, Google Maps, Waze and Apple Maps navigation providers.
- In-app route/step guidance, ETA/distance, spoken prompts, arrival handling, automatic rerouting and explicit GPS-loss/recovery handling without discarding the active route.
- Health/readiness endpoints, migration-before-listen startup, graceful shutdown, structured request logging and request IDs.
- PostgreSQL-backed CI plus web build, PWA visual smoke coverage and Android/iOS Expo exports.

The current parity manifest has one intentional behavior gap: navigation. Both clients expose navigation, but background/locked-screen guidance and physical ride/Bluetooth validation remain outstanding.

## Verification

Verified on `main` on 2026-09-18:

- repository lint and TypeScript checks passed;
- 84 shared tests passed;
- 157 backend tests passed;
- 83 native-client tests passed;
- 90 PWA visual/browser tests passed across the configured phone, WebKit, tablet and landscape projects;
- web build passed;
- Android Expo export passed;
- iOS Expo export passed;
- PWA deployment and GitHub Pages deployment passed.

The PWA visual suite is useful regression coverage, but it is not a substitute for installed-device testing. iOS safe-area, keyboard and home-indicator behavior must continue to be verified on a physical installed PWA.

## Remaining release blockers

### Navigation and riding validation

The native in-app route fetch still uses a pre-release Google Directions web-service path. A public release should move to an approved native navigation SDK or a protected server-side routing service rather than shipping a reusable web-service credential in the client.

Background and locked-screen navigation is not yet production-complete. Navigation, LiveKit voice and audio routing must be validated during real rides with the screen locked, after missed turns, through degraded/lost GPS, across app background/foreground transitions and with common Bluetooth helmet systems.

VOX, wind/engine-noise behavior, echo handling and prompt/chat ducking require physical motorcycle/headset testing. Automated audio-priority tests verify state and gain decisions, not the end-to-end acoustic result.

### Production operations

Production still needs documented retention schedules, encrypted/controlled production backups, tested restore procedures and scheduled retention/deletion operations.

Mobile crash reporting and end-to-end operational monitoring are not yet a complete production observability stack. Structured backend logs and health/readiness checks exist, but they do not replace alerting, dashboards and client crash telemetry.

Moderation data and in-app report/block controls exist, but launch still requires a staffed moderation queue, response targets, appeal/escalation procedures and abuse-operations tooling.

Password recovery exists in code; production email delivery, sender/domain configuration and recovery operations still require deployment verification.

### Store, policy and identity

Store billing is intentionally not connected. Paid plan cards are preview-only and cannot unlock Premium/Premium+ without verified App Store/Google Play purchase and receipt handling.

A complete privacy policy, terms, monitored support channel, store privacy/data-safety declarations, content ratings and account-deletion metadata remain operational requirements.

Production Universal Links/App Links still require the final controlled domain, Apple Team ID, Android signing certificate and domain-root association files.

Accessibility requires physical-device review, including screen readers, Dynamic Type/text scaling, contrast, touch targets and riding-relevant non-audio cues.

### Scale and resilience

Presence, voice and database behavior need load and failure testing representative of dense rider events rather than only normal development traffic. Multi-region/failover strategy and explicit degraded-mode behavior remain pre-launch architecture work.

Third-party maps, routing, LiveKit and email dependencies need production quota, outage and credential-rotation procedures.

## Current audit findings to track

- `npm ci` currently reports 15 dependency vulnerabilities (13 moderate, 2 high). Their applicability to shipped runtime code has not yet been triaged; do not equate the raw count with exploitable product vulnerabilities, but resolve or document each before release.
- Navigation remains a `behavior-gap` in `client-parity.json`; do not mark it complete from automated tests alone.
- Installed-iPhone PWA viewport/keyboard/safe-area behavior has repeatedly differed from desktop/WebKit simulation. Physical-device evidence takes precedence over a green synthetic geometry assertion.
- Public Nearby voice on the installed PWA intentionally releases microphone capture while no authorised proximity peer is connected; the system microphone indicator may therefore disappear after the initial permission/preflight capture even though Nearby remains armed and location-visible. A physical iOS PWA test previously observed the mic indicator disappearing after roughly 4–5 seconds. Treat that as expected only in the “Nearby Voice · waiting for riders” state. With an authorised peer connected, the pair-isolated LiveKit room and independent VOX meter must remain active. The PWA now also fails closed if WebKit suspends the VOX AudioContext, attempts to resume it on foreground, and exposes a rider-tap “Resume voice” path when automatic recovery is not permitted. Automated coverage holds a simulated public connection beyond five seconds and exercises that suspend/resume cycle, but an installed-device two-rider test is still required.
- The product specification contains aspirational architecture and future features. It is design intent, not evidence that a feature is implemented.

## Release posture

The repository is suitable for continued pre-alpha/internal testing with non-sensitive test data. It is not yet ready for a public production launch.

The highest-value next validation work is physical navigation/voice testing and background execution, followed by production operations (backup/restore, retention, monitoring, moderation and policy/store readiness). Security/privacy findings should continue to be fixed as isolated, tested changes rather than being deferred to a final pre-release pass.
