# Rider Social private testing — security and privacy release gates

**Reviewed:** 13 November 2026. **Scope:** Social-only PR #449. This is an engineering threat model, not a completed penetration test, verified UK GDPR/Online Safety Act assessment, or approval to publish public user content.

## Current reality

The Social web preview at `https://social-web-preview-preview.up.railway.app` is an **internet-accessible website**. It requires a full Rider Comms account validated with `GET /auth/me` and a Social 16+ self-declaration, but **it does not enforce single-tester/invitation-only access**. The presence of only one active tester does not make the service private. CORS allowlisting prevents other *browser origins*, not another authenticated account from using the app. Client-side feature flags and hidden buttons are not access controls.

The live Social web build excludes fictional creators, clubs, posts, Reels, listings, engagement and checkout. The separate CI screenshot export explicitly uses fictional fixtures. The current Rider Comms backend has accounts, profiles, friends, direct messaging, moderation operations and session revocation. It **does not provide a secure Social video/photo post pipeline**, so the composer must not publish public content, and no real user should be told their images/videos were uploaded.

### Verified client controls (not claims about server effectiveness)

- HTTPS-only fixed backend origin; access token travels in the Bearer authorization header, never URLs, screenshots, analytics or console logs.
- `/auth/me` rejects unnamed guest identities and expired sessions; protected 401s clear local credentials rather than retry.
- iOS/Android session token is stored in Expo SecureStore, not AsyncStorage. Web uses memory and sessionStorage per the existing Rider Comms API contract; this remains a **production security gap** (see below).
- On logout, the client attempts server revocation, clears local credentials regardless of result, and warns if server revocation is unconfirmed. A newly issued session that fails identity verification receives a best-effort revocation attempt before local clearance.
- Garage profile drafts and text-only creator drafts use per-Rider-Comms-ID storage keys. Legacy shared-device composer drafts are discarded rather than migrated to a different account.
- The UI does not grant access to public media publication, payments or fake merchants. Client-side editing limits are *not* server-side authorization.
- Automated tests use synthetic accounts, mocked fetch, and never send real credentials or message contents to the production backend.

## P0 Requests for Rider Comms — backend owner

1. **Server-enforced invitation restriction.** Add a staging/beta environment with a server-side allowlist of invited Rider Comms rider IDs (or invitation entitlements). Enforce it on *all* Social APIs, media reads/writes, search, messaging entry points and feed requests. Never hardcode allowed IDs in the web bundle. Keep the normal Rider Comms service and its existing authentication available. Support immediate revocation and audit events.
2. **Harden browser sessions before general availability.** OWASP warns that sessionStorage and localStorage tokens are readable by JavaScript and can be stolen by XSS. Replace JavaScript-accessible long-lived web bearer sessions with a first-party BFF or HttpOnly, Secure, SameSite cookie-based session design, with CSRF protections and well-scoped CORS; coordinate native token design separately. Enforce idle/absolute expiry, token rotation and global logout server-side.
3. **Media backend and isolation.** Authenticated short-lived upload grants tied to account/media/mime/size; private staging storage; actual file signature validation, virus scan, image/video processing, GPS/EXIF stripping, consent and copyright checks, age eligibility, moderation decisions, thumbnails, signed URLs, private audience rules, deletion plus derivative/cache purging and immutable audit trails. Verify access denies another rider's private media.
4. **Moderation and appeals as a real service.** Human-reviewed queues, proportionate enforcement, report abuse detection, creator notices citing rules, accessible appeals, reversals and restored reach after a wrongful decision. Do not allow AI confidence or report volume alone to trigger permanent account sanctions. Require operational SLAs and retained moderation evidence.
5. **Data rights and tenancy.** End-to-end account export, deletion and backup retention schedules for Social content; scoped service privileges; separate public/profile/club permissions; server-side block/mute/privacy checks; no implicit sharing of live location, route history, proximity voice or ride groups with Social.
6. **Policy and age verification.** An assessed UK age-assurance approach (the Social checkbox is only a self-declaration); DPIA and children's risk assessment if applicable; updated privacy notice, terms, community rules, reporting/appeal/copyright routes and consumer rules for future businesses.

## Local Social work remaining before inviting testers

- Review and minimise storage of private garage details, which currently uses AsyncStorage and is **not encrypted at rest**. Avoid license plates, full addresses, VINs, live location or route data in drafts until secure storage and deletion controls are in place.
- Test iPhone Home Screen PWA, native iOS, native Android for token protection, safe-area layout, background/resume handling, permission prompts and sign-out after server failure.
- Add/verify CSP, Referrer-Policy, secure response headers, dependency audit and browser XSS review on the actual Railway-served responses. A client-side meta tag alone cannot replace server headers.
- Ensure fallback identity displays from `/auth/me` are not presented as verified profile attributes when `/riders/{id}/profile` is unavailable.
- Keep the production build empty of fictional content; keep fixtures in CI only. Verify release artifact environment variables before any deployment.

## Verification matrix

| Area | Required test |
| --- | --- |
| Authentication | Correct login, invalid password, 429, account suspension, 401 restore, guest-null-username, expired Terms, account switch |
| Revocation | `/auth/logout` success, 401 already revoked, 500/network unavailable with clear device token and visible warning |
| Account isolation | Rider B must never retrieve Rider A's drafts, private media, direct messages, membership or moderation records |
| Ingestion | Reject oversized, malformed, executable or wrong-mime media; strip photo GPS metadata; check author consent |
| Content safety | Block and report enforcement across PWA/native; appeal reversal must restore content and remove strikes |
| Privacy | Private-by-default, clear sharing consent; no Social use of live ride/location/voice data without explicit authorization |
| Web | CSP, frame protection, no token in referrer/logs, no browser storage of long-lived token on general release |
| Release | Exact-head Social CI, root lint/tests, mobile+desktop screenshots, real iPhone and Android testing; do not call preview production-ready until gates pass |

## Standards and evidence

- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet (explicit warning about browser Web Storage for tokens; server session invalidation)
- OWASP MASVS: https://mas.owasp.org/MASVS/03-Using_the_MASVS/ (authentication, storage, platform, code, network and privacy)
- ICO data protection by design and by default, updated February 2026: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default/
- ICO Children's code: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/introduction-to-the-childrens-code/
- Ofcom protective defaults research, July 2026: https://www.ofcom.org.uk/online-safety/safety-technology/protective-defaults-for-social-media-platforms

**Release verdict:** Private *testing of the existing authenticated, read-only experience* is reasonable after exact-head checks and real-device validation; invite-only access and public media features are **not secured yet**. Those cannot be safely implemented solely in `social/`. No statement about "only one user has access" is technically accurate without server-enforced admission.
