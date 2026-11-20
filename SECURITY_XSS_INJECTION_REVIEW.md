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

## Merge gates

- [ ] Repository lint, typecheck, Postgres tests and Playwright Chromium/WebKit green at exact PR head.
- [ ] Social TypeScript, browser security/production smoke, native exports and production dependency audit green.
- [ ] Inspect regression screenshots for navigation, messages and social profile.
- [ ] Independent review and staging tests; no automated merge solely on green CI.
