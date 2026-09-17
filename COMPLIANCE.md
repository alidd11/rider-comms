# Mobile store readiness

This repository is a pre-alpha test build. Store review compliance is an ongoing operational obligation, not something code alone can guarantee.

## Implemented in this branch

- Foreground-only location permission with an in-context prompt, opt-in sharing, explicit leave, and no background-location declaration.
- Secure device storage for the guest bearer token and server-derived actor identity.
- Atomic in-app account deletion that revokes sessions and removes the rider's durable profile, social, message, ride, friendship, hideout, presence, hazard, moderation and submitted-route data.
- In-app report and block controls for direct messages. Blocking removes the friendship and prevents messages and friend requests in either direction.
- Instagram and TikTok usernames with independent Public, Friends only, and Private visibility.
- In-app privacy, safety, test-build and community-rule disclosures.
- iOS privacy-manifest declaration for app preferences, explicit application identifiers, Android versioning, and an EAS internal APK profile.
- No advertising SDK, tracking permission, background location, microphone permission, billing unlock, or unimplemented video feed exposed in the native build.
- Movement-aware ride-safe surfaces in both clients fail locked on cold start, stale/unusable GPS, permission loss and app backgrounding. Distracting social, setup, billing, messaging, settings and route-discovery controls unlock only after sustained stationary evidence; map/navigation and active-ride exit controls remain available.

## Required before public App Store or Play Store submission

1. Add account recovery, a documented retention schedule, encrypted production storage and backups, tested restore procedures, and scheduled retention/deletion jobs. Postgres persistence and atomic in-app deletion exist, but those operational controls do not.
2. Publish a complete privacy policy and terms at stable HTTPS URLs, configure a monitored support address, and link them in store metadata and the app.
3. Staff a moderation queue with response targets and appeal/escalation procedures; persist reports and audit actions.
4. Complete Apple privacy nutrition labels, Google Play Data safety, content-rating, target-audience, account-deletion URL, and testing-access declarations accurately.
5. Add acceptance of Terms and Community Guidelines before any future user-generated video upload. The video feature must include proactive filtering, report/block tools, moderation, age controls, per-post Public/Friends/Private visibility, and a movement lock covering playback, posting, comments, likes, and feed scrolling.
6. Complete physical-device accessibility and motorcycle distraction testing of the implemented movement lock, including permission denial, tunnels/GPS loss, passenger use, background/foreground transitions, false positives and the delayed unlock after stopping.
7. Configure Apple and Google developer accounts, signing credentials, unique production identifiers, store listings, screenshots, reviewer notes, and TestFlight/Play internal testing groups.
8. Verify every production third-party integration, including maps/navigation, voice, billing receipt validation, abuse tooling, and the deployed HTTPS API.

## Internal testing

Run `npm install`, `npm run check`, and the Expo exports. With an Expo account and signing credentials configured, create an Android install link using `cd mobile && npx eas-cli build --profile preview --platform android`. iOS internal distribution additionally requires an Apple Developer team and registered test devices; TestFlight uses the production profile.
