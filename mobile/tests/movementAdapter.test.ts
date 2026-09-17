import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toMovementFix } from '../src/safety/movementAdapter.ts';

describe('native movement location adapter', () => {
  it('preserves Expo coordinates, accuracy, speed and timestamp', () => {
    assert.deepEqual(toMovementFix({
      timestamp: 1_800_000_000_000,
      coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 8, speed: 4.5 },
    }), {
      lat: 51.5074,
      lon: -0.1278,
      timestampMs: 1_800_000_000_000,
      accuracyMeters: 8,
      speedMps: 4.5,
    });
  });

  it('fails unusable platform accuracy closed through the shared validator', () => {
    const fix = toMovementFix({
      timestamp: 1_800_000_000_000,
      coords: { latitude: 51.5074, longitude: -0.1278, accuracy: null, speed: null },
    });
    assert.equal(fix.accuracyMeters, Number.POSITIVE_INFINITY);
    assert.equal(fix.speedMps, undefined);
  });
});
