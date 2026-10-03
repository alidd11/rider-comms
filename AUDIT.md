# Rider Comms engineering audit

Audit date: 2026-09-18 (addenda 2026-09-28, 2026-09-29, 2026-10-01 and 2026-10-03 below)

This document records the current engineering assessment of `main`. Repository code, CI and the machine-readable parity manifest remain authoritative if this document becomes stale.

## Addendum — 2026-10-01 (second security pass)

Scope: code added since 2026-09-29. That covers:
- the staff dashboard and its admin endpoints
- crash reports (`POST /client-errors`)
- the places proxy
- outage timeouts
- the load-test fixes
- funnel milestones

Also re-checked: per-endpoint rate limits on every write route, and dependency advisories.

**Fixed**
- **Hideout fan-out (medium, availability):** `POST /hideouts` accepted any number of `participantIds`, and each one cost a friendship query. The 32 KB body cap still allowed about 4,000 queries per request. The list is now capped at 20, a ride group's size.
- **Unbounded ride and hideout creation (low, abuse):** both relied only on the global 300/min limit. They now have their own limits: 10 rides and 10 hideouts per rider per 10 minutes (migration `0042`). A new test checks that every configured rate-limit action is accepted by the database's CHECK constraint, so a policy can't ship without its migration.
- **`brace-expansion` (high, ReDoS, build tooling):** patched by `npm audit fix`, which only made patch-level bumps. The remaining 11 moderate findings are the Expo tooling chain described below; they need the parked Expo major upgrade.

**Checked and sound**
- **Admin endpoints:** `/admin/*` re-reads admin status from Postgres on every request, and the tests cover the 403 for non-admins. Rider search escapes `%` and `_` and caps results at 50. The dashboard renders all rider text with `textContent` and runs under a CSP without `unsafe-inline`.
- **Funnel milestones:** written only by the server, once per rider, and deleted with the account. The dashboard sees only counts.
- **Outage paths:** Resend (5 s), LiveKit revocation (5 s) and Google (8 s) all time out inside the apps' 10–12 s request limits. A failed revocation is logged and doesn't fail the request.
- **Scenic-route creation** is admin-only. Friend requests, messages and safety reports have their own social limits. Presence, directions, places, hazards, ride joins and all auth routes were already limited.

## Addendum — 2026-09-28

- **Routing credential:** resolved. Native in-app routing now calls the authenticated, rate-limited backend `POST /directions` proxy (#315), with a server-side route cache (#334). The client-side Directions web-service key was removed (#318). `GOOGLE_DIRECTIONS_API_KEY` is backend-only.
- **Place search credential:** resolved by moving native place search behind authenticated, rate-limited backend endpoints (`POST /places/search` and `/places/nearby`). The Google Places key is now backend-only (`GOOGLE_PLACES_API_KEY`, falling back to `GOOGLE_DIRECTIONS_API_KEY`) and `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` was removed from the app. The PWA's Maps JavaScript browser key is origin-restricted and unchanged.
- **Dependencies:** PR #359 moved `@playwright/test` to 1.55.1, clearing both high-severity findings (Playwright's unverified browser download). `npm audit` now reports 11 moderate findings:
  - Expo CLI/config tooling (`@expo/cli`, `@expo/config`, `@expo/config-plugins`, `@expo/prebuild-config`, `@expo/metro-config`, `@expo/inline-modules`, `@expo/local-build-cache-provider`, `xcode`, `uuid`, `@config-plugins/react-native-webrtc`, `expo`): `npm audit`'s only offered fix is a semver-major downgrade to `expo@46`, which is not viable. These are mostly build-time tooling; track upstream Expo releases.
  - `decode-uri-component` (via `query-string` via `@react-navigation/core` 7.21, reachable through deep-link URL parsing) is resolved: the `@react-navigation/*` packages were upgraded within their majors to core 7.22, which drops `query-string`.
- **Native test coverage:** `mobile/tests-jest` now has 120 Jest tests across 11 suites, covering the extracted map hooks, VOX and the app contexts. It runs in root `npm test` and therefore in CI.

## Addendum — 2026-09-29 (full code review)

Scope: every backend route module and store, `serverHttp.ts`, auth, email, LiveKit token minting, `shared/src`, the PWA (`docs/app/*.js`, with every `innerHTML` template checked for escaping) and the native app's auth storage, API client and configuration.

**Fixed in this change**
- **Hazard reporter exposed (medium, privacy):** `GET /hazards/nearby` returned `reportedBy`, so any signed-in rider could link a hazard's location and time to the rider who reported it. The field is no longer published; it stays server-side for the DELETE ownership check.
- **Hazard votes bypassed email verification (medium):** `/hazards/:id/confirm` and `/deny` matched any HTTP method, but the verified-email gate only covers POST, so a `GET` vote skipped it. The route is now POST-only.

**Fixed after review**
- **Presence probing (high, privacy):** `POST /presence` trusted the client's coordinates and replied with the riders inside your zone, so a signed-in rider could submit fabricated positions to narrow down where a location-sharing rider is. Each rider's last accepted fix is now kept for 30 minutes (`presence_movement_anchors`), and a fix implying more than 250 mph since then is rejected with `422 implausible_location_jump`. There is a 200 m allowance for GPS error. The check survives the 30-second presence lease, so going quiet does not reset it, while a rider returning after more than 30 minutes (for example after a flight) is not compared. Both clients explain the rejection and keep trying on the next fix.
- **No crash alerting (medium, operations):** errors were only logged. The backend now emails staff about 500s, crashes, unhandled rejections and app crash reports, batched to at most one email per 15 minutes.
- **Coverage could regress silently:** CI now fails if any package's line coverage drops below its floor (shared 95%, backend 88%, mobile node:test 88%, mobile Jest 84%).

**Checked and sound**
- **Authorisation:** every rider-scoped route checks that the actor is the resource owner or a member. Direct messages, hideouts and friend actions require friendship and no block. Moderation re-reads admin status from Postgres on each request.
- **Authentication:** bearer tokens, not cookies, so there is no CSRF surface. Native sessions are stored in the platform keychain (SecureStore).
- **Client IP:** Railway's edge replaces a client-supplied `X-Forwarded-For` (verified on production: a spoofed header was logged as the real address), so `TRUST_PROXY=true` is safe there.
- **Input handling:** SQL is fully parameterised. Profile updates are allowlisted. Request bodies are size-bounded. Social event cursors are strictly validated.
- **PWA output:** all rider-controlled text in `innerHTML` templates goes through `escapeHtml`. The remaining interpolations are internal constants or numbers. Outbound navigation links are built with `URLSearchParams`.
- **Voice:** LiveKit tokens are room-scoped, with short TTLs and leases re-checked against current proximity and block state.
- **Transport:** release builds point at the HTTPS API, and every API request has a timeout.

**Low / informational**
- Email verification and reset tokens travel in link query strings, which is the standard pattern. They expire after 24 hours and one hour respectively, reset tokens are single-use, and the PWA removes the token from the address bar (`history.replaceState`) as soon as it reads it.
- `POST /presence` now also has a per-rider rate limit of 20 per minute. Both apps send every 8 seconds, so this only affects scripted clients.

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

Native in-app routing and place search now go through protected backend proxies (`/directions`, `/places/*`; see the 2026-09-28 addendum), so no Google web-service key ships in the app.

Background and locked-screen navigation is not yet production-complete. Native voice now has the platform infrastructure needed for background audio: iOS declares the audio background mode, while Android starts a microphone-typed foreground service before the LiveKit audio session and keeps it leased across public/private voice owners. Navigation, LiveKit voice and audio routing must still be validated during real rides with the screen locked, after missed turns, through degraded/lost GPS, across app background/foreground transitions and with common Bluetooth helmet systems.

VOX, wind/engine-noise behavior, echo handling and prompt/chat ducking require physical motorcycle/headset testing. Automated audio-priority tests verify state and gain decisions, not the end-to-end acoustic result.

### Production operations

The retention schedule is documented in `RETENTION.md`, and scheduled sweeps now also remove stale presence, ride locations, expired ride codes, abandoned rides and expired hazard reports. `BACKUP_RESTORE.md` covers encrypted nightly backups (`.github/workflows/backup.yml`, which verifies each dump by restoring it), the restore-drill script and the recovery procedure. Still outstanding: configuring the backup secrets, private-key custody, and running and recording restore drills.

Vendor-free crash reporting now exists: the native app (global JS handler plus a render error boundary with a recovery screen) and the PWA (`error` / `unhandledrejection`) report to `POST /client-errors`, which writes structured `client_error` log events. The backend logs `request_failed`, `unhandled_rejection` and `uncaught_exception` as structured events too. Still missing: alert rules on those events in the hosting provider, dashboards and metrics, and native-level (non-JS) crash capture, which needs a native SDK.

Moderation data, in-app report/block controls and an admin moderation API now exist (see `MODERATION.md`): a review queue, dismiss or suspend decisions (suspension revokes sessions and refuses sign-in), unsuspend for appeals, and an audit log. Launch still needs named moderators, published response targets and a monitored appeals channel.

Password recovery exists in code; production email delivery, sender/domain configuration and recovery operations still require deployment verification.

### Store, policy and identity

Store billing is intentionally not connected. Both clients show only the rider's current Nearby range; no prices or purchasable plans are shown, and Premium/Premium+ cannot be unlocked without verified App Store/Google Play purchase handling.

A complete privacy policy, terms, monitored support channel, store privacy/data-safety declarations, content ratings and account-deletion metadata remain operational requirements.

Production Universal Links/App Links still require the final controlled domain, Apple Team ID, Android signing certificate and domain-root association files.

Accessibility requires physical-device review, including screen readers, Dynamic Type/text scaling, contrast, touch targets and riding-relevant non-audio cues.

### Scale and resilience

Presence, voice and database behavior need load and failure testing representative of dense rider events rather than only normal development traffic. Multi-region/failover strategy and explicit degraded-mode behavior remain pre-launch architecture work.

Third-party maps, routing, LiveKit and email dependencies need production quota, outage and credential-rotation procedures.

## Addendum 2026-10-03: full audit

Checked live: security headers, CORS (unknown origins get 403), 1 MB body cap, clean 400/401/413 errors, no 5xx in the last 7 days, backend memory ~0.1 GB of 8 GB. Code review: scrypt passwords, hashed 30-day session tokens, suspension revokes sessions, admin re-checked per request, ownership enforced on every mutating route, Nearby returns rider IDs only (never coordinates) with blocks filtered, external text escaped before `innerHTML`. The public Maps key is referrer-restricted (Google rejects it from other origins). Retention and cleanup jobs run on schedule; uptime checks pass.

Fixed in this pass:
- **Backups were not running.** The nightly job was green but skipped every step because its two secrets were never set. It now fails until they are, so the gap is visible. Setting the secrets is an owner task (`BACKUP_RESTORE.md`). Railway volume backups of the production database are now enabled as a first layer (daily, kept 7 days; weekly, kept 4 weeks).
- PWA `script-src` allowed all of `cdn.jsdelivr.net`; it now allows only the pinned LiveKit file, which loads with a subresource-integrity hash (matches the npm 2.22.3 bundle).
- Backend sends `Strict-Transport-Security`.
- Login is limited per account (10 per 15 minutes) as well as per address (migration 0045).
- The iOS associated domain is removed until the association file and Team ID exist.
- CI timeout raised to 25 minutes, with Playwright browsers cached.
- Dated audit reports moved to `docs-archive/`.
- Installed-iPhone PWA chat composer no longer cut off at the bottom (#386; confirmed on device).
- Railway edge request tracing enabled for the backend (per-request latency and status).

Still open:
- iOS 26+ draws a Liquid Glass blur over the top of Home Screen web apps where the page isn't a flat colour; the map shows it. System behaviour, accepted.
- Owner items: legal details and review, monitored support email, backup secrets, Apple Developer setup and demo account, physical-device testing.
- `npm audit`: 14 findings (5 high, 9 moderate), all in Expo build tooling (node-forge, uuid, xcode); none ship in the app or run on the server.

## Current audit findings to track

- Dependency findings are triaged in the 2026-09-28 addendum: 0 high since #359, and 11 moderate, all Expo CLI/config tooling with no non-breaking fix.
- Navigation remains a `behavior-gap` in `client-parity.json`; do not mark it complete from automated tests alone.
- Installed-iPhone PWA viewport/keyboard/safe-area behavior has repeatedly differed from desktop/WebKit simulation. Physical-device evidence takes precedence over a green synthetic geometry assertion.
- Public Nearby voice on the installed PWA intentionally releases microphone capture while no authorised proximity peer is connected; the system microphone indicator may therefore disappear after the initial permission/preflight capture even though Nearby remains armed and location-visible. A physical iOS PWA test previously observed the mic indicator disappearing after roughly 4–5 seconds. Treat that as expected only in the “Nearby Voice · waiting for riders” state. With an authorised peer connected, the pair-isolated LiveKit room and independent VOX meter must remain active. The PWA now also fails closed if WebKit suspends the VOX AudioContext, attempts to resume it on foreground, and exposes a rider-tap “Resume voice” path when automatic recovery is not permitted. Public pair authorization is separately renewed from current server-side proximity/block state: the backend advertises a 20-second refresh cadence and 60-second authorization lease, and both PWA/native tear stale public rooms down if that lease cannot be renewed. Automated coverage holds a simulated public connection beyond five seconds, exercises the suspend/resume cycle, and verifies PWA lease expiry, but an installed-device two-rider test is still required.
- The product specification contains aspirational architecture and future features. It is design intent, not evidence that a feature is implemented.

## Release posture

The repository is suitable for continued pre-alpha/internal testing with non-sensitive test data. It is not yet ready for a public production launch.

The highest-value next validation work is physical navigation/voice testing and background execution, followed by production operations (backup/restore, retention, monitoring, moderation and policy/store readiness). Security/privacy findings should continue to be fixed as isolated, tested changes rather than being deferred to a final pre-release pass.
