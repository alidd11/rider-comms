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
 * NOTE ON SCALE: `zoneCandidates()` demonstrates the real production path —
 * restricting matching to a rider's own geo-bucket plus its 8 neighbors
 * (Section 5's sharding layer), so this never becomes an O(n^2) scan across
 * every rider in the system. `updatePresence()` below currently recomputes
 * zone pairs across ALL tracked riders for simplicity in this prototype;
 * wiring it through `zoneCandidates()` per rider is the change needed
 * before this could handle rally-scale concurrent riders (see Section 14's
 * load-testing gap in the product spec) — the matching *logic* itself
 * (shared/zoneMatcher.ts) is already correct and tested either way.
 */
export class PresenceStore {
  private riders = new Map<string, Rider>();
  private previousPairs: ZonePair[] = [];
  private readonly staleAfterMs: number;

  constructor(staleAfterMs = 30_000) {
    this.staleAfterMs = staleAfterMs;
  }

  private pruneStale(now: number): void {
    const staleIds = [...this.riders.values()]
      .filter((rider) => now - rider.updatedAt > this.staleAfterMs)
      .map((rider) => rider.id);
    for (const riderId of staleIds) this.riders.delete(riderId);
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
    this.pruneStale(rider.updatedAt);
    this.riders.set(rider.id, rider);

    const currentPairs = computeZonePairs([...this.riders.values()]);
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
