# Rider Comms + Rider Social — XSS and injection security review

Date: 20 November 2026. Security work is consolidated into PR #562.

## Research and security guidance

- [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html): use context-aware encoding and safe DOM text sinks; validate URLs.
- [OWASP SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html): bind values; allowlist query identifiers/sort directions.
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): localStorage and sessionStorage are script-readable.
- [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): check type and signature, bound sizes, decode/re-encode.
- [Google Maps JavaScript API CSP guide](https://developers.google.com/maps/documentation/javascript/content-security-policy): suggests `'unsafe-eval'` and `blob:` for compatibility. Do not remove without live map regression testing.
- [MDN CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP): use nonce/hash-based policies where possible and verify in report-only mode before tightening.

## Controls delivered

1. Preserve the original PR's canonical UUID and 32-hex Social media session ID validation.
2. Make Rider Comms PWA and native API clients reject redirects, omit ambient cookies and avoid caching API responses. Rider Social already applies these safeguards.
3. Allow native external navigation only to the three generated, HTTPS Google Maps, Waze and Apple Maps hosts; reject executable schemes and lookalikes.
4. Add hostile-input regression tests for Rider Comms PWA friend names and DMs, Rider Social profiles, and database-backed Social captions.
5. Assert PWA API request protections in the static security-check script.

## Protections previously present

- User-provided SQL values are parameterised in reviewed backend paths, with dynamic columns and sort order selected from fixed application-defined values.
- PWA templates escape user-generated profile and message strings; React/React Native render text rather than raw HTML.
- API response security headers, restricted CORS, no-store and no-sniff are already present.
- Social media uploads are bounded, signature-validated and re-encoded, served as fixed MIME types under short-lived session-bound HMAC URLs.
- Social's web server has an explicit CSP with inline-script hashes and no unsafe-eval.

## Residual security risks and release gates

- Rider Comms PWA continues to allow `'unsafe-eval'` for Google Maps compatibility. Do not claim CSP mitigation is complete without real-device navigation, search and voice smoke tests.
- Rider Comms web stores persistent tokens in localStorage and Rider Social web stores tab tokens in sessionStorage. A BFF/HttpOnly-cookie migration needs a carefully planned native/web parity transition and CSRF protection; the migration is not performed by this patch.
- Manual and automated staging DAST, parameter fuzzing, deployment response-header verification, malicious media decoder tests, and independent security review remain necessary.
- GitHub dependency alerts and non-blocking npm audit reports need explicit review. CI green does not certify freedom from vulnerabilities.
- Never test live accounts or third-party users with exploit payloads; the new tests use mocked browser APIs and isolated CI PostgreSQL.


## Additional independent research — 21 November 2026 (pre-merge)

Sources: [OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet), [OWASP API Security Top 10](https://api-security.owasp.org/editions/2023/en/0x11-t10/), [Google Maps CSP](https://developers.google.com/maps/documentation/javascript/content-security-policy), [MDN CSP implementation](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/CSP), [MDN Trusted Types](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/require-trusted-types-for).

These are **review targets, not proven vulnerabilities**. Do not introduce unrelated feature changes into this PR.

### Prioritized verification before approval

1. **Inventory DOM execution sinks** in `docs/`, `social/` and shared web rendering: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, HTML-capable markdown, embedded media, dynamic URL assignments and third-party widgets. Trace each untrusted source to its final context; prefer text sinks and URL scheme/host allowlists. Add focused regression tests only for actual reachable paths.
2. **Check authorization independently of injection** for message/conversation IDs, private ride and member locations, social post/media IDs, account sessions, block/report and admin routes. Test cross-account access and mass-assignment/property allowlists with isolated accounts. Passing a SQL-injection test does not establish object-level authorization.
3. **Evaluate strict CSP in report-only staging first.** Google's Maps documentation supports nonce-based `script-src` with `strict-dynamic` and nonce-bearing styles; its example still includes `'unsafe-eval'`. Verify maps, Places search, route previews, navigation and voice in Chromium, WebKit/iOS and Android before changing enforcement. Do not assume a Maps-compatible CSP eliminates all XSS exposure.
4. **Evaluate Trusted Types as defense-in-depth** after inventorying sinks and testing supported browsers. Policies must sanitize or validate, not pass arbitrary strings through; report-only and browser compatibility must be assessed before enforcement.
5. **Review API trust boundaries**: redirect behavior on web/native transports, token-bearing requests, response content types, cache-control, CORS origins, SSRF-capable URL fetches, rate limits, upload MIME/signature validation and response headers on the deployed backend. Native fetch implementations may not enforce browser options identically; verify behavior rather than relying only on mocked option assertions.
6. **Inspect CI evidence and dependency advisories** at the final PR head. Existing green CI confirms tested paths, not full penetration-test coverage. Keep independent security review and staging DAST as release gates.

### Compatibility and scope constraints

- Preserve PWA/native parity, existing authentication, routing, Google Maps/Waze/Apple Maps handoff and voice functionality.
- Never migrate token storage or tighten Maps CSP in this PR without a tested cross-platform rollout and rollback plan.
- Keep exploit probes limited to synthetic fixtures and authorized staging; do not target production users.

## Merge gates

- [ ] Repository lint, typecheck, Postgres tests and Playwright Chromium/WebKit green at exact PR head.
- [ ] Social TypeScript, browser security/production smoke, native exports and production dependency audit green.
- [ ] Inspect regression screenshots for navigation, messages and social profile.
- [ ] Independent review and staging tests; no automated merge solely on green CI.


## Industry security benchmark — OWASP MASVS / ASVS 5.0 (21 November 2026)

This is a **source-based gap assessment**, not an OWASP certification or a completed dynamic penetration test. Use the OWASP Mobile Application Security Verification Standard (MASVS) for the React Native apps, OWASP Application Security Verification Standard 5.0 for the PWA/Social websites and backend, and the OWASP API Security Top 10 for cross-user API boundaries.

Primary standards:
- https://mas.owasp.org/MASVS/
- https://mas.owasp.org/MASVS/07-MASVS-AUTH/
- https://github.com/OWASP/ASVS/blob/master/5.0/en/0x13-V4-API-and-Web-Service.md
- https://cheatsheetseries.owasp.org/cheatsheets/Mobile_Application_Security_Cheat_Sheet.html
- https://mas.owasp.org/MASVS/04-Assessment_and_Certification/

| Control family | Evidence reviewed in this PR | Remaining verification / action |
| --- | --- | --- |
| MASVS-AUTH / ASVS authentication and session management | Backend session-bound media URLs; revocation regression test; clients reject redirects and omit cookies | Test replay, privilege boundaries, expiry, password reset, session invalidation, and step-up authentication for sensitive operations in isolated staging |
| ASVS access control / OWASP API BOLA | Isolated cross-account post deletion and media reuse tests, signed media authorization checks | Build a complete endpoint/role matrix covering DMs, private ride location, groups, friends, account settings, Social clubs and moderation; add missing negative tests |
| MASVS-STORAGE / privacy | Private processed media and no-store media responses; no raw storage credentials returned | Web token exposure in localStorage/sessionStorage is an outstanding XSS impact amplifier; plan a separately tested migration with CSRF protections; verify native Keychain/Keystore use and backup/snapshot leakage |
| MASVS-NETWORK / ASVS communications | HTTPS-only external navigation handoffs; authenticated API clients reject redirects; S3 requests reject redirects | Validate actual native fetch redirect behavior, TLS configuration, backend response headers, HSTS and certificate trust on staging and devices |
| MASVS-PLATFORM / code | Strict navigation host/path checks; URL/deep-link tests | Test iOS Universal Links, Android App Links, exported components, debug flags and device permission behavior on built binaries |
| ASVS input/output validation | Caption XSS/SQL-like input regression tests; upload MIME/size controls; processed media re-encoding | Inventory every HTML sink and server-side query identifier; test malformed JSON, pagination, content types, file metadata, rate limits and upload decoder failures |
| MASVS-CRYPTO | HMAC-SHA256 session-bound media signatures and server-only S3 SigV4 signing | Verify production secret lifecycle, rotation, least-privilege storage credentials and key separation; never commit or log secrets |
| MASVS-RESILIENCE / supply chain | CI and app checks run on PR | Review dependency alerts, release signing, debug symbols, app integrity options and third-party SDK permissions; risk-rank before enabling invasive anti-tamper measures |

### Risk-ranked work remaining
1. **High priority — verify cross-user authorization for private ride locations, DMs, Social posts/media, block relationships and account sessions.** Passing one object test does not cover every endpoint.
2. **High priority — web token storage architecture.** Do not switch to cookies in this PR without a complete BFF, CSRF, session and native/PWA compatibility plan.
3. **High priority — secrets and privacy.** Check production/staging secret management, access logs, location retention, consent revocation and account deletion; use only synthetic data in tests.
4. **Medium priority — native device verification.** Inspect release binaries, platform deep links, permissions, backup behavior and real-device network traffic.
5. **Medium priority — deployed headers and dependency hygiene.** Verify effective CSP, HSTS, CORS, cache policy, dependency advisories and release signing on staging.

**Merge gate:** exact-head CI green and security regressions reviewed; unresolved high-risk issues documented with owners and release-blocking status. A green test suite does not mean the app has passed an independent penetration test.


### Research follow-up: authorization and privacy verification cases

OWASP WSTG API BOLA guidance requires checking authorization for **every object reference and operation**, including list endpoints; MASVS-AUTH requires remote authorization enforcement, and MASVS-PRIVACY calls for assessing actual personal-data collection and sharing:
- https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/12-API_Testing/02-API_Broken_Object_Level_Authorization/
- https://mas.owasp.org/MASVS/07-MASVS-AUTH/
- https://mas.owasp.org/MASVS/12-MASVS-PRIVACY/
- https://cheatsheetseries.owasp.org/cheatsheets/Mobile_Application_Security_Cheat_Sheet.html

Run the following on an **isolated backend with synthetic riders A, B and C**. These are pending test cases, not claims that production is vulnerable.

| Boundary | Positive control | Negative / revocation control |
| --- | --- | --- |
| Private group ride | Consenting active member A reads member B's fresh location | Nonmember C, removed member A, former member after ride end, and member after sharing disabled cannot read B's location or receive it through events/voice |
| Direct messages | A and B exchange messages when authorized | C cannot fetch, delete, mark read, or enumerate their conversation; blocked/unfriended accounts cannot continue forbidden operations |
| Account sessions | A lists/revokes their own device sessions | B cannot revoke A's session by changing an ID; revoked tokens fail across REST, long-poll and media endpoints |
| Social posts/media | Owner can create/delete; authorized viewer reads file | Another user cannot reuse uploads, delete posts or forge media session/expiry/signature; private visibility and blocks rechecked on every read |
| Staff actions | Authorized moderator can perform an allowed action | Ordinary account cannot reach moderator routes via ID substitution, role claims or extra JSON properties |
| Sensitive input | Valid captions, metadata and media are accepted | Oversized, wrong-MIME, polyglot, malformed JSON, unexpected fields and script-like input are rejected or safely treated as data |

For each negative test, assert the HTTP status **and** no unauthorized state mutation or private data disclosure. Re-test after membership/consent/session changes, not only at initial login. Preserve normal legitimate workflows as positive controls. Use separate tests for list, detail, mutation, streaming/event and cached responses. Track any failure to a reproducible isolated fixture before changing production code.

## Isolated security verification after merging the latest main — 21 November 2026

The Railway environment inventory shows only a production Rider Comms backend (with its production database) and a separate Social web preview, **not an isolated staging backend**. No destructive or exploit-oriented testing was performed on the production backend or real rider accounts. The Social preview may use production services, so do not assume it is an isolated security-test target.

Instead, the existing GitHub Actions PostgreSQL and local HTTP test-server workflow is the authorized synthetic-account integration environment. New OWASP WSTG-APIT-02 and WSTG-APIT-04 regressions cover:

- Cross-account device-session listing/revocation, including proving unauthorized attempts do not revoke the token and a permitted revocation does.
- Forged rider/role HTTP headers on administrator endpoints, with a check that denied role grants do not mutate the staff table.
- A three-user direct-message isolation case: unrelated rider cannot read, mark read, enumerate or delete another pair's messages; the authorized recipient can read but cannot delete the sender's message.
- Earlier tests already cover private-ride consent withdrawal, non-member access, blocking and Social private-media authorization.

Source methodology: https://wstg.owasp.org/latest/16-API_Testing/02-API_Broken_Object_Level_Authorization/ and https://wstg.owasp.org/latest/16-API_Testing/04-API_Broken_Function_Level_Authorization/.

**Remaining release gate:** Provision an explicitly isolated backend and Postgres staging environment before conducting external dynamic security testing. A preview frontend or live production backend is not an acceptable substitute. These CI regression tests are not a full penetration test.


## Zero-cost ephemeral security staging — 21 November 2026

The source repository is public. Standard GitHub-hosted Actions runners are free for public repositories under https://docs.github.com/en/actions/concepts/billing-and-usage. No extra Railway service or public staging hostname is being provisioned.

The new \`.github/workflows/security-isolated.yml\` creates a temporary PostgreSQL service and loopback-only copy of the backend on each GitHub PR check, runs unauthenticated HTTP trust-boundary checks and a **passive** OWASP ZAP baseline scan against \`http://127.0.0.1:4186/openapi.json\`, and uploads its scan artifacts for inspection. The server harness requires GitHub Actions and the exact local test database; it refuses Railway credentials or a remote database. No real rider accounts or provider credentials are used. The existing multi-rider DB-backed security regressions cover authenticated authorization; the ZAP scan is passive and not equivalent to authenticated DAST.

This is a free temporary CI test environment, *not* a continuously available staging site, native-device test, or complete external penetration test. Review ZAP warning reports (the baseline ignores warnings for exit status) and verify the actual deployed frontend's CSP and anti-framing HTTP headers independently. Production remains untouched.


## Focused source review — 22 November 2026 (pre-merge)

Reviewed security-sensitive implementation at PR head fdc69a6, with additional synthetic HTTP testing:

- **Identity and authorization:** backend/src/authStore.ts, routes/account.ts, routes/admin.ts and routes/moderation.ts. Persistent bearer sessions are keyed by hashed tokens; session revocation scopes deletion to the owner. Staff permissions are re-read from Postgres, and sensitive role changes require recent password reauthentication. No confirmed privilege escalation identified in these reviewed paths.
- **Messaging, ride locations and blocks:** routes/social.ts, routes/rides.ts, rideStore.ts and moderationStore.ts. Direct-message reads/writes require current friendship and block checks. Ride location requires current membership and explicit opt-in, and GET/POST responses suppress blocked peers. Added backend/tests/privateRidePrivacy.test.ts to verify end-to-end nonmember denial, forged rider IDs, bilateral blocking, expulsion, location purge and ride termination.
- **Rider Social media:** routes/socialPosts.ts, socialPostStore.ts, socialMediaService.ts. Signed media links require active sessions and revalidate visibility; create/delete operations bind media and posts to their owner. Existing synthetic tests cover block-driven media access revocation.
- **Web and native:** sample review of HTML sinks in docs/app.js verified escaping for friend cards, direct messages, hideouts, places and route labels. Authenticated fetch options and native navigation URL/path allowlists were reviewed. This sample review does not certify all possible DOM sinks.

**Unresolved release issues:** PWA persistent tokens are script-readable in localStorage; Rider Social web uses sessionStorage; the Maps CSP retains unsafe-eval; passive ZAP covers a local API/OpenAPI surface rather than full authenticated DAST; release-device networking and real deployed web response headers still require verification. Architecture changes to storage/CSP should use a separate, tested cross-platform rollout.

This is an internal source review and synthetic security-test supplement, **not an external audit or certification**. Exact-current-head CI must be green before approval. No production probing or deployment was performed, and PR #562 is not authorized for merging by this review.
