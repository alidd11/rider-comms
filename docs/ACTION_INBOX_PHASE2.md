# Phase 2: action inbox (initial backend slice)

This draft adds an **actual staff work-queue API** using sources already available to the Rider Comms backend. It does not introduce fake support cases or expose user private conversations.

## Endpoint

`GET /admin/action-inbox?type=all&limit=25`

- Access: staff with the server-side `moderate` permission (currently admins and moderators). Support and analysts are denied.
- `type`: `all`, `rider_report`, `social_post`.
- `limit`: 1–50.
- Returns `generatedAt`, `items`, `filter`, `limit`, `mayHaveMore`, `sourceSampleLimit`.
- Rider report entries include report ID, reported rider, reason, claim owner and number of reports against the rider.
- Hidden Social post entries include post ID, author rider, kind, number of reports, report reasons and when the post was hidden.
- **No report details, Social captions, private DMs, email addresses or precise ride location** appear in this summary.
- Results are sorted by the earliest waiting timestamp **within the bounded sample** of up to 100 entries per source. `mayHaveMore` is conservative and **is not an exact queue count**. This is an initial slice, not cursor pagination.

Use the existing moderation endpoints for actual decisions; their note, recent reauthentication, atomic report claim and audit requirements remain in force.

## Staff frontend in this draft

The existing `docs/admin.html` app now includes an **Action inbox** section for roles with `moderate` access. It offers all-work, rider-report and Social-post filters, readable mobile cards, waiting-time and existing claim-owner labels, and buttons that open the matching report/post in the established Moderation page. There are no direct decision buttons in the inbox: the existing notes, claim constraints, reauthentication and audit remain authoritative. The inbox retains its filter controls while data refreshes, ignores outdated responses, and gives keyboard focus to the selected moderation record. All content is rendered as text instead of injecting server-supplied HTML.

**Phase 1 integration:** PR #573 is merged. The Phase 2 branch now preserves its grouped Operations Hub navigation, global command search, role-aware sections and Rider 360 while placing Action inbox under **Trust & safety**. Full CI, mobile browser testing and accessibility checks must pass on the combined merge commit before considering PR #574 for merging. New case types (support tickets, appeals) still require their own backend access model, durable schema, assignment semantics and tests.

## Follow-up engineering

- Cursor pagination and accurate per-source counts in Postgres.
- Atomic claim, assignment and audit for Social post moderation.
- New support-case schema with case status, priority, assignee and immutable history.
- Event freshness and age-based SLA indicators backed by actual timestamps.
- Case links to Rider 360 based on least-privilege access.
- API and UI validation using Playwright across iOS WebKit, mobile Chromium and desktop.

This PR is **backend-first and draft**; do not merge solely because the existing Phase 1 tests pass.
