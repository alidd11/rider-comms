# Rider Social — restricted live-test release contract

**13 November 2026 | Owner: Social UI | Backend: Rider Comms agent**

## Current state

The Social PWA is reachable on `https://social-web-preview-preview.up.railway.app`, with the same full Rider Comms account as the navigation app. Authentication, profile identity, friends and existing direct-message APIs are integrated. Public Social publishing, cloud media storage, creator revenue and checkout are **not** integrated. A camera/editor preview is not a posted Reel.

Production bundles now disable fictional feed content; the only exception is a build-time fixture flag used by isolated screenshot tests. None of that sample media belongs to a real account.

**Important:** CORS approval for the Social web origin protects which browsers may call the Rider Comms API. **It is not an account allowlist.** A publicly reachable login screen does not restrict the preview to a single person. Client-side riderId checks, hidden buttons or opaque URLs would not provide secure restriction.

## Requests for Rider Comms: minimum backend contract

### 1. Private pilot and server-enforced access

- Use the authenticated Rider Comms `riderId` from the validated session as the principal; do not add a second password database or copy tokens into URLs.
- Add a server-side Social pilot entitlement for the **one explicitly authorised riderId** initially, with admin-controlled expansion later. Apply this gate to *every Social read and write endpoint* and media signing, not only to client navigation.
- Return `403 social_beta_not_enabled` for unentitled Rider Comms accounts, without exposing the pilot riderId. Never treat CORS, local storage, URL obscurity or a browser build variable as access control.
- Provide `GET /social/bootstrap` for the Social client to retrieve approved features, policy version, age/privacy eligibility, entitlements, limits and account restrictions. Validate entitlement again on every action.
- Enforce rate limits and monitor access failures without recording passwords, session tokens or private message bodies.

### 2. Safe personal media testing

The first test release should support **private / Only me posts** and deletion for the pilot rider, not universal public publishing.

Proposed versioned flow:

1. `POST /social/media/uploads` with content type, byte size and checksum: validates pilot entitlement, account state, age eligibility, quotas and allowed MIME. Returns short-lived, single-object upload authorization with exact size/type restrictions. Never issue an upload for another riderId.
2. Upload to a private object-storage bucket; confirm on `POST /social/media/{mediaId}/complete`. Ignore client-reported “safe” flags and untrusted EXIF; check actual file signatures, malware/unsafe content, video rights, duration and metadata.
3. Transcode supported video to a tested mobile-safe format, generate a cover and strip sensitive EXIF/GPS metadata. Keep media non-public while processing. Failure states must be actionable and recoverable.
4. `POST /social/posts` references only the requesting user's **ready** media, accepted policy version, validated caption, audience `only_me`, and idempotency key. No arbitrary direct CDN URL or impersonated author ID.
5. `GET /social/posts/mine` lists only the authenticated author's posts. `GET /social/media/{id}/playback` gives an appropriately short-lived, viewer-authorised URL. No indexing, broad cache or discovery leaks for private media.
6. `DELETE /social/posts/{id}` revokes delivery, invalidates CDN access, deletes content and derivatives according to documented retention/legal-hold rules and provides a user-visible deletion result.

Once reports, moderation, privacy, minors' protections and legal requirements are genuinely deployed and audited, broaden audience options in separately controlled stages. **Do not bypass moderation just because the first account is a developer.**

### 3. Trust, privacy and company protections

- Server-side blocks and audience checks apply to all Social posts, comments, DMs, clubs and events; Social must never infer or publish precise Rider Comms ride data or live location.
- Human-reviewed abuse report/appeal decisions with reversible actions and audit logs; content availability must reflect removal or suspension immediately across CDN, search and caching.
- Real account export/deletion includes Social media, thumbnails, comments, reports, revocation and processors as legally appropriate. Define backup retention and incident escalation.
- Publish verified company/controller contact, Social terms, privacy notice, copyright procedure, reporting/appeal policy, creator/merchant agreements before enabling public UGC or monetisation.
- Keep 16–17-year-old protections and UK child/illegal content obligations under review; a UI checkbox is not authoritative age assurance.

### 4. Creator and business monetisation — no pretend balances

Creators need trustworthy views, qualified revenue events, commissions, gross/net calculation, pending and settled amounts, payout eligibility, payment provider onboarding, tax/KYC where required, clawback/refund and an auditable ledger. Merchant listings require verification, inventory, secure checkout, refund/returns and consumer-law disclosures.

**None of these should be simulated as earned money in a signed-in account.** Develop creator analytics UX against explicit fake fixtures only; enable actual balances and cash-out only after backend and payment/legal review.

## Security requirements for the Social client

- Auth sessions are valid only after `GET /auth/me` returns a username-bearing full Rider Comms account. Clear credentials on signed-in 401; never retry an invalid bearer automatically or log credentials.
- Native session token: Expo SecureStore/Keychain/Keystore. Web: memory and tab sessionStorage, with HTTPS, hashed-script CSP, no-referrer, anti-framing and a restricted API `connect-src`.
- Local draft profiles, garages and text drafts are keyed by authenticated riderId. Never migrate legacy unscoped private drafts between users. Settings offers explicit deletion; deletion must wait for in-flight writes.
- Mobile browser screenshots and synthetic test fixtures cannot prove native device-safe keychain behaviour, actual iOS Dynamic Island geometry, or backend privacy guarantees.
- Production media permissions require explicit user action. No background GPS, contact harvesting or passive route upload.

## Release checklist

- [x] Shared Rider Comms login; guest rejection and session expiry handling
- [x] Production excludes fictional content and fake commerce
- [x] Web preview security headers and explicit device-draft controls
- [ ] Server-side **single-rider beta entitlement** — blocks unrelated Rider Comms accounts
- [ ] Genuine secure media upload, private playback, post list and delete
- [ ] Moderation, media handling, privacy, legal and age-review sign-off for public posting
- [ ] Real iPhone/Android/PWA security and camera tests; exact-head Social and root CI
- [ ] Creator monetisation backend, payments, contracts and independently verified ledgers

**This is a build handover, not a claim that the missing services exist.**
