# Uptime monitoring

The backend emails staff about errors while it is running (see `README.md`, "Error alerts"). It can't report its own outage, so `.github/workflows/uptime.yml` checks production from GitHub every 10 minutes. GitHub may delay scheduled runs by a few minutes when it's busy.

| Check | URL | Fails when |
| --- | --- | --- |
| API | `https://backend-production-7fa0.up.railway.app/health` | The backend process isn't serving requests. |
| Database | `https://backend-production-7fa0.up.railway.app/ready` | Postgres is unreachable or migrations haven't applied. |
| Web app | `https://alidd11.github.io/rider-comms/` | GitHub Pages isn't serving the PWA. |

A check counts as down only after three failed attempts 20 seconds apart, so a deploy restart or one dropped request doesn't raise an alarm.

## When something is down
- **GitHub emails you** about the failed run: whoever last changed the workflow's schedule gets scheduled-run failures.
- The workflow opens a **"Production is down"** issue, adds a comment on each later failure, and closes it automatically once every check passes again.

Then:
1. Open the run linked in the issue to see which check failed.
2. **API or Database:** in Railway, open the `rider-comms-backend` project and check the latest `backend` deployment and its logs, then the `Postgres` service. Roll back to the previous deployment if a deploy caused it.
3. **Web app:** check the latest "Deploy PWA" run on GitHub Actions and https://www.githubstatus.com.

You can run the check by hand at any time: Actions, then **Uptime**, then **Run workflow**.

## Limits
- It checks from one place every 10 minutes, so a short blip between runs can go unnoticed.
- It confirms that the API and database answer. It doesn't test voice (LiveKit), email (Resend) or Google Maps; see `OUTAGES.md`.
