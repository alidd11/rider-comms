import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('native ride location sync uses the upload snapshot without an immediate read request', () => {
  const source = readFileSync(new URL('../src/ride/RideContext.tsx', import.meta.url), 'utf8');
  assert.match(source, /const \{ locations \} = await client\.updateRideLocation\(/);
  assert.doesNotMatch(source, /client\.getRideLocations\(activeRide\.rideId\)/);
});
