# When a service is down

Rider Comms depends on a few outside services. This page covers, for each
one, what riders notice, what the apps do on their own, and what (if
anything) you should do. Uptime alerts for the backend itself are described
in `UPTIME.md`.

The rule throughout: **a failing extra never takes down the ride.** Maps,
group positions and voice keep working independently wherever possible, and
nothing waits forever on another company's server.

## At a glance

| Service | What it does | If it's down, riders… | Your action |
| --- | --- | --- | --- |
| Railway (backend) | Accounts, rides, positions, Nearby, chat | lose live updates; a connected voice call carries on | Check Railway, see below |
| Railway Postgres | All stored data | same as the backend (`/ready` fails) | Check Railway, see below |
| LiveKit | Voice | get "Voice chat is unavailable right now. Your ride and map still work." | Nothing; the apps retry |
| Google Maps (web app map, directions, place search) | Map tiles in the web app, routes, search | web: offline map / "Could not calculate a route"; search errors | Nothing, unless billing or a key is the cause |
| Resend | Verification and password-reset emails | sign up fine, but the email doesn't arrive | Ask them to tap "Resend verification email" later |
| GitHub Pages | Hosts the web app | can't load the web app (installed copies still open from cache) | Check githubstatus.com |

## Backend or database (Railway)

**Riders notice:**
- **Group ride positions.**
  - Positions stop updating.
  - After about 20 s each rider's marker turns grey (stale).
  - After about 30 s the apps say so. The web app shows "Can't reach Rider Comms. Group positions may be out of date". The iPhone app's ride bar switches from **Live** to **Offline**.
  - When the backend answers again, everything resumes by itself.
- **Voice.** A call that is already connected keeps working, because LiveKit carries it rather than our backend. New calls can't start, since they need a token from us.
- **Sign-in and other actions.** These show "Could not reach Rider Comms. Check your connection and try again."

**Automatic:**
- The uptime check opens a "Production is down" issue and emails you within about 10 minutes (`UPTIME.md`).
- Railway restarts a crashed process.

**You:**
1. Open the Railway project. Check the backend service's deploy and runtime logs, and whether the Postgres service is running.
2. If a deploy caused it, redeploy the previous build from Railway's deployments list.
3. If Postgres is unhealthy or its volume is full, follow `BACKUP_RESTORE.md`.

## Voice (LiveKit)

**Riders notice:**
- Voice won't connect, and they see "Voice chat is unavailable right now. Your ride and map still work."
- The iPhone ride bar shows *Voice unavailable*.

**Automatic:**
- Both apps retry the connection with backoff.
- Blocking a rider or leaving a ride still works. The backend asks LiveKit to remove them, gives up after 5 s if it can't, and logs `ride_voice_revocation_failed` or `proximity_voice_revocation_failed`. Voice tokens are short-lived anyway.

**You:**
- If you use LiveKit Cloud, check status.livekit.io.
- If you self-host (`SELF_HOSTED_VOICE.md`), check that server.
- There's nothing to change in Rider Comms.

## Google Maps, directions and place search

**Riders notice:**
- **Web app map.** If the Maps script can't load, or the key is rejected, the web app falls back to its built-in offline map.
- **iPhone map.** The iPhone app draws Apple Maps, so its map isn't affected.
- **Routes.** Route requests fail and riders see "Could not calculate a route. Try again." Navigation that is already running keeps its current route.
- **Place search.** Search returns an error. The backend gives up on Google after 8 s, inside the apps' own 10–12 s limits, so riders get an answer rather than a hang.

**Automatic:**
- Nothing is cached as a failure, so the next try goes straight to Google again.

**You:**
- Check status.cloud.google.com.
- If only Rider Comms is affected, check the Google Cloud console:
  - billing account active
  - API key restrictions
  - quotas for Directions and Places

## Email (Resend)

**Riders notice:**
- Sign-up and password-reset requests still succeed, but the email doesn't arrive.

**Automatic:**
- The backend gives up on Resend after 5 s, well inside the apps' 10 s limit. Without that, a sign-up could succeed while the app reported a timeout.
- The verification code is stored either way, so a later tap on **Resend verification email** (Settings) works once Resend is back.
- Staff error-alert emails are skipped during the outage. The errors remain in the backend logs.

**You:**
- Check resend-status.com.
- If Resend is fine, check `RESEND_API_KEY` and `RESEND_FROM_EMAIL` on Railway, and that the sending domain is still verified.

## Web app hosting (GitHub Pages)

**Riders notice:**
- A rider who has opened the web app before can still open it, because the service worker serves the cached app.
- A first-time visitor gets GitHub's error page.

**You:**
- Check githubstatus.com.
- The backend and the iPhone app are unaffected.

## Testing this

- **Backend timeouts:**
  - `backend/tests/email.test.ts` covers a Resend request that never answers.
  - The directions and places provider tests cover Google timeouts and errors.
- **Client behaviour:** `mobile/tests-jest/ride/RideContext.test.tsx` covers the **Offline** state (network failures count, 4xx answers don't, and it clears on recovery).
- **By hand:** stop the local backend while riding in the web app. Markers go grey within ~20 s and the notice appears at ~30 s. Restart the backend and "Reconnected. Group positions are live again." appears on the next tick.
