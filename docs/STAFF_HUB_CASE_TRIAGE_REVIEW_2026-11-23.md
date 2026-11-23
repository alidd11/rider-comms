# Staff Operations Hub — Case Desk triage refinement
**Date:** 23 November 2026  
**Base:** main after #585, `757cfa4060e97cbef1b4c81dabedd271117201cd`  
**Scope:** Staff PWA and /admin.html share one JS/CSS implementation.

## Review and rationale
The screenshot-reviewed #585 redesign made the active Case Desk compact, but case items with a persisted `dueAt` did not visibly distinguish an overdue internal follow-up from a future target. This makes manual triage harder when the queue is sorted by last update rather than urgency. In addition, the “loaded cases updated in this period” note was computed once from the first page, becoming stale when staff selected “Load older cases.”

## Implemented
- Show a restrained, text-labelled **Internal target overdue** chip and inset indicator on unresolved cases with a valid past `dueAt`. Resolved and closed cases are not marked overdue.
- Repeat the overdue distinction in Case Details while retaining the precise stored timestamp.
- Keep pagination ordering unchanged; describe the queue as latest-update order, *not* priority order.
- Recalculate the loaded-sample and period note when older pages are appended; do not imply the returned sample represents all cases.
- Add Playwright coverage of overdue, future, resolved and paginated behaviour.

## Explicit limits
This is a **manual internal follow-up target**, not a customer-facing response SLA, an automatic escalation or a legal/privacy deadline. The badge is derived only from a persisted per-case target and its active status; it does not query any disconnected system.

No backend routes, migrations, authorisation scopes, sensitive rider content, Maps/Tolls features, payment integrations or release flags are modified.

## Gates
- Exact-head CI and isolated security staging.
- Real Playwright-rendered Staff PWA screenshots across desktop Chromium, mobile Chromium and emulated iPhone WebKit dark. In addition to the normal full-page navigation capture, capture the **actual overdue case state** for all three targets.
- Verify /admin.html and /staff/ parity; physical installed PWA and authenticated live staff sessions remain unverified without actual testing.
- Keep PR draft; no merge or deployment without owner approval.

## CI failure diagnosis and correction — 23 November 2026

The first exact-head CI run #45091999540 failed during Playwright visual audit with 8 failures, 986 passes. All failures were confined to new overdue-target checks and screenshot fixtures:
- A non-null `dueAt` returned as an ISO string caused `new Date(item.dueAt - timezoneOffset).toISOString()` to throw a `RangeError` in Case Details, because subtracting an offset directly from a string produces `NaN`. We now parse the timestamp first and guard invalid timestamps, retaining support for numeric epoch dates.
- Dedicated `/staff/` overdue screenshots seeded the ordinary Rider Comms session, not `rider-comms-staff-session-v1`, leaving the standalone PWA on the sign-in form. The fixture now uses the same staff-session setup as the 36 existing visual captures.

The existing tests were strengthened, not skipped or relaxed. Re-run exact-head CI/security and inspect the actual overdue screenshots before requesting merge approval.
