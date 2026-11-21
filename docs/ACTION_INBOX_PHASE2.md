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

## Frontend integration after Phase 1

Once Operations Hub PR #573 is merged, add `Action inbox` to its grouped navigation only for `moderate` staff. Show separate Source/Status/Age/Assigned columns in a readable desktop list and stacked rows on iPhone. Each row links into existing `#moderation` views and then evolves into an entity-specific detail panel. New case types (support tickets, appeals) must have their own server-side access model, durable schema, assignment semantics and tests before appearing here.

## Follow-up engineering

- Cursor pagination and accurate per-source counts in Postgres.
- Atomic claim, assignment and audit for Social post moderation.
- New support-case schema with case status, priority, assignee and immutable history.
- Event freshness and age-based SLA indicators backed by actual timestamps.
- Case links to Rider 360 based on least-privilege access.
- API and UI validation using Playwright across iOS WebKit, mobile Chromium and desktop.

This PR is **backend-first and draft**; do not merge solely because the existing Phase 1 tests pass.
