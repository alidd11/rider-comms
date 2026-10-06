import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeZonePairsFor, ZONE_EXIT_HYSTERESIS } from '../src/zoneMatcher.ts';
import type { Rider } from '../src/types.ts';

const at = (id: string, milesNorth: number, radiusMiles = 1): Rider => ({
  id,
  location: { lat: 51.5 + milesNorth / 69.05, lon: -0.1 },
  radiusMiles,
  updatedAt: 0,
});

describe('computeZonePairsFor exit hysteresis', () => {
  it('pairs new riders only inside the radius', () => {
    assert.equal(computeZonePairsFor(at('a', 0), [at('b', 0.95)]).length, 1);
    assert.equal(computeZonePairsFor(at('a', 0), [at('b', 1.08)]).length, 0);
  });

  it('keeps an existing partner up to the exit margin, then drops them', () => {
    const partners = new Set(['b']);
    assert.equal(computeZonePairsFor(at('a', 0), [at('b', 1.08)], partners).length, 1);
    assert.equal(computeZonePairsFor(at('a', 0), [at('b', ZONE_EXIT_HYSTERESIS + 0.05)], partners).length, 0);
  });

  it('uses the smaller radius of the two, as before', () => {
    assert.equal(computeZonePairsFor(at('a', 0, 5), [at('b', 1.5, 1)]).length, 0);
    assert.equal(computeZonePairsFor(at('a', 0, 5), [at('b', 1.1, 1)], new Set(['b'])).length, 1);
  });
});
