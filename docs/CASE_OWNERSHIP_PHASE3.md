# Operations Hub Phase 3 — Durable safety-report ownership

## Scope

This is a **separate, non-deployed increment** after merged Operations Hub Phases 1 and 2. It adds persistent ownership for *individual rider safety reports*, without introducing a generic case object or changing the Social-post review workflow.

A safety report retains its stable report ID and existing status (`open`, `dismissed`, `actioned`). Its optional `assignedTo` and `assignedAt` fields identify the durable case owner. This is distinct from the existing **30-minute claim**, which is a transient signal that someone is actively handling a report. An assignment is coordination metadata; it is **not an authorisation grant, a moderation decision, a priority score or proof of wrongdoing**.

## API and permissions

- `POST /moderation/reports/{reportId}/assign` requires the existing `moderate` permission, the same recent password reauthentication used for other sensitive moderation actions, and a nonempty note of at most 1,000 characters. `{ "note": "…", "assigneeId": "<rider id>" }` sets an owner; omit `assigneeId` to assign to yourself; send `null` to release.
- Moderators may assign themselves to unassigned cases or release cases they own. They cannot take or change another moderator's assignment. Administrators can reassign an open report to another eligible moderator or administrator, or release its owner.
- The proposed assignee must be an existing active administrator or moderator. Support staff, analysts, suspended users, missing users and non-staff accounts are rejected server-side.
- `GET /moderation/reports/{reportId}/assignment-history?limit=50` returns the last 50 recorded transitions, bounded at 100. It requires `moderate` and includes actor, previous/new assignee, a note and the timestamp. Unauthenticated and non-moderation roles cannot access it.
- The regular report queue, exact case endpoint, and Action Inbox display `assignedTo` using existing role restrictions. The inbox does **not** include private assignment notes or unredacted report details.

## Transaction and migration safety

Migration `0063_safety_report_assignment_history` adds nullable report owner columns and an append-only `safety_report_assignment_events` table. It does **not** backfill invented owners; existing reports start unassigned. The migration and its tracking insert run in the existing database migration transaction. History references the report row and is deleted on report erasure, consistent with account deletion.

Ownership changes lock the prospective staff user before locking the report. Staff-role revocation and downgrade follow the same user-before-report order. They release that person's **open** assignments in the same transaction and append a recorded event. Assignments after report resolution are rejected; the final owner on a closed report remains visible as historical metadata. Concurrent competing claims to own a case produce one success and a conflict or unchanged response, rather than two final owners.

Existing 30-minute claims remain independent from durable ownership. The existing resolution, suspension, reporter protection and staff reauthentication pathways are unchanged.

## UI

The existing Moderation view shows the permanent owner and lets moderators self-assign or release ownership with the audit-note field. Administrators can take over another owner's report. A permission-checked history control shows the latest assignment changes. Action Inbox cards show permanent owner and temporary quick claim separately, rather than falsely treating a time-limited claim as permanent assignment.

## Deliberately not part of this phase

- Persistent generic case entities for Social posts, support tickets or appeals
- Formal appeal intake, independent reviewer assignment, evidence retention changes
- Automatic severity, guilt, or priority scoring from report counts
- Pagination beyond existing bounded source samples, exact queue totals or global oldest-first ranking
- Staff assignment notifications, SLAs and escalation scheduling

Staff ownership metadata is **advisory**. Other moderators can still make decisions under existing permissions, so it must not be represented as exclusive authorisation. Administrative transfers to other specific staff are available through the API; the current UI exposes self-assignment, owner release and administrator takeover.

## Verification gate

Run the exact-head Postgres tests (including staff downgrade/revocation, conflicting assignments and history), API catalogue, web build and desktop/mobile/tablet/WebKit visual tests. Treat green results from prior PRs as historical. Do not merge or deploy without repository owner approval.
