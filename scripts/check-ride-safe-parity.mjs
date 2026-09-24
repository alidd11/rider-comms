import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_RIDE_SAFE_ENABLED, parseRideSafeEnabled } from '../mobile/src/rideSafePreference.ts';

const [app, settingsScreen] = await Promise.all([
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/SettingsScreen.tsx', import.meta.url), 'utf8'),
]);

// Ride Safe is a safety feature (it locks distracting controls above walking
// speed) hand-ported from mobile/src/rideSafePreference.ts into docs/app.js's
// state object, unlike navigation guidance/camera/position-interpolation,
// which have their own dedicated parity checks against a shared module. This
// guards the one invariant that actually matters for safety: the preference
// must fail open to "on", never silently to "off", whatever is in storage.
assert.equal(DEFAULT_RIDE_SAFE_ENABLED, true, 'Ride Safe must default to enabled');
assert.ok(app.includes('rideSafeEnabled: true,'), 'PWA default state must also default Ride Safe to enabled');

for (const [stored, expected] of [
  [null, true],
  ['true', true],
  ['false', false],
  ['garbage', true],
]) {
  assert.equal(
    parseRideSafeEnabled(stored),
    expected,
    `native Ride Safe preference must resolve ${JSON.stringify(stored)} to ${expected}`,
  );
}

assert.ok(
  app.includes('rideSafeEnabled: stored.rideSafeEnabled !== false,'),
  'PWA must only ever treat an explicit `false` as disabling Ride Safe, matching the native fail-open default',
);

// Both surfaces must confirm before turning the safety lock off, and the
// mobile/PWA copy explaining the consequence must stay in sync.
assert.match(
  settingsScreen,
  /Turn off Automatic Ride Safe\?/,
  'native settings must confirm before disabling Ride Safe',
);
assert.ok(
  app.includes("window.confirm('Turn off Automatic Ride Safe? Distracting controls will no longer lock automatically while this device is moving. Only change this while safely stopped.')"),
  'PWA settings must confirm before disabling Ride Safe with matching copy',
);

const noteCopy = 'When off, Rider Comms stops its dedicated Ride Safe location watcher. Map, navigation and optional ride-location features request location separately. Only change this while safely stopped.';
assert.ok(settingsScreen.includes(noteCopy), 'native Ride Safe note copy has drifted');
assert.ok(app.includes(noteCopy), 'PWA Ride Safe note copy has drifted');

console.log('Ride Safe PWA/native parity valid: default-on, fail-open storage parsing, and disable confirmation stay in sync');
