# Operations Hub — staff case handovers and UI refinement

## Status
Draft follow-up to merged PR #575. This increment uses the existing audited report-assignment endpoint and does not add new moderation powers, support tickets, billing features or production release controls.

## Staff handover workflow

- Open an **open** rider safety report in Moderation.
- Administrators (the server grants `manage_staff`) see **Assign to team member** in addition to the existing self-assignment and takeover controls.
- The button loads `GET /admin/staff` **on demand**, rather than at initial dashboard load. It shows only administrators and moderators as handover options, omits the current report owner, and does not display staff email addresses or account metadata.
- Select a colleague and write a required audit note. The handover sends `POST /moderation/reports/{reportId}/assign` with the selected staff rider ID and audit note.
- The existing backend rechecks actor permission, recent reauthentication, recipient eligibility and report status, serialises the ownership change, and appends an immutable event. UI role checks are only a convenience.
- A clear cancel action closes the inline panel, restores the trigger's keyboard focus, and makes no request. Failed staff loading or a rejected assignment is reported without guessing a successful state.
- Stale staff responses are ignored if navigation removes the report card before the request returns.
- Moderators retain their pre-existing ability to self-assign and release their own reports but have no access to the administrator-only team picker.

## Design details

The handover panel uses Rider Comms' existing surface, border, spacing and typography tokens. It sits beside the existing moderation actions without a nested modal, expands into accessible full-width controls on narrow phones, and supports keyboard navigation. The selection is intentionally explicit, with no automatic reassignment when a person is chosen.

## Acceptance and safety

- Keep `#575`'s durable owner versus 30-minute quick-claim distinction and its existing assignment history.
- Preserve notes, recent password reauthentication, audit events and server-side role checks.
- Never display private report contents or staff emails in the Action Inbox.
- Verify administrator handover, disabled submit before selection, moderator navigation restrictions, safe cancel/focus and updated ownership history.
- Run exact-head lint, unit/backend and desktop/mobile/tablet/WebKit Playwright CI before merge.
- No deployment and no automatic merge of this draft.

## Later work

True cursor pagination and complete case counts, durable Social-post case ownership, formal appeal intake and independent appeal review, notifications and SLA automation, a real support ticket system, and provider-verified billing administration remain separate projects requiring dedicated backend design, explicit permission models and tests. None is represented as already available.
