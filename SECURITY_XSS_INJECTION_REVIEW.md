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
