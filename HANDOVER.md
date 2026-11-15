# Handover: Rider Comms and Rider Social

Written 15 November 2026, around 08:00 UTC, by Claude, the previous lead developer. It is meant for the next developer (ChatGPT) taking over both apps. **Live GitHub state is authoritative.** Before changing anything, re-check `main`, the open PRs, their exact head SHAs and their checks.

This file is the current picture. Older documents are still accurate for their topics:
- `PROJECT_STATUS.md`: a 3 October snapshot; its feature descriptions still hold, but its PR and test counts are out of date.
- `LAUNCH_CHECKLIST.md`: what the owner must do before the store submission.
- `backend/SOCIAL_PILOT.md`: Social's backend contract, switches and media pipeline.
- `social/README.md` and the other `social/*.md` files: Social's product and safety docs.
- `CLAUDE.md`: the rules for working in this repo. Read it first; it applies to you too.

---

## 1. Where things stand right now

### `main`
- `main` is at **c9e1965**: #508, "Rider Social: take over the app".
- It is deployed:
  - **Backend:** Railway at `https://backend-production-7fa0.up.railway.app`. `GET /health` reports the deployed `commit`.
  - **PWA:** GitHub Pages.
- Recent merges, newest first:
  - **#508:** Social takeover; bootstrap accepts the `beta` entitlement; RecentRides test clock pinned.
  - **#490:** backup cron fix.
  - **#489:** rate limiting uses Railway's edge client IP (`X-Real-IP`, with `TRUST_PROXY=true`).
  - **#506, #501, #499, #498:** Social security foundations: playback policy, deletion outbox, private S3 transport, media intake rules.
  - **#505:** search redesign.
  - **#504:** navigation round.
  - **#502, #496, #492:** ride features.
  - **#493:** Social open-beta backend opt-in.

### The one open PR: #510, branch `claude/new-session-677wnl`
**#510 "Rider Social: photo and Reel posting, moderation, and a way in from Rider Comms".** Its description is detailed and current. The head is the last commit pushed in this handover, which includes this file. Three rounds are on the branch:

1. **Posting, end to end**:
   - **Backend:**
     - upload with re-encoding through sharp and ffmpeg-static, which strips GPS and other metadata;
     - posts and feeds (For you, Following = Rider Comms friends, Reels, a rider's own posts);
     - delete, report (3 reports hide a post), block;
     - staff moderation, which needs a note and is written to `moderation_actions`;
     - deletion outbox migration `0055_social_posts`.
   - **Social app:** share a photo or Reel; live feeds and Reels; post options menu.
   - **Rider Comms:**
     - a "Social posts" tab on the staff dashboard (`docs/admin.*`);
     - a "Rider Social · Beta" menu row in the web app and the native app, shown only to riders `/social/bootstrap` admits.
2. **Review fixes, commit 634707d**:
   - **Posting switch:** `SOCIAL_POSTING_ENABLED` (see section 4), off by default.
   - **Session-bound media links:** each link names the signed-in session it was issued to (`s` parameter), and every request checks that session is still signed in. A link lasts 20–30 minutes, and the bytes are cached no longer than that.
   - **Staff links** re-check admin rights on every request.
   - **Upload keys:** before anything is written to storage, the upload's keys are queued for deletion an hour ahead. Saving the record releases them, so no file is left orphaned.
   - **App side:** a photo that fails to load fetches its post again for fresh links, and Reels reload every 15 minutes.
3. **Integration round, commit "Integrate Rider Social with the shared Rider Comms profile"**:
   - **Shared bio** on the Rider Comms profile:
     - migration `0056_rider_profile_bio`;
     - limit `MAX_PROFILE_BIO_LENGTH` = 160 in `shared/src/social.ts`;
     - goes through the content filter and is visible to friends.
   - **Real avatars:** Social draws the rider's Rider Comms avatar from `shared/src/avatars.ts`. It uses `react-native-svg`, and Metro watches `shared/src` (`social/mobile/metro.config.cjs`).
   - **Profile editing:** Social's profile editor saves name, bio and avatar to the account through `PUT /riders/:id/profile`. The old device-only profile is gone.
   - **Real counts:** the first page of a rider's posts carries `total`. The demo "Following" count shows only in the screenshot build. The profile's Reels tab lists the rider's own Reels.
   - **Garage hidden.** `social/mobile/src/garage.ts` and its tests are kept for later.
   - **Copy pass:** removed placeholder and machine-sounding wording. Clubs and Shop are honest "coming soon" screens.
   - **CI paths:** the Social workflow also runs when `shared/src/avatars.ts` or `shared/src/social.ts` change.

#### Why #510 is not merged
- **Owner decision on content scanning.** A comment posted under the owner's GitHub account asked that #510 not be merged as live posting until the following exist:
  - malware and unsafe-content scanning;
  - a separate posting switch (now done);
  - session-bound playback (now done).

  The comment reads like it came from you (ChatGPT): "coordination only; I will not modify Claude-owned files". The owner has **not yet answered** whether scanning is required before posting is switched on.
  - My recommendation: merge #510 with posting off (the default), then build scanning as its own PR before anyone sets `SOCIAL_POSTING_ENABLED=true`.
  - **Confirm with the owner before merging.**
- **CI.**
  - `verify`, `Social app TypeScript / tests / web export` and `android` are green on 634707d. The last push re-runs everything; check it.
  - **`ios` is red everywhere, including `main`.** Since about 03:00 UTC on 15 November, Maestro's iOS driver on GitHub's `macos-26` runner stops responding (`DeviceUnreachableException`, with the XCUITest driver refusing connections). A manual run on `main` (c9e1965, run 43682853447) fails the same way.
    - It is not caused by app code. The last green iOS run was 01:18 UTC on f7698fe, with the same Maestro 2.12.1 and macOS 26.7.2.
    - Possible workaround, as its own PR: in `.github/workflows/native-builds.yml`, when `maestro-ios.xml` reports `DeviceUnreachableException`, restart the simulator and run the flow once more. A real assertion failure must still fail the job.
    - Maestro is installed unpinned (`curl -Ls https://get.maestro.mobile.dev | bash`). Pinning a version is worth considering.
- **Merging, when allowed:**
  - Squash-merge with the `sha` set to the exact head you verified.
  - Then check:
    - Pages "Deploy PWA";
    - CI on `main`;
    - "Social app checks" on `main`;
    - Railway `/health`, whose `commit` should be the new one.

### Closed PRs from the other agent
- **Closed** after review, each with a comment explaining why: #449, #472, #503, #495, #507, #509. Their useful parts are in #508 or #510.
- **Merged:** #498, #499, #501, #506.

---

## 2. Repository map and commands

- **Root workspaces:**
  - `shared/` (TypeScript used by every client);
  - `backend/` (Node 22, Postgres, plain `http` server);
  - `mobile/` (Expo 58, React Native, the native Rider Comms app).
- **`docs/`** is the Rider Comms PWA, deployed by GitHub Pages:
  - Edit `docs/app/*.js`, then run `npm run build:pwa-app` to assemble `docs/app.js`; lint fails if it is stale.
  - Then run `npm run build:web`.
  - `docs/admin.*` is the staff dashboard.
- **`social/mobile/`** is Rider Social: a separate Expo app with its own `package.json` and lockfile. It is not a root workspace.
- **`tests/`** holds the root Playwright web tests (visual and behaviour).

### Checks (from `CLAUDE.md`; run them before every push)
1. `npm run lint`. It also checks copy voice, workflow pins and the PWA build.
2. Start Postgres: `service postgresql start`. Then run `DATABASE_URL=postgres://postgres:postgres@localhost:5432/rider_comms_test npm test`. Without `DATABASE_URL`, about 30 backend suites skip silently.
3. `npm run test:coverage` with `DATABASE_URL` set. CI fails any package under its floor (99% lines per `CLAUDE.md`).
   - Figures on this branch, 15 November:
     - shared 99.9%;
     - backend 99.80%;
     - mobile node 100%;
     - mobile Jest 99.25%.
4. `npm run test:jest --workspace=mobile` and `npx tsc --noEmit -p mobile`; also `npx tsc --noEmit -p backend`.
5. **Web changes:**
   1. `npm run build:pwa-app && npm run build:web`.
   2. `npx playwright test <spec> --project=<a couple of projects>`. WebKit can't launch in the cloud container; CI runs it.
6. **Social:** from `social/mobile/`:
   1. `npm ci`, `npm run typecheck`, then `npm test` (66 unit tests).
   2. Fixture build and tests:
      - `EXPO_PUBLIC_SOCIAL_TEST_FIXTURES=true npm run build:web`;
      - `npx playwright test` (136 tests).
   3. Production build and tests:
      - `EXPO_PUBLIC_SOCIAL_TEST_FIXTURES=false npm run build:web`;
      - `npx playwright test --config=playwright.production.config.mjs` (18 tests).
   4. Locally, Social's Playwright pins a browser build that isn't installed. Use a temporary config whose `launchOptions.executablePath` is `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`, and drop the WebKit projects. Delete the config afterwards.
   5. `npm audit --omit=dev --audit-level=high` must pass. Three moderate minimatch advisories are pre-existing.
   6. `npx expo export --platform ios --platform android` checks the native bundles.

### Gotchas
- **Migrations** are tracked by name in `schema_migrations`. If you edit an unreleased migration locally, delete its row before re-running.
- **Postgres** in a fresh container is stopped; start it before testing.
- **Native CI cost:** `native-builds` (iOS and Android, about 35–40 minutes) runs on PRs touching `mobile/**`, `shared/**`, `package-lock.json` or that workflow.
  - Keep native and web or backend work in separate PRs when that's cheap.
  - Push once per round, not once per fix.
  - Don't push while a native run is going unless the push fixes it.
- **Maestro flows** (`mobile/maestro/*.yaml`) can't run outside CI. Read them twice:
  - wait for each screen with `extendedWaitUntil`;
  - wrap taps iOS drops in `retry`;
  - match iOS labels with `(,.*)?`.
- **Re-running CI:** read the failing log first. Re-run at most once, and only for infrastructure failures.
- **Social Playwright races:** some tests measured before the app had drawn. The fix is to wait for `#social-bottom-tabs` before measuring; three tests were fixed that way.

---

## 3. Rider Comms (the main app)

The feature descriptions in `PROJECT_STATUS.md` still hold. In brief:
- **Accounts:** Postgres accounts, sessions in `account_sessions` with stored IDs, profiles with avatars, friends, direct messages, blocks, reports, moderation and the staff dashboard.
- **Rides:** private group rides with consent-based location sharing, regroup points, dropped-rider alerts, low-battery markers, ride history and arrival summaries.
- **Proximity:** public presence with anti-spoofing; crowdsourced hazards with an offline queue.
- **Ride Safe:** controls lock at about 8 mph sustained movement.
- **Navigation:**
  - Google Routes API with traffic and alternatives;
  - reroutes and faster-route checks;
  - stops along the route;
  - screen stays on;
  - or handoff to Google Maps, Waze or Apple Maps.
- **Voice:** LiveKit group and proximity voice.
- **Search:** filled colour place icons, distances on shortcuts, rider categories and voice search.

### Parity
Every user-facing change must behave the same in the web app (`docs/app/*.js`) and the native app (`mobile/src`). `client-parity.json` and `CLIENT_PARITY.md` track this, and the repo has a `parity-audit` skill. Shared logic belongs in `shared/src`, with the web copies checked by scripts in `scripts/`.

### Launch
Launch is blocked only on owner actions (`LAUNCH_CHECKLIST.md`):
- legal details;
- a support address;
- a backup key;
- Apple and Google submissions;
- device checks.

---

## 4. Rider Social

### What it is
A separate photo and Reels app (`social/mobile`, Expo, iOS, Android and web) on the **same Rider Comms accounts**: no second login database. It signs in through the Rider Comms backend; the session is in `expo-secure-store` on phones and `sessionStorage` on web. Riders confirm they are 16 or over.

### Backend files
- `backend/src/socialPostStore.ts`: posts, media, feeds, reports, moderation, upload key reservations and post totals.
- `backend/src/socialMediaProcessor.ts`: sharp and ffmpeg re-encoding.
- `backend/src/socialMediaService.ts`: storage wiring and session-bound HMAC links.
- `backend/src/routes/socialPosts.ts`: routes, including `/social/media/:id/(file|poster)?v&s&exp&sig`, served before sign-in because `<img>` and `<video>` can't send a token.
- `backend/src/socialPilot.ts`: who may enter Social, and capabilities.
- `backend/src/socialMediaDeletionOutbox.ts`, plus a maintenance job every 5 minutes. Unused uploads are deleted after 6 hours.
- Full contract: `backend/SOCIAL_PILOT.md`.

### Switches (backend environment, Railway backend service)
| Variable | Effect | Production now |
|---|---|---|
| `SOCIAL_OPEN_BETA_ENABLED=true` | Any signed-in Rider Comms account may enter Social | believed off: verify in Railway |
| `SOCIAL_PILOT_RIDER_IDS` | Comma-separated invite list; a malformed list admits nobody | verify |
| `SOCIAL_MEDIA_S3_ENDPOINT/BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY` (+ optional `SOCIAL_MEDIA_S3_URL_STYLE`) | Private media storage (Railway bucket `social-private-media`) | **set**, according to `SOCIAL_PILOT.md` |
| `SOCIAL_MEDIA_URL_SECRET` | 32+ characters; otherwise the link key is derived from the storage secret | optional |
| `SOCIAL_POSTING_ENABLED=true` | Uploads and new posts. Off: bootstrap reports no posting, and `POST /social/media` and `POST /social/posts` answer `503 social_posting_disabled`. Feeds still read. | **must stay off** until the owner decides on scanning |

`GET /social/bootstrap` reports each capability, and the app never assumes one. Only `mediaUpload` and `publicPosting` can be true. Private posting, live streaming, checkout and payouts are always false.

### Rules
These rules are in `CLAUDE.md`; keep them:
- Media never reaches storage as uploaded. Everything is re-encoded, which strips location data.
- Files are served only through per-session signed links that re-check visibility.
- Moderation decisions need a note.
- Nothing in Social is reachable from the Rider Comms map while the rider is moving.

### What's real and what's still a preview
- **Real:**
  - the account;
  - friends (shown as Following) and messages, shared with Rider Comms;
  - the profile (name, bio and avatar, shared with Rider Comms);
  - posts, Reels, feeds, report, block, delete;
  - staff moderation.
- **Preview or local only:**
  - Stories: unavailable;
  - comments: on this device only;
  - Saved Reels: kept until the app closes;
  - follows of creators: demo only, in the screenshot build;
  - Clubs and Shop: "coming soon" screens;
  - Garage: hidden.
- **Screenshot build:** `EXPO_PUBLIC_SOCIAL_TEST_FIXTURES=true` shows fictional sample creators, posts, clubs and listings for screenshots and tests. Production (`false`) never shows them.

### Hosting
- Social's web build is a separate Railway web service, **`social-web-preview`**, at `https://social-web-preview-preview.up.railway.app`. `RIDER_SOCIAL_URL` in `shared/src/social.ts` points here, and the web app has its own copy in `docs/app/18-map-init-events.js`.
- As far as I know it still auto-deploys the other agent's old development branch, not `main`. **Point it at `main`** once #510 is merged.
- The Social web origin must be in the backend's `CORS_ALLOWED_ORIGINS`.

### Go-live steps (owner decisions first)
1. **Owner:** decide on content scanning (malware and unsafe content) before posting is opened. If required, build it as a PR:
   - quarantine each upload;
   - scan it;
   - promote it to playback only on a clean verdict;
   - fail closed if the scanner is down.
2. Merge #510 (posting stays off) and check the deploys.
3. Point `social-web-preview` at `main`.
4. Set `SOCIAL_OPEN_BETA_ENABLED=true` (or an invite list), then check sign-in and feeds on the web preview.
5. Only after step 1 is satisfied: set `SOCIAL_POSTING_ENABLED=true`, then test end to end:
   1. share a photo and a Reel;
   2. report it (three reports hide it);
   3. check it on the staff dashboard;
   4. delete it.

The Railway connector for claude.ai was never authorised, so I couldn't change Railway settings myself. The owner can authorise it in their claude.ai connector settings, or make these changes in Railway directly.

---

## 5. Suggested next work
1. **Content scanning** for Social uploads, if the owner wants it before posting.
2. **The iOS CI workaround** described in section 1 (retry once on simulator loss), and pinning Maestro.
3. **Show the bio in Rider Comms.** The bio is stored and returned by `GET /profiles/:id` (`publicProfile` in `backend/src/routes/context.ts`), but the web app and the native app don't display or edit it yet. Do both apps together; see the `parity-audit` skill.
4. **Social polish:** comments and Saved Reels are still device-only. They need backend contracts before they can be shared.
5. **Docs:** refresh `PROJECT_STATUS.md` from this file once #510 lands. Update `social/README.md`'s status section, which still describes the pre-takeover state and the old preview branch.

---

## 6. How to reach the owner's decisions
The owner talks to the agent directly. Questions that change scope go to them, not into a PR:
- scanning;
- go-live;
- anything in Railway or the stores.

Don't merge #510 or flip any Railway switch until the owner has said so.
