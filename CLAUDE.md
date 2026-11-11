# Rider Comms: notes for coding agents

## Keep GitHub Actions runtime low

Every push to a PR starts CI again. `native-builds` (iOS on macOS plus
Android, about 35 minutes) runs whenever `mobile/**`, `shared/**`,
`package-lock.json` or that workflow changes; `CI` (about 13 minutes) runs on
every PR push and again on `main` after each merge. Lessons from earlier PRs:

- **Push once per round, not once per fix.** Commit locally and push when the
  round of work is finished and checked. Several pushes in a row each start a
  full run (superseded runs are cancelled, but the minutes already spent are
  not returned).
- **Run the checks locally first**, so CI confirms rather than discovers:
  - `npm run lint`
  - `npm test` (needs Postgres: `service postgresql start`)
  - `npm run test:jest --workspace=mobile` and `npx tsc --noEmit -p mobile`
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
