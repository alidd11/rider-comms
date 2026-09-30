# Moderation runbook

Riders can report and block each other from the app. Reports go into a
moderation queue that staff work through the admin API below. Every decision is
written to an audit log in the same database transaction.

## Who can moderate

Moderators are admin accounts. Add a rider ID to `ADMIN_RIDER_IDS` on the
backend and restart it: startup grants `users.is_admin` to the listed IDs.
Removing an ID does **not** revoke an existing grant; demote someone
explicitly with `UPDATE users SET is_admin = false WHERE id = '...'`.

Admin status is re-read from the database on every moderation request.
Moderators can't suspend themselves or another admin.

## The staff dashboard

Open **https://alidd11.github.io/rider-comms/admin.html**. Before that, sign in to the Rider Comms app in the same browser with an admin account; the dashboard reuses that sign-in. The old `moderation.html` address redirects to the dashboard's Moderation tab.

| Tab | What it shows |
| --- | --- |
| **Overview** | Headline numbers and four 30-day charts (see below). Hover a bar for its value, or open **Show table** for all of them. |
| **Riders** | The newest riders, or a search by username, email, display name, handle or rider ID. Shows join date, last activity, friends, reports against the rider and badges (Admin, Suspended, Unverified). |
| **Moderation** | The open queue (oldest first), dismissed and actioned reports, and the audit log. On each report, write a note, then choose **Dismiss** or **Suspend rider**; suspending asks for confirmation. **Unsuspend rider** appears on reports about a currently suspended rider. |
| **System** | Live API and database health checked from your browser, plus links to the runbooks. |

The Overview numbers:

- **Riders:** total, new today, this week and in 30 days, the share with a verified email, and suspended accounts.
- **Engagement:** riders active in the last 24 hours, 7 days and 30 days, and stickiness (daily ÷ monthly active).
- **Live right now:** riders on Nearby, rides in progress and riders in them, and riders with location sharing on.
- **Social:** friendships, messages today and this week, and pending friend requests.
- **Safety and content:** open reports, reports and moderation decisions this week, active hazards, scenic routes and hideouts.
- **Charts** (per UTC day):
  - new signups;
  - active riders;
  - rides started;
  - messages.

  Active riders and rides started are counted from when the dashboard shipped, because the database didn't keep them before: ended rides are deleted, and only each rider's latest activity is stored. Earlier days show as "Not tracked yet".

Everything is computed live from the database when you open or refresh the page. The daily history lives in `daily_metrics`, which holds only a date, a metric name and a number, never rider IDs.

The dashboard is not linked from the app and asks search engines not to index it. It shows riders' text only as plain text, never as HTML. The backend refuses every `/admin` and `/moderation` request from a non-admin account, whatever the page shows.

## The API

The dashboard is a thin layer over these endpoints, which also work directly (for example with `curl`). Two more, `GET /admin/overview` and `GET /admin/riders?q=…&limit=…` (up to 50), serve the Overview and Riders tabs.


All endpoints need an admin session (`Authorization: Bearer <token>` from
`POST /auth/login`). Every write needs a `note` of 1–1000 characters,
explaining the decision for the audit log.

| Endpoint | What it does |
| --- | --- |
| `GET /moderation/reports?status=open&limit=50` | The queue. Open reports come oldest first. Each item includes `reportsAgainstRider` (every report ever filed against that rider) and `reportedRiderSuspended`. `status` can also be `dismissed` or `actioned` (newest first). |
| `POST /moderation/reports/:id/resolve` `{ "resolution": "dismiss", "note": "…" }` | Closes one report as dismissed. |
| `POST /moderation/reports/:id/resolve` `{ "resolution": "suspend", "note": "…" }` | Suspends the reported rider: sign-in is refused, every session is revoked, and they're ejected from any private ride's voice room. Every open report against them is closed as actioned. |
| `POST /moderation/riders/:riderId/unsuspend` `{ "note": "…" }` | Lifts a suspension, for example after an accepted appeal. |
| `GET /moderation/actions?riderId=…&limit=100` | The audit log, newest first, optionally for one rider. |

Errors: `403 admin_required`, `403 forbidden_target` (the target is an admin
or yourself), `404 not_found`, `409 already_resolved` / `not_suspended`, and
`400` for a missing note or invalid input.

Example:

```sh
TOKEN=...   # admin session token
curl -s -H "Authorization: Bearer $TOKEN" "$API/moderation/reports"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"resolution":"suspend","note":"Repeated harassment in DMs, reports r1 and r2."}' \
  "$API/moderation/reports/<report-id>/resolve"
```

## What a suspension does

- Sign-in returns `403 account_suspended`. That's checked only after the
  password matches, so it isn't revealed to anyone without the credentials.
  Both apps show a "suspended, contact support" message.
- All existing sessions are deleted at once, so every API call from the rider
  fails with `401`.
- Public Nearby voice stops at its next authorization renewal, within about a
  minute. Private-ride voice is revoked immediately.
- The rider's data is kept, and their existing friendships and messages
  remain. Because a suspended rider can't sign in, they also can't use in-app
  account deletion. Erasure requests from suspended riders go through support.

## Service levels (set these before launch)

These are proposals for the owner to confirm and publish:

| Report | First response |
| --- | --- |
| Threats of violence, sexual content involving minors, imminent danger | Same day; escalate to law enforcement where the law requires |
| Harassment, unsafe riding behaviour, sexual content | Within 24 hours |
| Spam, other | Within 72 hours |

Check the queue at least daily, and watch the age of the oldest open report.

## Appeals

A suspended rider appeals by contacting the support address shown in the app.
A moderator other than the one who suspended them reviews the appeal and
records the outcome with `unsuspend` (with a note) or by leaving the suspension
in place. Record appeal decisions in the audit log note.

## Still needed before launch

- Named moderators and cover for absences, so the queue is never unowned.
- A monitored support address for appeals and erasure requests.
- A decision on how long resolved reports and audit entries are kept (see
  `RETENTION.md`).
