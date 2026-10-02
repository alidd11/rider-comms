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
| **Overview** | Headline cards with change versus the previous period and small trend lines, four daily trend charts, the activation funnel, and community and safety totals. Switch between **7 days** and **30 days** (remembered in your browser). |
| **Riders** | The newest riders, or a search by username, email, display name, handle or rider ID. Shows status (Active, Unverified, Suspended, Admin), join date, last activity, friends and reports against the rider. |
| **Moderation** | The open queue (oldest first), dismissed and actioned reports, and the audit log. The sidebar badge shows how many reports are open. On each report, write a note, then choose **Dismiss** or **Suspend rider**; suspending asks for confirmation. **Unsuspend rider** appears on reports about a currently suspended rider. |
| **System** | Live API and database health checked from your browser, with response times, plus links to the runbooks. |

The headline cards:

- **New riders** and **Messages sent** in the period, with the change versus the period before. Green means up.
- **Open reports**, with the change in reports filed. Here fewer is better, so a fall shows green.
- **Active riders** in the period, and the share of all riders that is.
- **Rides started** in the period.
- **Total riders** (with % verified and suspended), **Live now** (riders on Nearby and rides in progress) and **Stickiness** (daily ÷ monthly active riders, which shows whether people come back).

The trend charts (per UTC day):
- New riders and messages show totals.
- Active riders shows a daily average, because the same rider is counted on every day they ride.
- Rides started shows totals.

Each chart shows the previous period as a dashed grey line and today's incomplete value as a dashed segment. Hover or use the arrow keys to read a day, or choose **View as table**.

The **Activation** funnel follows riders who signed up 7–30 days ago, so everyone in it has had a week to come back:

1. Signed up.
2. Verified their email.
3. Started or joined a group ride, or went live on Nearby.
4. Came back at least 7 days after signing up.

Each step shows its count, its share of sign-ups, and the share of the step before. The biggest drop is where to focus. First rides are counted only from when this shipped, and the card says so while the window still includes earlier sign-ups.

Each report shows where in the app it was filed (for example "From the ride roster" or "From Nearby Voice") as a badge, with any extra details below it.

**Blocked by the content filter this week** (under Community and safety) counts usernames, names, handles, messages and hideout names the server's filter turned away. It's a count only; the rejected text is never stored. Counting started when this shipped.

Active riders and rides started are counted from when the dashboard shipped, because the database didn't keep them before: ended rides are deleted, and only each rider's latest activity is stored. Earlier days are shaded and marked "Not tracked yet".

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
