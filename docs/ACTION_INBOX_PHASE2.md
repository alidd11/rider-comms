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
- Migration `0062_social_safety_report_link` adds a durable `source_post_id` to the general report. Accepted Social post reports write this ID atomically. Pre-existing pairs are backfilled only where structured prefix, reporter, author, reason and creation timestamp agree. Legacy records of deleted posts cannot all be inferred reliably and require a separate manual legacy-case audit.
- A staff Social post restore/removal atomically changes linked **open** safety cases to `dismissed`/`actioned`, assigns `resolved_at` and `resolved_by`, and clears transient claims. The existing moderation action log retains the reviewed post and the decision note.
- The Action Inbox excludes general safety subreports when the linked Social post is hidden, showing one Social work item instead; the separate Moderation page retains the individual safety reports for authorised investigation.
- Items are sorted by event time **within the bounded sample** of up to 100 entries per source. Rider safety reports are sampled oldest-first, but hidden Social posts are sampled by report count. This view is **not a global age or priority ranking**; `mayHaveMore` is conservative and **not an exact queue count**. This is an initial slice, not cursor pagination.

Use the existing moderation endpoints for actual decisions; their note, recent reauthentication, atomic report claim and audit requirements remain in force.

## Staff frontend in this draft

The existing `docs/admin.html` app now includes an **Action inbox** section for roles with `moderate` access. It offers all-work, rider-report and Social-post filters, readable mobile cards, waiting-time and existing claim-owner labels, and buttons that open the matching report/post in the established Moderation page. There are no direct decision buttons in the inbox: the existing notes, claim constraints, reauthentication and audit remain authoritative. The inbox retains its filter controls while data refreshes, ignores outdated responses, and gives keyboard focus to the selected moderation record. All content is rendered as text instead of injecting server-supplied HTML.

**Phase 1 integration:** PR #573 is merged. The Phase 2 branch now preserves its grouped Operations Hub navigation, global command search, role-aware sections and Rider 360 while placing Action inbox under **Trust & safety**. Full CI, mobile browser testing and accessibility checks must pass on the combined merge commit before considering PR #574 for merging. New case types (support tickets, appeals) still require their own backend access model, durable schema, assignment semantics and tests.

## Case lifecycle design — not yet implemented

The present backend has **open → claimed (30-minute temporary claim) → dismissed/actioned** for rider reports, and **reported → hidden at three distinct reporters → restored/removed** for Social posts. Suspensions can be appealed operationally by unsuspending a rider with a note, but **there is no case entity, appeal submission system, durable assignee, priority/SLA engine or independent appeal reviewer**.

A subsequent separately reviewed increment should introduce a persistent case ID, source reference, case owner and assignment history; explicit `triaged`, `investigating`, `resolved`, `appealed` and `reopened` states; immutable actor/timestamp/reason events; evidence retention and restricted access; and re-review by a different eligible moderator for appeals. Priority must use corroborated severity and urgency, not raw report counts. Concurrent assignments must be atomic and operations must remain idempotent. Affected users should get an appeal route and a decision explanation without exposing reporters.

## False-reporting safeguards and remaining limits

Existing safeguards: one report per account per post, a reporting rate limit, a three-distinct-account auto-hide threshold, human restoration/removal, and reauthenticated/audited moderation. These **do not prevent coordinated false reports by multiple legitimate accounts**. A restored post can be reported again; there is no documented review-based suppression, reporter-trust scoring, appeal intake, or staff conflict-of-interest workflow. Do **not** escalate severity, suspend users or prioritise cases solely by report volume. These controls require a separately scoped policy, schema, tests and review.

## Follow-up engineering

- Cursor pagination and accurate per-source counts in Postgres.
- Atomic claim, assignment and audit for Social post moderation.
- New support-case schema with case status, priority, assignee and immutable history.
- Event freshness and age-based SLA indicators backed by actual timestamps.
- Case links to Rider 360 based on least-privilege access.
- API and UI validation using Playwright across iOS WebKit, mobile Chromium and desktop.

This PR is **backend-first and draft**; do not merge solely because the existing Phase 1 tests pass.
