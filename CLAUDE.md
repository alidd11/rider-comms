# Rider Comms: notes for coding agents

## Keep GitHub Actions runtime low

Every push to a PR starts CI again. `native-builds` (iOS on macOS plus
Android, about 35 minutes) runs whenever `mobile/**`, `shared/**`,
`package-lock.json` or that workflow changes; `CI` (parallel jobs, about 7 minutes) runs on
every PR push and again on `main` after each merge. Lessons from earlier PRs:

- **Push once per round, not once per fix.** Commit locally and push when the
  round of work is finished and checked. Several pushes in a row each start a
  full run (superseded runs are cancelled, but the minutes already spent are
  not returned).
- **Run the checks locally first**, so CI confirms rather than discovers:
  - `npm run lint`
  - `npm test` with the database, or 30 backend tests skip without saying so:
    `service postgresql start`, then
    `DATABASE_URL=postgres://postgres:postgres@localhost:5432/rider_comms_test npm test`
  - `npm run test:jest --workspace=mobile` and `npx tsc --noEmit -p mobile`
  - `npm run test:coverage` (with `DATABASE_URL` set) when you add code: CI
    fails any package under 99% line coverage, and a new component without
    tests for its gestures or error paths drops the native Jest figure below it
  - after web changes: `npm run build:pwa-app && npm run build:web`, then
    `npx playwright test` for the affected spec files and a couple of projects
- **Keep native and web work apart when it's cheap to.** A PR that touches
  only `docs/`, `backend/` or `tests/` skips the 35-minute native run.
- **Don't push to a PR while its native run is still going** unless the push
  fixes that run; queue the change locally and push it with the next round.
- **Maestro flows can't run here**, so read them twice before pushing:
  - Wait for each screen before tapping it (`extendedWaitUntil`).
  - Wrap taps that iOS has dropped in a `retry`.
  - Match iOS labels with `(,.*)?`, because iOS appends text to labels.
  - Change a flow only together with the screen change that needs it.
- **Look before re-running.** Read the failing job's log first; re-run only
  for an infrastructure failure (runner lost, artifact upload outage), and at
  most once.
- **Stacked work waits locally.** When a follow-up PR depends on one still in
  CI, keep it on a local branch and push after the first PR merges.

The repository is public, so GitHub doesn't bill these minutes; the reason
is turnaround: a red native run costs the better part of an hour.

## Rider Social (`social/`)

A separate Expo app (`social/mobile`, its own `package.json` and lockfile,
not a root workspace) on the same Rider Comms accounts. Its backend is
`backend/src/socialPostStore.ts`, `socialMediaProcessor.ts`,
`socialMediaService.ts` and `routes/socialPosts.ts`; see
`backend/SOCIAL_PILOT.md`. It deploys as its own Railway web service.

- **Checks** (the `Social app checks` workflow runs them on `social/**`):
  from `social/mobile`, `npm ci`, `npm run typecheck`, `npm test`, then
  `EXPO_PUBLIC_SOCIAL_TEST_FIXTURES=true npm run build:web` and
  `npx playwright test`, then the production build
  (`EXPO_PUBLIC_SOCIAL_TEST_FIXTURES=false`) and
  `npx playwright test --config=playwright.production.config.mjs`. Locally,
  point both configs at `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`
  (its Playwright pins a different browser build); WebKit runs only in CI.
- **The server decides what Social can do.** `/social/bootstrap` reports
  each capability; the app never assumes one, and the capabilities turn on
  only when private media storage is configured.
- **Media never reaches storage as uploaded.** Every photo and video is
  re-encoded on the server (sharp, ffmpeg-static), which strips location
  data; files are served only through per-viewer signed links that re-check
  the post's visibility. Keep it that way.
- **Moderation decisions need a note** and go in `moderation_actions`, like
  the rest of the staff dashboard.
- **Ride safety still applies:** nothing in Social is reachable from the
  Rider Comms map while the rider is moving.

## One look for both apps

Colours live in `shared/src/brandPalette.json`; the logo, radii and sign-in
words in `shared/src/brand.ts`. Native reads them directly, Social's
`styles.ts` derives its colours from them, and `npm run build:pwa-app`
writes the web's colour block at the top of `docs/app.css` (lint fails if
it's stale). Change the look there, not in each app.
