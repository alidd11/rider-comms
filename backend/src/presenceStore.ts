import {
  bucketId,
  computeZonePairs,
  diffZoneTransitions,
  getBucketCoord,
  getNeighboringBucketIds,
} from '@rider-comms/shared';
import type { Rider, ZonePair, ZoneTransition } from '@rider-comms/shared';

export interface PresenceUpdateResult {
  transitions: ZoneTransition[];
  zonePairs: ZonePair[];
}

/**
 * Public local channel presence (Section 5/8 of the spec): tracks each
 * rider's last-known location and radius, and is the thing that owns the
 * mutual in-zone/out-of-zone decision server-side (never client-side —
 * Section 8 was explicit about that, both for privacy and so two phones
 * can't disagree about the answer from slightly stale data).
 *
 * SCALE: `updatePresence()` only recomputes pairs touching the rider whose
 * location just changed, against `zoneCandidates()` — their own geo-bucket
 * plus its 8 neighbors (Section 5's sharding layer) — rather than scanning
 * every rider in the system on every single ping. Every other rider's
 * pairs are carried over unchanged from the previous snapshot, since
 * nothing about them changed. This is what makes rally-scale concurrent
 * riders (Section 14's load-testing gap in the product spec) tractable;
 * the matching *logic* itself (shared/zoneMatcher.ts) doesn't change.
 */
export class PresenceStore {
  private riders = new Map<string, Rider>();
  private previousPairs: ZonePair[] = [];
  private readonly staleAfterMs: number;

  constructor(staleAfterMs = 30_000) {
    this.staleAfterMs = staleAfterMs;
  }

  /** Returns the ids of riders it actually pruned, so callers can also drop
   * their pairs from the previous-pairs snapshot — otherwise a rider who
   * goes stale via someone else's ping would never leave anyone's zone. */
  private pruneStale(now: number): string[] {
    const staleIds = [...this.riders.values()]
      .filter((rider) => now - rider.updatedAt > this.staleAfterMs)
      .map((rider) => rider.id);
    for (const riderId of staleIds) this.riders.delete(riderId);
    return staleIds;
  }

  /** Riders sharing this rider's geo-bucket or an adjacent one — the
   * scale-safe candidate set a production deployment would diff against,
   * instead of every rider in the system. */
  zoneCandidates(rider: Rider): Rider[] {
    const neighborIds = new Set(getNeighboringBucketIds(rider.location));
    return [...this.riders.values()].filter((other) => {
      if (other.id === rider.id) return false;
      const otherBucket = bucketId(getBucketCoord(other.location));
      return neighborIds.has(otherBucket);
    });
  }

  updatePresence(rider: Rider): PresenceUpdateResult {
    const staleIds = new Set(this.pruneStale(rider.updatedAt));
    staleIds.add(rider.id); // this rider's own pairs are also being replaced below
    this.riders.set(rider.id, rider);

    // Only this rider's pairs, and any rider that just went stale, can have
    // changed — recompute the former against bucket-scoped candidates and
    // drop the latter outright, carrying every other pair over unchanged
    // rather than rescanning the whole rider set.
    const unaffectedPairs = this.previousPairs.filter((pair) => !staleIds.has(pair.a) && !staleIds.has(pair.b));
    const refreshedPairs = computeZonePairs([rider, ...this.zoneCandidates(rider)]).filter(
      (pair) => pair.a === rider.id || pair.b === rider.id
    );
    const currentPairs = [...unaffectedPairs, ...refreshedPairs];
    const transitions = diffZoneTransitions(this.previousPairs, currentPairs);
    this.previousPairs = currentPairs;

    return { transitions, zonePairs: currentPairs };
  }

  removeRider(riderId: string): void {
    this.riders.delete(riderId);
    this.previousPairs = computeZonePairs([...this.riders.values()]);
  }

  getRider(riderId: string): Rider | undefined {
    return this.riders.get(riderId);
  }

  ridersInZoneWith(riderId: string, zonePairs: ZonePair[]): string[] {
    const partners: string[] = [];
    for (const pair of zonePairs) {
      if (pair.a === riderId) partners.push(pair.b);
      if (pair.b === riderId) partners.push(pair.a);
    }
    return partners;
  }
}
