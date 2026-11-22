# Security Phase 2 — implementation and release gates

Status: IN PROGRESS; this is not a penetration-test certificate or release approval.
Parent: https://github.com/alidd11/rider-comms/pull/562.
Work in this branch is isolated from Maps #572, Tolls #566 and Staff PWA #578.

## 1. Session and sensitive-action hardening

A correct password alone must not reauthenticate a bearer session that was revoked, expired, or belongs to another account. The database update must prove that the same account's session is still live before reporting step-up success. Isolated PostgreSQL regressions cover that boundary, the 15-minute password confirmation window, identity isolation, no-store exports, and denial of deletion/export on stale proof.

ACCOUNT_SENSITIVE_REAUTH_ENFORCED is off by default. Tests enable it temporarily with disposable accounts. Do not turn it on in Railway yet.

### Release gate for enforcement

1. Test compatible PWA, iOS and Android clients on real devices: cancelled prompts, incorrect password, session revocation mid-prompt, timeout, connectivity failure and the 401-versus-403 distinction.
2. Implement an accessible, user-visible account-data export action on both PWA and native, protected by password confirmation, without leaking the export into analytics, debug logs or caches. Plan recovery for older installed app versions.
3. Validate account deletion accessibility and app-store requirements; agree a staged compatibility and rollback policy.
4. Obtain explicit owner approval to enable the flag, verify the deployed backend configuration and retest. Green CI alone is not proof that production currently enforces step-up.

## 2. Staff PWA review (owned by draft #578)

Review fresh server-side staff role and permission checks after demotion or suspension, login failure limits, token issuance, logout and revocation, staff password step-up, bearer-token theft risk when stored in browser localStorage, independent service-worker scope, public shell-only caching, actual CSP/anti-framing headers, and physical-device installation. A CSP meta tag cannot enforce frame-ancestors. Do not release #578 on the strength of this document.

## 3. Independent encrypted backups (configuration required)

Railway reported a successful database cron and scratch-restore verification on 22 November 2026, but the GitHub off-provider backup failed:
https://github.com/alidd11/rider-comms/actions/runs/45017449585

The GitHub Action deliberately fails if either of the required Actions secrets is absent:
- PRODUCTION_DATABASE_URL: an external TLS-only database URL, preferably a least-privilege read-only role;
- BACKUP_AGE_RECIPIENT: an age public encryption recipient. Keep the matching private key in an independent secured vault, never in GitHub or Railway.

Follow BACKUP_RESTORE.md. The infrastructure owner must configure both secrets without posting credentials in tickets, rerun the encrypted backup and verify the artifact, then independently decrypt and restore a copy. A Railway restore alone does not prove off-provider disaster recovery.

## 4. Broader security architecture and release testing

- Browser bearer tokens in localStorage/sessionStorage: plan a compatible server-mediated HttpOnly-cookie/BFF design with CSRF protection, while retaining native bearer support.
- The PWA uses Google Maps-compatible unsafe-eval; validate actual hosted HTTP CSP, headers and third-party script trust on supported devices.
- Maps #572: preserve opaque-origin iframe sandbox, but bundle/self-host MapLibre or pin asset integrity, including direct top-level load review.
- Audit actual dependency advisories and upgrade with regression evidence.
- Run authenticated dynamic testing against an isolated backend plus disposable Postgres, never invasive production tests. Passive ZAP is not a full pen test.

## Evidence and ownership

Each change requires green exact-head CI, Social, native and isolated security checks, plus review of any runtime configuration implications. Report residual risk. Do not merge, deploy, enable enforcement or change other agents' branches without owner approval.
