# Rider Comms Operations Hub — professional company-platform programme
**Research date:** 22 November 2026. **Base:** Admin visual/interaction PR #583 (stacked development branch). **Status:** Controlled staged implementation; no unapproved production deployment.

## Executive decision

Build a professional *Rider Comms and Rider Social operations platform*, rather than imitating every feature of Zendesk, Stripe or Intercom. Those products solve different commercial problems. Preserve the current single Staff PWA and server-enforced role system. Every statistic needs a named source, time window and coverage boundary; every state-changing operation needs durable audit evidence and an authorised actor.

Primary user goals:
- **Moderator:** open Action Inbox, identify urgent/repeated abuse, review evidence and decide with mandatory reason; staff never lose case context because of a date filter.
- **Support:** find a rider, handle a case, use verified account tools, and eventually reply on an explicitly enabled customer-facing support channel.
- **Administrator:** resolve escalations, allocate cases by workstream, manage staff roles, inspect incident health and report on trustworthy operational history.
- **Analyst:** inspect numerical platform health without seeing private rider details, moderation reports or customer conversations.

## Research and concrete product lessons

1. **Zendesk: time-aware ticket policy.** SLA policies, reply vs resolution measures, breach alerts and task-based automations are distinct from merely showing a date field. Automations re-check ticket state before acting to avoid stale decisions. Sources:
   - https://support.zendesk.com/hc/en-us/articles/5604663490458-Using-SLA-policies
   - https://support.zendesk.com/hc/en-us/articles/4408832701850-About-automations-and-how-they-work
2. **Intercom: conversation, internal notes and back-office tickets are different data types.** Public replies, colleague collaboration, assignment and case tracking have different permissions and expectations; do not turn existing internal case notes into user-facing messages. Sources:
   - https://www.intercom.com/help/en/articles/8300305-how-to-manage-back-office-tickets-in-the-inbox
   - https://www.intercom.com/help/en/articles/6258745-the-inbox-explained
   - https://www.intercom.com/help/en/articles/13334840-conversation-events-in-the-inbox
3. **Linear: put immediate work first, supporting controls second.** Keyboard search, curated views, predictable action location and an uncluttered command surface improve staff throughput. Source: https://linear.app/now/behind-the-latest-design-refresh
4. **Shopify: responsive operational tables, accessible filtering.** Comparable records should remain scannable, with compact filters attached to the data affected. Source: https://shopify.dev/docs/api/app-home/latest/web-components/layout-and-structure/table
5. **Stripe: money must reconcile to the actual payment ledger.** Do not present invoices, refunds, revenue or payment status from estimated account counts or frontend-only data. Financial reporting must be provider-authoritative and audited. Source: https://docs.stripe.com/dashboard/search
6. **UK ICO: purpose limitation, minimisation, storage limitation.** Customer support messages may include sensitive information. Retention schedules, user rights and access control must be designed before enabling inbound email or customer communication. Sources:
   - https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/data-minimisation/
   - https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/
   - https://ico.org.uk/for-organisations/advice-and-services/audits/data-protection-audit-framework/toolkits/accountability/records-management-and-security

## Existing capabilities verified from main

- Internal work cases (support, appeal, privacy, incident), role-scoped Case Desk, status/priority/assignment edits with row locking, version checks, mandatory notes and append-only events.
- Staff permissions and session reauthentication for sensitive updates. Data is intentionally not cross-team for support/moderation.
- Rider 360, Action Inbox, Social hidden-post moderation, real overview/system snapshots, bounded audit and security-event samples, actual Staff PWA.
- Not connected: customer-facing support messaging, SLA enforcement, automatic routing/escalations, case-level legal request deadlines, provider-authoritative billing/finance totals, complete Social growth analytics.

## Roadmap and acceptance criteria — keep all work in this programme PR until reviewed

### A. Accurate operational reporting (implemented first)
- [x] Exact 7/30-day PostgreSQL aggregates across **all retained internal cases** and their events, independently of Case Desk pagination.
- [x] Backend filters each case kind by the caller's existing staff role, returns only aggregate counts, and rejects unsupported windows.
- [x] Separate Social safety aggregates (posts/photos/Reels, reports, reported posts, hidden now, staff decisions), accessible only to moderation roles.
- [x] Compact, collapsed dashboard views of those reports; operational queues stay usable if optional reports are temporarily unavailable.
- [x] Real database and browser contract regression tests committed, pending exact-head CI.
- [ ] Audit more historical datasets (security events, support outcomes and response measures) after explicit purpose and role review.

### B. Customer support communications (planned; **not live**)
- Separate **public rider support replies** from internal case notes; no reuse of friend direct messages or private ride chat.
- Define an authenticated rider support channel and a corresponding staff-only, scoped conversation thread.
- Sender identity, message direction/visibility, attachment scanning, abuse controls and audit provenance must be explicit.
- Restrict attachments and notification delivery until permissions, retention/erasure and secure media review are complete.
- Test consent, account deletion, blocked riders, staff role change mid-session, stale write conflicts and rate limits.
- **Release gate:** no public message composer until a real end-to-end rider inbox and delivery/retention policy are verified on native and PWA.

### C. Case deadlines and automation (planned; **not active**)
- Define **internal service target** separately from regulatory/legal/privacy deadlines; avoid invented SLA promises.
- Manual targets require an actor, reason, version check, timezone-safe timestamp and same-team access.
- Near-due/overdue counts must use persisted target values; no default due dates.
- Automation rules require idempotency key, persisted execution outcome, explicit ownership, rate limits, failure/retry and audit history.
- Do not automatically suspend, delete user data, send external replies or initiate financial operations from automation.
- Dry-run/beta-gate any new scheduler until safe replay tests and incident procedures exist.

### D. Rider Social operations (partially implemented)
- Source-backed content counts and moderation decisions integrated with existing Social review flows.
- Next: queue outcome measures, trend comparisons, provenance by period, creator/community cohort definitions and authority-safe export.
- No invented active users, engagement, creator revenue or Social subscriber numbers.

### E. Company finance and commercial operations (not connected)
- Provider-verified, read-only finance snapshot endpoint only after approved payment integration.
- Accounting-safe time periods and currency, VAT/taxes/refunds/disputes/fees and reconciliation methodology.
- Explicit "not connected" state until real provider credentials, permission scopes, sandbox fixtures and security review.
- No speculative financial KPI calculated from rider count or price assumptions.

## Reliability and release requirements

- No default workflow actions and no dormant feature accidentally exposed to riders.
- Roles read from the database on every request; no client-only authorisation, no private text in aggregate responses.
- Avoid broadening `/admin/overview` to include data from unlicensed or disconnected sources.
- Verify backend/Postgres tests, exact-head lint/typecheck, security staging and full 30-view Staff PWA screenshot regression.
- Confirm at 320px mobile, iPhone WebKit emulation, desktop; physical installed iPhone and authenticated desktop remain manually unverified unless performed.
- Exclude experimental Maps/Tolls flags and overlapping Security #579 changes; integrate upstream after those PRs merge.
- No automatic merge, release, deployment, paid service, credentials or rider messaging.
