# Mobile store readiness

The step-by-step App Store submission guide, with App Store Connect answers and reviewer notes, is in `APP_REVIEW.md`. Store review compliance is an ongoing operational obligation, not something code alone can guarantee.

## Implemented in this branch

- "While Using" location permission with an in-context prompt, opt-in sharing and explicit leave. The app never asks for Always (or Android background) location. The only background use is turn-by-turn navigation the rider starts: iOS shows its location indicator and Android a navigation notification, and updates stop when navigation ends. Sharing with riders still happens only while the app is open.
- Secure device storage for the guest bearer token and server-derived actor identity.
- Atomic in-app account deletion that revokes sessions and removes the rider's durable profile, social, message, ride, friendship, hideout, presence, hazard, moderation and submitted-route data.
- Agreement to the Terms of Service and Community Guidelines at signup, and once for existing accounts whenever the terms version changes (`TERMS_VERSION`). Posting, chat and voice are refused until the rider agrees.
- Server-side filtering of slurs and explicit terms in usernames, display names, handles, social usernames, hideout names and messages (`backend/src/contentFilter.ts`).
- Report and block from profiles, chats, the ride roster, friend requests and the Nearby Voice rider list (with per-rider mute), plus a Blocked riders list in Settings. Blocking removes the friendship and prevents messages, friend requests and Nearby pairing in either direction.
- Published Privacy Policy, Terms, Community Guidelines and Support pages, generated from `legal/` (`npm run build:legal`) and linked from signup, the Legal screen and Settings.
- Instagram and TikTok usernames with independent Public, Friends only, and Private visibility.
- In-app privacy, safety and community-rule summaries linking to the published pages.
- iOS privacy manifest declaring collected data types and required-reason APIs, a full-bleed app icon and splash screen, explicit application identifiers, Android versioning, and an EAS internal APK profile.
- No advertising SDK, tracking permission, background-location permission, billing unlock, or unimplemented video feed is exposed in the native build. Microphone permission is declared only for the explicit rider voice features.
- Movement-aware Ride Safe surfaces in both clients use the same 8 mph threshold. Confirmed sustained movement locks distracting controls; unknown/stale GPS remains a visible warning state without hiding product areas, and below-threshold evidence must be sustained before an existing movement lock clears.

## Required before public App Store or Play Store submission

1. Operate the data controls now in the repository: password-reset account recovery, the retention schedule and scheduled deletion sweeps (`RETENTION.md`), and encrypted nightly backups with a restore-verification script (`BACKUP_RESTORE.md`). Still required: configure the backup secrets and private-key custody, confirm the database host encrypts storage at rest, run and record the monthly restore drill, and settle the open retention decisions listed in `RETENTION.md`.
2. Complete the published legal pages: fill in `legal/site-details.json` (company name, support email, postal address), have a lawyer complete the bracketed legal sections the pages still show, run `npm run build:legal`, and configure a monitored support address.
3. Staff the moderation queue. Reports now carry a review status, admins can dismiss them or suspend riders, and every decision goes to an audit log (see `MODERATION.md`). Still required: named moderators, published response targets, and a monitored appeals/support channel.
4. Complete Apple privacy nutrition labels, Google Play Data safety, content-rating, target-audience, account-deletion URL, and testing-access declarations accurately.
5. Add acceptance of Terms and Community Guidelines before any future user-generated video upload. The video feature must include proactive filtering, report/block tools, moderation, age controls, per-post Public/Friends/Private visibility, and a movement lock covering playback, posting, comments, likes, and feed scrolling.
6. Complete physical-device accessibility and motorcycle distraction testing of the implemented movement lock, including permission denial, tunnels/GPS loss, passenger use, background/foreground transitions, false positives and the delayed unlock after stopping.
7. Configure Apple and Google developer accounts, signing credentials, unique production identifiers, store listings, screenshots, reviewer notes, and TestFlight/Play internal testing groups.
8. Verify every production third-party integration, including maps/navigation, voice, billing receipt validation, abuse tooling, and the deployed HTTPS API.

## Internal testing

Run `npm install`, `npm run check`, and the Expo exports. With an Expo account and signing credentials configured, create an Android install link using `cd mobile && npx eas-cli build --profile preview --platform android`. iOS internal distribution additionally requires an Apple Developer team and registered test devices; TestFlight uses the production profile.
