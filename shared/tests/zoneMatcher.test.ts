import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeZonePairs,
  computeZonePairsFor,
  diffZoneTransitions,
  isMutuallyInZone,
  ZONE_EXIT_HYSTERESIS,
} from '../src/zoneMatcher.ts';
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

describe('mutual radius rule', () => {
  it('needs each rider inside the other\'s radius', () => {
    assert.equal(isMutuallyInZone(at('a', 0, 5), at('b', 1.5, 2)), true);
    assert.equal(isMutuallyInZone(at('a', 0, 5), at('b', 2.5, 2)), false);
  });

  it('computes every pair in a group exactly once', () => {
    const pairs = computeZonePairs([at('a', 0, 2), at('b', 1, 2), at('c', 1.5, 2), at('d', 10, 2)]);
    assert.deepEqual(pairs.map((pair) => `${pair.a}-${pair.b}`).sort(), ['a-b', 'a-c', 'b-c']);
    assert.ok(pairs.every((pair) => pair.distanceMiles > 0));
  });
});

describe('diffZoneTransitions', () => {
  it('reports entered and left pairs regardless of which rider is a or b', () => {
    const before = [{ a: 'a', b: 'b', distanceMiles: 1 }, { a: 'a', b: 'c', distanceMiles: 1 }];
    const after = [{ a: 'b', b: 'a', distanceMiles: 1 }, { a: 'a', b: 'd', distanceMiles: 1 }];
    assert.deepEqual(diffZoneTransitions(before, after), [
      { a: 'a', b: 'd', type: 'entered' },
      { a: 'a', b: 'c', type: 'left' },
    ]);
    assert.deepEqual(diffZoneTransitions(after, after), []);
  });
});
