---
name: parity-audit
description: Check that a change to Rider Comms behaves the same in the web app (docs/) and the native app (mobile/). Use for any user-facing change, before committing, and when asked whether the two apps match.
---

# Web and native parity audit

Rider Comms ships one product in two shells: the PWA in `docs/` (sources in
`docs/app/*.js`, assembled into `docs/app.js`) and the Expo app in `mobile/`.
The rule, from `client-parity.json`: any user-facing capability in one client
must exist in the other. The only allowed differences are listed there under
`allowedPlatformDifferences` (credential storage, OS audio and Bluetooth
routing, notification permission plumbing, map SDK, deep-link plumbing).

## Steps

1. **List what the change does for a rider**: each screen, control, label,
   empty, loading and error state, and back or close behaviour it touches.
2. **Find the counterpart in the other app** for every item. Useful pairs:

   | PWA | Native |
   | --- | --- |
   | `docs/app/14-map-search.js` (drawer, search) | `mobile/src/screens/MapDrawer.tsx`, `PlaceSearchBar.tsx` |
   | `docs/app/06-friends.js`, `07-chat.js` | `FriendsScreen.tsx`, `FriendChatScreen.tsx` |
   | `docs/app/09-rides.js` | `mobile/src/ride/` |
   | `docs/app/10-settings.js` | `SettingsScreen.tsx`, `SettingsListUi.tsx` |
   | `docs/app/13-location-safety.js`, `docs/movement-safety.js` | `mobile/src/safety/` |
   | `docs/app/12-voice.js` | `mobile/src/voice/`, `mobile/src/ride/RideBar.tsx` |

   Comments often name the counterpart, for example `(PWA: #mapDrawer)`.
3. **Compare like for like**:
   - the same words, including accessibility labels
   - the same order of items
   - the same empty, loading and error states, including the wording and the Retry
   - the same back and close results
   - the same storage keys' meaning (per rider, on device)
4. **Update `client-parity.json`** when a capability is added, removed or
   renamed. `node scripts/check-client-parity.mjs` validates it.
5. **Run the parity checks** (all are part of `npm run lint`):
   - `check-client-parity`
   - `check-ride-safe-parity`
   - `check-navigation-links-parity`
   - `check-pwa-social-safety`
   - `check-native-a11y`
6. **Test both apps**:
   - The web app needs a Playwright test in the matching `tests/visual/*.spec.js`.
   - The native app needs a Jest test under `mobile/tests-jest/`.
   - When the flow is in the smoke path, also update the Maestro flow in
     `mobile/maestro/authenticated-smoke.yaml`.

## Report

Give a short table:

| Capability | PWA | Native | Same? |
| --- | --- | --- | --- |

Under it, list each difference with the file and line, and whether it's an
allowed platform difference or something to fix.
