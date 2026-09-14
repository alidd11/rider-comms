import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import {
  computeZonePairs,
  diffZoneTransitions,
  isMutuallyInZone,
} from '../src/zoneMatcher.ts';
import type { Rider } from '../src/types.ts';

function riderAt(id: string, lat: number, lon: number, radiusMiles: number): Rider {
  return { id, location: { lat, lon }, radiusMiles, updatedAt: Date.now() };
}

describe('isMutuallyInZone (locked-in mutual-radius rule)', () => {
  it('is true when both riders are within each other\'s radius', () => {
    // ~0.5 miles apart
    const a = riderAt('a', 40.0, -105.0, 1);
    const b = riderAt('b', 40.0072, -105.0, 1);
    expect(isMutuallyInZone(a, b)).toBe(true);
  });

  it('matches the exact scenario from the spec: a Premium+ (20mi) and a Free (1mi) rider 3 miles apart are NOT in the same zone', () => {
    const premiumPlus = riderAt('p+', 40.0, -105.0, 20);
    // ~3 miles away
    const free = riderAt('free', 40.0435, -105.0, 1);
    expect(isMutuallyInZone(premiumPlus, free)).toBe(false);
  });

  it('is governed by the SMALLER of the two radii, not the larger (mutual, not one-way)', () => {
    const bigRadius = riderAt('big', 40.0, -105.0, 20);
    // ~1.5 miles away — inside big's 20mi radius, outside small's 1mi radius
    const smallRadius = riderAt('small', 40.0217, -105.0, 1);
    expect(isMutuallyInZone(bigRadius, smallRadius)).toBe(false);
    expect(isMutuallyInZone(smallRadius, bigRadius)).toBe(false); // symmetric regardless of argument order
  });

  it('is true once both riders\' radii cover the distance between them', () => {
    const a = riderAt('a', 40.0, -105.0, 6); // Premium
    const b = riderAt('b', 40.0435, -105.0, 6); // ~3 miles away, Premium
    expect(isMutuallyInZone(a, b)).toBe(true);
  });
});

describe('computeZonePairs', () => {
  it('finds only the pairs that satisfy the mutual-radius rule among a group', () => {
    const close1 = riderAt('close1', 40.0, -105.0, 1);
    const close2 = riderAt('close2', 40.0072, -105.0, 1); // ~0.5mi from close1
    const far = riderAt('far', 41.0, -106.0, 20); // nowhere near either

    const pairs = computeZonePairs([close1, close2, far]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].a).toBe('close1');
    expect(pairs[0].b).toBe('close2');
  });

  it('returns no pairs for a single rider or an empty list', () => {
    expect(computeZonePairs([])).toHaveLength(0);
    expect(computeZonePairs([riderAt('solo', 40, -105, 5)])).toHaveLength(0);
  });
});

describe('diffZoneTransitions', () => {
  it('reports a pair as "entered" when it appears in the new snapshot but not the old one', () => {
    const previous = [{ a: 'a', b: 'b', distanceMiles: 0.5 }];
    const current = [
      { a: 'a', b: 'b', distanceMiles: 0.5 },
      { a: 'a', b: 'c', distanceMiles: 0.2 },
    ];
    const transitions = diffZoneTransitions(previous, current);
    expect(transitions).toEqual([{ a: 'a', b: 'c', type: 'entered' }]);
  });

  it('reports a pair as "left" when it disappears between snapshots', () => {
    const previous = [
      { a: 'a', b: 'b', distanceMiles: 0.5 },
      { a: 'a', b: 'c', distanceMiles: 0.9 },
    ];
    const current = [{ a: 'a', b: 'b', distanceMiles: 0.5 }];
    const transitions = diffZoneTransitions(previous, current);
    expect(transitions).toEqual([{ a: 'a', b: 'c', type: 'left' }]);
  });

  it('is order-independent for the pair (a,b) vs (b,a)', () => {
    const previous = [{ a: 'x', b: 'y', distanceMiles: 0.1 }];
    const current = [{ a: 'y', b: 'x', distanceMiles: 0.1 }];
    expect(diffZoneTransitions(previous, current)).toEqual([]);
  });

  it('reports no transitions when nothing changed', () => {
    const snapshot = [{ a: 'a', b: 'b', distanceMiles: 0.3 }];
    expect(diffZoneTransitions(snapshot, snapshot)).toEqual([]);
  });
});
