# Action Inbox — triage UX increment

## Scope
Follow-up to merged PR #576. This increment introduces a compact, row-based view of the existing staff Action Inbox, with sample-scoped permanent-owner filters. It does not change the moderation database, the role model, or the decision endpoints.

## Experience
- Staff can filter the existing backend Action Inbox by source: All work, Rider reports, and Social posts.
- When the source contains rider reports, a second segmented filter offers **All owners**, **Assigned to me**, and **Unassigned**. It checks `assignedTo`, **never** the 30-minute `claimedBy` quick-claim.
- Social posts are excluded from owner-specific views because no durable ownership exists for those reports. Choosing the Social posts source resets the owner filter to All owners.
- The screen shows **X of Y returned items** and preserves the existing bounded-snapshot note. This is **not** a global queue count or a statement that no other work exists.
- When there are no matches within the returned sample, the UI explicitly says so instead of saying the queue is empty.
- Work items are presented in one scannable, responsive list with subtle separators and consistent keyboard focus; all existing actions still open an exact-ID moderation record so the backend verifies its current state before permitting a decision.

## Safeguards
- No frontend ability to bypass staff roles, reauthentication, ownership eligibility, or audit logging.
- No new user information or hidden report details are included in the inbox list.
- Filters do not promise cursor pagination, global counts, SLA priority or Social-post ownership.
- A stale response cannot replace a later source/owner selection; the existing render-generation guard remains.
- Browser tests cover ownership choices, selected-state focus, zero-match accuracy and resetting the owner view when opening Social posts.

## Release
This PR remains a draft until exact-head CI and isolated security staging succeed on desktop, small phones, tablets and WebKit; it does not deploy until merged into main and the Pages job succeeds.

## Subsequent scope, separate approval
True cursor pagination, backend-native staff workload queries, cross-Social ownership, appeals intake, service-level reminders and complete operational metrics require explicit backend design and role-based tests, not extrapolation from the current 50-item snapshot.
