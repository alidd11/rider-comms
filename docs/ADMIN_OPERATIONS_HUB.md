# Rider Comms Operations Hub — implementation plan

> Status: Phase 1 in draft PR #573. This is a product architecture document, not a claim that future sections are live.

## Design brief

The staff dashboard should be the single operational starting point for Rider Comms and Rider Social. Its visual direction combines Linear's quiet, task-focused navigation with Stripe's searchable records, Intercom's case workflows, PostHog's investigable metrics and Vercel's service observability. Use Rider Comms branding; do not copy vendor assets.

Prioritise **find → understand → act → audit**. Display live capabilities and measured facts; do not add navigation to placeholder dashboards that have no authorised backend implementation.

## Existing backend contracts

| Capability | Existing source | Available now |
| --- | --- | --- |
| Role and permissions | `GET /admin/me`; `backend/src/staffRoles.ts` | Yes |
| Overview | `GET /admin/overview` | Yes |
| Rider lookup and detail | `GET /admin/riders`, `GET /admin/riders/:id` | Yes |
| Rider moderation and safety | `/moderation/reports`, `/moderation/riders/:id/*` | Yes |
| Rider Social moderation | `/moderation/social-posts` | Yes, reported/hidden posts |
| Staff management | `/admin/staff` | Yes, admin-only |
| Audit and security events | `/moderation/actions`, `/admin/security-events` | Yes, role-limited |
| System setup and request metrics | `/admin/system`, `/admin/metrics` | Yes |
| Staff ticket inbox | None confirmed | Requires backend |
| Admin subscriptions and refunds | No admin API confirmed | Requires backend and billing controls |
| Feature-rollout management | No general admin API confirmed | Requires backend and enforcement |
| Rider Social clubs, marketplace and creator operations | No consolidated admin API confirmed | Requires backend |

## Phase 1 — foundation (this PR)

- Group the existing six authorised pages by **Workspace**, **Trust & safety** and **Administration**.
- Add command search with Cmd/Ctrl+K or / to navigate permitted pages and find riders from the existing API. The client suppresses stale results but the backend remains the source of permission enforcement.
- Add a concise operations summary to Overview from the existing snapshot. Do not imply there is a support inbox or system-health feed if those endpoints do not exist.
- Add in-page Rider 360 shortcuts for the record sections the current role can access.
- Keep all existing staff reauthentication, audit notes, and safe action confirmations.
- Maintain responsive mobile drawers, focus management, iOS safe areas, dark/light palettes and accessible states.
- Tests: auth/role gates; search keyboard and stale-response behaviour; mobile layout; full admin axe audit; existing moderation and account workflows.

### Access and data safeguards

The UI is *not* an authorization boundary. New endpoints must call server-enforced staff role permissions and log changes. Never expose precise location histories or private direct messages to generic support/staff roles. Sensitive data export needs explicit reason, recent reauthentication and audit history. Search results should be limited and should avoid caching sensitive data in persistent browser storage.

### Technical boundaries

The current admin frontend lives in `docs/admin.html`, `docs/admin.css` and `docs/admin.js`. Phase 1 preserves this deployment surface and avoids paid dependencies. As the hub grows, extract pure UI components and role-aware services into dedicated modules with explicit tests rather than growing one JavaScript file indefinitely.

## Phase 2 — action inbox and support

Design a real case model (`caseId`, type, status, priority, assignee, timestamps, linked entity, event history). Include atomic claim/assignment, pagination, saved views, notifications, role checks, deadlines and immutable audit events. Moderation actions and support cases should share a workspace but not necessarily identical permissions or evidence visibility.

## Phase 3 — product and platform controls

Implement backend-enforced rollout flags for Rider Comms Maps, navigation avoidance and other experiments. No release switch should enable a feature unless the appropriate server and client safeguards exist. Create read-only operational views for service status, deployment history, API-provider failures and aggregated ride/navigation health before allowing any control actions.

## Phase 4 — subscriptions and analytics

Connect provider-verified entitlement and commercial data to administrative read-only views before considering refunds or overrides. Add retention, activation, support-volume, safety, routing and infrastructure metrics with definitions, freshness indicators and drill-down. Avoid estimating prices or reliability from incomplete data.

## Acceptance gates before any merge

1. All relevant CI checks green on the **exact PR head SHA**.
2. Playwright tests pass on mobile WebKit, mobile Chromium and desktop breakpoints.
3. Keyboard focus, dialog isolation, screen-reader names and contrast reviewed.
4. A moderator, support agent and analyst see only authorised sections and data.
5. Navigation, exports, sanctions and account recovery still work and are audited.
6. No unreleased backend feature is activated, and no third-party subscription is required.

## Reference products

- [Linear](https://linear.app/) — triage, navigation, saved views
- [Stripe](https://stripe.com/) — searchable operational records
- [Intercom](https://www.intercom.com/) — assigned support work and customer context
- [PostHog](https://posthog.com/) — analytics connected to product operations
- [Vercel](https://vercel.com/) — observability and deployment status
