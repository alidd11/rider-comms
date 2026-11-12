---
name: ride-safety-navigation
description: Review changes that affect riding: Ride Safe (locking distracting controls while moving), turn-by-turn navigation, GPS handling and location privacy. Use when touching movement detection, the map while riding, navigation, or anything that sends or shows a rider's position.
---

# Ride safety, navigation and location privacy

Riders use Rider Comms on a moving motorcycle. A change here is judged first
by whether it distracts a moving rider or exposes where someone is.

## Ride Safe

- Ride Safe locks distracting controls above walking speed. It is on by
  default, and turning it off needs a confirmation.
- Movement state:
  - shared logic: `shared/src/movementState.ts`
  - web: `docs/movement-safety.js` and `docs/app/13-location-safety.js`
  - native: `mobile/src/safety/`
- Every new control asks the same question: should it be usable while moving?
  If not, gate it the same way in both apps. In the PWA that's
  `RiderMovementSafety.isLockedForSafety`; in native, `lockedForSafety` from
  `useMovementSafety`. `node scripts/check-ride-safe-parity.mjs` keeps the
  defaults and parsing in step.
- When movement can't be verified (no GPS, a stale fix), controls stay
  available. Don't lock the rider out because of bad data. Tests cover this:
  "keeps controls available when movement cannot be verified".
- Nothing may need typing or a long read while moving. Prefer one tap, large
  targets (48pt minimum), and spoken or glanceable output.

## Navigation

- Shared, tested modules:
  - `navigationGuidance`
  - `navigationCamera`
  - `navigationRoadEvents`
  - `positionInterpolation`
  - the navigation puck
- Each module has a native version (`mobile/src/navigation*.ts`), a web version
  (`docs/navigation-*.js`) and a check script in `scripts/`. A change to one
  side needs the same change on the other.
- The navigation hand-off links (Google Maps, Waze, Apple Maps) stay in step
  through `check-navigation-links-parity`.
- While navigating, the map owns the screen: the Where to drawer and other
  overlays step aside.

## Location privacy

- **Nearby never shows exact positions.** Riders in range appear as a count
  ("exact locations private").
- **The server rejects bad fixes.** Fixes older than `MAX_PRESENCE_FIX_AGE_MS`
  or less accurate than `MAX_PRESENCE_ACCURACY_METERS`
  (`backend/src/routes/context.ts`) are refused.
- **Private ride location needs consent inside the ride.** It is shared only
  with that ride's members and stops when the rider leaves.
- **Turning sharing off is immediate.** Turning Nearby or sharing off removes
  presence on the server straight away and hangs up Nearby Voice
  (`backend/src/routes/live.ts`).
- **Check every response.** For any new endpoint or payload, confirm it can't
  return another rider's coordinates unless they are in the same ride and have
  consented. Blocks apply both ways.

## Before committing

- Run `npm run lint` and the backend tests for the routes touched.
- Run the Playwright map and nearby-voice specs, and the native Jest tests for
  `mobile/src/safety` and the screen.
- Say in the PR what a moving rider now sees, and whether anything new is
  usable while moving.
