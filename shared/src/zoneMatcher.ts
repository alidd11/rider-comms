import { haversineMiles } from './distance.ts';
import type { Rider } from './types.ts';

export interface ZonePair {
  a: string;
  b: string;
  distanceMiles: number;
}

/**
 * The locked-in "mutual radius" rule from the product spec: two riders are
 * in the same zone only if each is within the OTHER's active radius —
 * eligibility = distance <= min(radiusA, radiusB). This is symmetric by
 * construction, so there's no "I can hear them but they can't hear me"
 * state, which was the whole point of locking this rule in.
 */
export function isMutuallyInZone(a: Rider, b: Rider): boolean {
  const distanceMiles = haversineMiles(a.location, b.location);
  const maxAllowed = Math.min(a.radiusMiles, b.radiusMiles);
  return distanceMiles <= maxAllowed;
}

/**
 * Computes every mutually-in-zone pair among a set of riders (intended to be
 * called with riders already narrowed to one geo-bucket + its neighbors,
 * see geoBucket.ts — this is O(n^2) and only safe for a bucket-sized group,
 * never a whole city/region at once).
 */
export function computeZonePairs(riders: Rider[]): ZonePair[] {
  const pairs: ZonePair[] = [];
  for (let i = 0; i < riders.length; i++) {
    for (let j = i + 1; j < riders.length; j++) {
      const a = riders[i];
      const b = riders[j];
      const distanceMiles = haversineMiles(a.location, b.location);
      const maxAllowed = Math.min(a.radiusMiles, b.radiusMiles);
      if (distanceMiles <= maxAllowed) {
        pairs.push({ a: a.id, b: b.id, distanceMiles });
      }
    }
  }
  return pairs;
}

/**
 * Riders already paired stay paired until they're this much further apart
 * than the radius that paired them. Without it, two riders right at the
 * edge of range dropped in and out of Nearby Voice as their GPS fixes
 * wobbled a few metres either side of the line.
 */
export const ZONE_EXIT_HYSTERESIS = 1.15;

/**
 * The zone pairs one rider forms with a set of others: the same rule as
 * computeZonePairs, but linear. A presence update only needs the updating
 * rider's pairs, and computing all n^2 pairs among a dense crowd and then
 * discarding most of them was the server's main CPU cost under load.
 *
 * `currentPartnerIds` are riders this rider is already paired with; they
 * keep the pair up to ZONE_EXIT_HYSTERESIS times the radius. The rule
 * stays symmetric, since both riders' updates see the same existing pair.
 */
export function computeZonePairsFor(
  rider: Rider,
  others: Rider[],
  currentPartnerIds: ReadonlySet<string> = new Set(),
): ZonePair[] {
  const pairs: ZonePair[] = [];
  for (const other of others) {
    if (other.id === rider.id) continue;
    const distanceMiles = haversineMiles(rider.location, other.location);
    const radius = Math.min(rider.radiusMiles, other.radiusMiles);
    const allowed = currentPartnerIds.has(other.id) ? radius * ZONE_EXIT_HYSTERESIS : radius;
    if (distanceMiles <= allowed) {
      pairs.push({ a: rider.id, b: other.id, distanceMiles });
    }
  }
  return pairs;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}

export type ZoneTransitionType = 'entered' | 'left';

export interface ZoneTransition {
  a: string;
  b: string;
  type: ZoneTransitionType;
}

/**
 * Diffs two zone-pair snapshots (e.g. before/after a location update) into
 * "entered zone" / "dropped out of zone" events. This is what drives the
 * two distinct earcons from Section 8 of the spec (calm "out of zone" vs.
 * urgent "you're disconnected") and the audio subscribe/unsubscribe calls
 * to the SFU — a transition, not a raw distance number, is what the client
 * and the SFU both actually need.
 */
export function diffZoneTransitions(
  previous: ZonePair[],
  current: ZonePair[]
): ZoneTransition[] {
  const prevKeys = new Set(previous.map((p) => pairKey(p.a, p.b)));
  const currKeys = new Set(current.map((p) => pairKey(p.a, p.b)));
  const transitions: ZoneTransition[] = [];

  for (const pair of current) {
    if (!prevKeys.has(pairKey(pair.a, pair.b))) {
      transitions.push({ a: pair.a, b: pair.b, type: 'entered' });
    }
  }
  for (const pair of previous) {
    if (!currKeys.has(pairKey(pair.a, pair.b))) {
      transitions.push({ a: pair.a, b: pair.b, type: 'left' });
    }
  }
  return transitions;
}
