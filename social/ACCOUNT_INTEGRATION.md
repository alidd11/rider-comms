# Shared Rider Comms account integration — Social

Implemented in `social/mobile/` on PR #449. This is not a separate identity system. The existing Rider Comms backend is the sole source of account IDs, usernames, password verification, sessions, account suspension and Terms versions.

## Account and security design

- Backend: `https://backend-production-7fa0.up.railway.app`.
- Sign in: `POST /auth/login`. Sign-up: `POST /auth/signup` with explicit checkbox consent before sending `acceptTerms:true`. Both are followed by `GET /auth/me`; a missing/null username or failed validation is a guest or invalid identity and is rejected.
- Cold-start `GET /auth/me` validates a saved token. A protected 401 clears the token and returns to sign-in without retry. Expired, revoked or suspended accounts do not enter Social. Temporary connection errors do not silently delete potentially valid saved sessions.
- Terms re-acceptance: `POST /auth/accept-terms` with the version from `/auth/me`; sign-out: `POST /auth/logout`, followed by unconditional local credential deletion.
- Password recovery uses `POST /auth/password-reset/request` and a non-enumerating success message; verification resend uses `POST /auth/resend-verification`.
- iOS/Android: `expo-secure-store` (Keychain/Keystore) stores the session. The Social package has its own separate encrypted storage; no credentials in AsyncStorage or URLs. Web: ephemeral in-memory reference and `sessionStorage` only; never localStorage, cookies, analytics or logs. Neither passwords nor real tokens enter CI, tests or screenshots.
- Browser cross-origin requests use `Authorization: Bearer` and JSON bodies; browser fetch sends `credentials: omit`, disallows redirects and always requests no-store responses.
- The 16+ Social development preview has its own self-declaration after sign-in. **This is not verified age assurance.** The backend does not establish age and the current self-declaration cannot authorise real posting, livestreaming, payouts or legally age-restricted activity.

## Web allowlist request for Rider Comms backend owner

Add this exact origin to Railway's `CORS_ALLOWED_ORIGINS` on the backend service:

```
https://social-web-preview-preview.up.railway.app
```

No path, trailing slash, wildcard or credentials in the origin entry. Keep existing allowed Rider Comms origins. It is an HTTPS browser origin, not an API endpoint. The social preview URL is `https://social-web-preview-preview.up.railway.app/`. Until CORS is configured, browser sign-in to the production backend may be blocked even though the same account works in native builds. Do not send a production password or token to anyone; enter it only in the Social app yourself.

## Shared data available now (read-only)

- `GET /riders/{your authenticated riderId}/friends?limit=50` lists the actual Rider Comms friendships in Social's Friends panel. No arbitrary target rider IDs are allowed.
- `GET /conversations?limit=50` lists actual conversation summaries in Social. No message is sent, marked read, or changed by this integration.
- Existing username and rider ID are reused. Social can be installed alone and still sign in using the Rider Comms account.
- Social follows, sample Reels, demo posts, local comments, local garage and profile drafts are **not** shared to the backend. Local draft data is keyed per authenticated rider ID, so another person signing in on the same device does not inherit it.

## Backend requests — **do not implement inside Social**

1. **CORS and origin controls** — allowlist the exact Social preview origin above; later add production Social custom origin. Verify allowed methods/headers and never use broad CORS wildcards for authenticated content.
2. **Social profile and follow graph** — versioned per-rider Social profile API, independent followers/following, account privacy, blocks, hide/mute, privacy visibility, indexed handles, pagination, deactivation and deletion. Shared Rider Comms friendships should remain mutual and separate.
3. **Shared messaging contract** — confirm friend/blocked/verified-email checks, privacy, pagination and realtime unread/read receipts across both clients; then add Social write capabilities with concurrency tests. Distinguish Social group, club, event and merchant conversations from direct Rider Comms DMs. Verify cross-client revocation and account deletion.
4. **Media publishing and moderation** — signed upload destinations, durable storage and CDN, virus/NSFW and rights checks, access control, expiry, transcoding, trim/cover metadata, moderation queues, deletion, reports, appeals and age eligibility. There is currently **no secure Social publishing API**, so the Post button stays disabled.
5. **Authoritative age/region policy** — approved age assurance provider, configurable jurisdictional thresholds, verifiable claims with minimal retention, appeals and restricted 16–17 experience. Never trust a self-declared checkbox for access control.
6. **Social-specific APIs** — Stories and expiration, profiles/garages, clubs/events/RSVPs, referrals, discovery ranking and feedback, ads controls and merchant commerce. Do not reuse live ride location or proximity voice permission as Social discovery consent.
7. **Client parity and safe-area acceptance** — perform physical-device tests on installed iPhone PWA, iOS native and Android native. Chromium viewport tests do not reproduce Dynamic Island or system home-indicator behavior.

## Test and release criteria

- `npm ci` against `social/mobile/package-lock.json` for repeatable, isolated dependencies.
- Social workflow actions pinned to full commit SHAs; unit tests use mocked fetch, synthetic credentials and cover login, all declared error codes, 401 deletion/no retry, guest rejection, consent, recovery, Terms and logout.
- Playwright browser tests use route-mocked fake accounts, never connect to real password services, and cover login/age gates alongside existing media, layout and Feed tests.
- Do not merge PR #449 until both Social CI and root CI pass at the exact current head SHA, live iPhone rendering is reviewed, and the owner confirms the backend CORS allowlist.
