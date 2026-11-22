# Rider Comms — Company Operations Hub blueprint

**Research and implementation baseline:** 22 November 2026  
**Scope:** Rider Comms mobile/PWA, Rider Social, shared backend, staff/admin operations.  
**Status:** A staged, permission-gated company control plane. Do not confuse the presence of a navigation card with a live business system.

## Product mandate

Rider Comms is the mobility and community app, with PWA and native clients that must retain behavioural parity. Rider Social is a separate social product using the same Rider Comms identity. The Operations Hub is the internal operating console for authorised employees, not an end-user feature, a second identity provider, or a place to expose private ride locations.

The hierarchy should be:

1. **Company command centre** — trustworthy cross-product pulse, snapshot time, alerts and work requiring action.
2. **Rider Comms** — accounts, verification, usage, group rides, communications, hazards and navigation quality.
3. **Rider Social** — social content, moderation, growth, communities, creators and content policy, but only as APIs and recordkeeping actually become available.
4. **Trust & Safety** — report intake, assignment, evidence, policy action, appeals and durable audit trails.
5. **Customer Operations** — support conversations, incident priority, ticket owner, handover, response SLAs and escalation to safety or engineering.
6. **Commercial & Finance** — subscriptions, gross/net revenue, refunds, chargebacks, provider payouts, reconciliations and payment exceptions. Never derive booked revenue from unverified client-side billing state.
7. **People & Access** — least-privilege staff directory, invitation and termination, roles, MFA and privileged-session verification.
8. **Platform & Reliability** — readiness, API rates/errors/duration, voice and mapping provider status, jobs, database, deploy provenance, SLOs and recovery procedures.
9. **Privacy, Legal & Compliance** — SAR/DSAR requests, deletion/export requests, records of decisions, policy documents, risk registers and evidence retention.
10. **Executive Analytics** — data dictionary, explicit time windows, acquisition/activation/retention cohorts, product funnels and cost/performance trends. Company-only financial data must have a separately authorised source.

## Current repository inventory (verified in code, not hypothetical)

| Domain | Verified current capability | Limitation / implementation boundary |
| --- | --- | --- |
| Company overview | GET /admin/overview returns signups, riders, active riders, live rides, community aggregates, hazards, moderation, funnel and daily series | Snapshot-based; no payment, support SLA or Rider Social audience totals in this endpoint |
| Rider support | Rider lookup, per-account detail, verify-email / reset-password / session revocation and data export | No end-to-end staff support ticket queue, response SLA or customer correspondence workflow represented by current dashboard |
| Safety | Moderation report and hidden Social post queues, action inbox, assignment history and staff audit actions | Appeals, evidence handling and review SLAs require explicit backend contracts |
| Staff | admin, moderator, support, analyst roles and permissions; privileged changes use a recent password recheck | Privileged MFA / passkeys, device trust, delegated approval and access reviews require further design and backend work |
| Platform | /health, /ready, /admin/system, /admin/metrics, runbooks | Per-replica metrics are not whole-service SLOs or guaranteed availability figures |
| Finance | Rider billing endpoints, app store and Google verification exist in the wider backend | No reconciled company financial report. Do not invent revenue, MRR, ARPU, costs or churn |
| Social | Posts, media, feeds and moderation are in the backend; shared rider identity | No validated separate Social DAU/MAU, content funnel, creator payouts or commercial settlement reporting here |

### Immediate shipped-in-PR design pass

- **Mobile masthead:** truly fixed below the iOS safe area, with a matching layout offset and scroll padding so it stays visible on longer pages without covering focus targets.
- **Drawer:** branded header, clearly labelled Close navigation action, keyboard focus loop wholly inside the visible panel and focus returned to the original menu toggle on close. Respect reduced motion.
- **Company pulse and product portfolio:** live data comes from the existing server-authorised overview snapshot; no client-side fabricated figures. Navigation goes only to role-authorised existing workflows. Commercial/finance is labelled not connected.
- **Responsive editorial hierarchy:** one-column operations cards on mobile; denser KPI summaries; readable charts and tables with scroll affordances.
- **Staff onboarding:** concise explanations of the app's purposes and role-based access with no new identity provider.
- **Regression tests:** mobile fixed masthead and drawer focus, staff-role filtering, product cards, and finance-unavailable state.

## Design research and standards

- [Shopify admin 2026 redesign](https://www.shopify.com/blog/admin-new-look) — complex product navigation should prioritise finding the right work and preserving context.
- [Shopify Home](https://help.shopify.com/en/manual/shopify-admin/shopify-home) — useful operating home pages surface timely alerts, tasks and metrics.
- [Nielsen Norman Group: complex application design](https://www.nngroup.com/articles/complex-application-design/) — progressive disclosure, visual hierarchy and task-centred organisation.
- [NHS Turas: dashboard layout](https://www.turasdesignsystem.nhs.scot/design/data-visualisation/data-dashboards/dashboard-layout/) — group related data and keep filters adjacent to the views they affect.
- [W3C WCAG 2.2: focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) — sticky/fixed headers must not conceal focused controls.
- [OWASP: authorisation cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) — authorise per request, least privilege and denial by default.
- [NCSC: identity and access management](https://www.ncsc.gov.uk/collection/10-steps/identity-and-access-management) — audit privilege and prioritise MFA for administrative access.
- [Grafana dashboard best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/) — use consistent service hierarchies and explicit request/error/duration measurements.
- [Stripe: transaction reporting](https://stripe.com/gb/resources/more/transaction-details-reports) — reconcile deposits, fees, disputes and refunds against transaction-level records.
- [ICO: guide to subject access](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/subject-access-requests/a-guide-to-subject-access/) — staff case records and deadline tracking should support prompt, lawful responses, generally within one month.
- [Ofcom: illegal content duties](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/illegal-content-duties-under-the-online-safety-act) and [child safety duties](https://www.ofcom.org.uk/online-safety/protecting-children/protection-of-children-duties-under-the-online-safety-act) — determine applicability and build evidence-led safety compliance; do not treat a card as legal compliance.

These sources guide design and backlog; they are not a claim that all obligations apply to every Rider Comms feature.

## Delivery stages (do not claim phases complete until exact-head checks and release evidence exist)

### Stage A — shell, IA and trustworthy executive view

- Implement fixed mobile masthead, usable drawer and mobile density across account, moderation, analytics, staff and system views.
- Introduce company pulse and operating-domain navigation using verified existing data.
- Keep staff RBAC server-side and preserve legacy /admin.html and installed /staff/ parity (shared JS/CSS).
- Run visual and accessibility checks across narrow phones, landscape, tablets, WebKit, keyboard and reduced motion.
- Verify the precise PR head in CI and isolated security staging; do not merge or deploy on partial evidence.

### Stage B — operational maturity

- Build a **durable support case domain**: tickets, statuses, source channel, category, priority, owner, notes, audit events, assignments, customer-visible messages and SLA clocks. Separate PII access from general support access.
- Improve **safety queue operations**: explicit per-case ownership, case age, policy rubric, evidence references, appeals and decision review. Keep 4xx/5xx failures and stale pages distinguishable from empty queues.
- Build **staff security**: MFA/passkeys for privileged accounts, role grants/revocations, access review workflow, session/device ledger, confirmed action reauth, audit log append-only controls.
- Instrument **Rider Social lifecycle** separately from shared Rider Comms counts, with correct eligibility, retention and content provenance.

### Stage C — business reporting

- Implement **authorised payment provider integrations** on the backend with scheduled, idempotent ingestion and webhook reconciliation. Avoid putting provider secrets in public GitHub Pages or localStorage.
- Separate gross charges, refunds, fees, taxes (when relevant), recognised revenue, pending payouts and bank settlements; publish as-of timestamps and reconciliation exceptions.
- Add acquisition/activation/retention/DAU/WAU/MAU by product, deduplicating shared identities without conflating use of the two products.
- Add cost, reliability and case workload metrics with time-window filters and data freshness indicators.
- **No finance dashboard turns green just because a mock says it does.** Test with source-backed fixtures and reconciled totals.

### Stage D — compliance and governance

- Privacy rights queue with deadlines, verification status, restricted attachments, export provenance, deletion state and an immutable action trail; validate against applicable ICO rules.
- Online-safety risk registers, review/appeal quality, moderation policy versions and evidence retention with legal advice on applicability.
- Incident hub with severity, commander, timeline, comms, rollback/deploy provenance and post-incident review.
- Documented access approvals, separation of duties, operational runbooks and service ownership.

## API and data contracts before introducing new dashboards

Every new staff domain must define:

- **Access**: staff permission at each API route and row-level/object-level ownership; repeated checks after staff revocation.
- **Provenance**: named data owner, source of truth, upstream service, ingestion/backfill policy, metric definition and calculation period.
- **Time**: UTC storage, source/event versus ingestion time, generatedAt and data-through timestamps, stale thresholds and incomplete periods.
- **Privacy**: minimum fields returned, PII redaction, no private ride location disclosure, bounded paging, access logs and retention rules.
- **Correctness**: idempotent ingestion, retries/partial failures, accounting reconciliation, no number fabricated when upstream is unavailable.
- **UI states**: loading, empty, unavailable, stale, permission denied, offline and failed are distinct, keyboard operable and announced meaningfully.
- **Performance**: cursored server queries, aggregated metrics, explicit limits, no giant payloads or unbounded client-side joins.

## Definition of production-ready

- Exact commit: CI, backend tests, static staff PWA body parity, Chrome/WebKit phone and desktop visual smoke, accessibility smoke, security staging and both native exports green.
- No critical regressions in existing Rider Comms/Rider Social functionality or their parity requirements.
- Role coverage for admin/moderator/support/analyst and nonstaff; revocation tested after an already-loaded page.
- iPhone Safari and added-to-home-screen PWA manually tested for safe areas, sticky header, keyboard focus, install and sign-out.
- No live financial or legal compliance claims without an authoritative server data source and appropriate policy review.
- Deployment sequencing and backend readiness verified separately; branch remains draft until safe for review.
