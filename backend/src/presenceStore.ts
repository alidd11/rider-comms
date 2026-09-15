import {
  bucketId,
  computeZonePairs,
  diffZoneTransitions,
  getBucketCoord,
  getNeighboringBucketIds,
} from '@rider-comms/shared';
import type { Rider, ZonePair, ZoneTransition } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

export interface PresenceUpdateResult {
  transitions: ZoneTransition[];
  zonePairs: ZonePair[];
}

interface RiderPresenceRow {
  rider_id: string;
  lat: number;
  lon: number;
  radius_miles: number;
  updated_at: string | number;
}

function rowToRider(row: RiderPresenceRow): Rider {
  return {
    id: row.rider_id,
    location: { lat: row.lat, lon: row.lon },
    radiusMiles: row.radius_miles,
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Public local channel presence (Section 5/8 of the spec): tracks each
 * rider's last-known location and radius, and is the thing that owns the
 * mutual in-zone/out-of-zone decision server-side (never client-side —
 * Section 8 was explicit about that, both for privacy and so two phones
 * can't disagree about the answer from slightly stale data). Riders are
 * persisted in Postgres (see db.ts) as a single `rider_presence` row per
 * rider, written with one UPSERT per location ping rather than a
 * delete+insert, since this table is written far more often than any
 * other store's.
 *
 * SCALE: `updatePresence()` only recomputes pairs touching the rider whose
 * location just changed, against `zoneCandidates()` — their own geo-bucket
 * plus its 8 neighbors (Section 5's sharding layer) — rather than scanning
 * every rider in the system on every single ping. Every other rider's
 * pairs are carried over unchanged from the previous snapshot, since
 * nothing about them changed. This is what makes rally-scale concurrent
 * riders (Section 14's load-testing gap in the product spec) tractable;
 * the matching *logic* itself (shared/zoneMatcher.ts) doesn't change.
 *
 * `previousPairs` is kept in-process rather than in Postgres — it's a
 * derived diff cache (last-computed zone pairs, used only to work out
 * "entered"/"left" transitions on the next ping), not durable state a
 * client or another process ever needs to read back.
 */
export class PresenceStore {
  private previousPairs: ZonePair[] = [];
  private readonly staleAfterMs: number;

  constructor(staleAfterMs = 30_000) {
    this.staleAfterMs = staleAfterMs;
  }

  private async loadAllRiders(): Promise<Rider[]> {
    const { rows } = await getPool().query<RiderPresenceRow>('SELECT * FROM rider_presence');
    return rows.map(rowToRider);
  }

  /** Returns the ids of riders it actually pruned, so callers can also drop
   * their pairs from the previous-pairs snapshot — otherwise a rider who
   * goes stale via someone else's ping would never leave anyone's zone. */
  private async pruneStale(now: number): Promise<string[]> {
    const riders = await this.loadAllRiders();
    const staleIds = riders.filter((rider) => now - rider.updatedAt > this.staleAfterMs).map((rider) => rider.id);
    if (staleIds.length > 0) {
      await getPool().query('DELETE FROM rider_presence WHERE rider_id = ANY($1::text[])', [staleIds]);
    }
    return staleIds;
  }

  /** Riders sharing this rider's geo-bucket or an adjacent one — the
   * scale-safe candidate set a production deployment would diff against,
   * instead of every rider in the system. */
  async zoneCandidates(rider: Rider): Promise<Rider[]> {
    await ensureMigrated();
    const neighborIds = new Set(getNeighboringBucketIds(rider.location));
    const riders = await this.loadAllRiders();
    return riders.filter((other) => {
      if (other.id === rider.id) return false;
      const otherBucket = bucketId(getBucketCoord(other.location));
      return neighborIds.has(otherBucket);
    });
  }

  async updatePresence(rider: Rider): Promise<PresenceUpdateResult> {
    await ensureMigrated();
    const staleIds = new Set(await this.pruneStale(rider.updatedAt));
    staleIds.add(rider.id); // this rider's own pairs are also being replaced below

    await getPool().query(
      `INSERT INTO rider_presence (rider_id, lat, lon, radius_miles, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (rider_id) DO UPDATE SET
         lat = EXCLUDED.lat,
         lon = EXCLUDED.lon,
         radius_miles = EXCLUDED.radius_miles,
         updated_at = EXCLUDED.updated_at`,
      [rider.id, rider.location.lat, rider.location.lon, rider.radiusMiles, rider.updatedAt]
    );

    // Only this rider's pairs, and any rider that just went stale, can have
    // changed — recompute the former against bucket-scoped candidates and
    // drop the latter outright, carrying every other pair over unchanged
    // rather than rescanning the whole rider set.
    const unaffectedPairs = this.previousPairs.filter((pair) => !staleIds.has(pair.a) && !staleIds.has(pair.b));
    const refreshedPairs = computeZonePairs([rider, ...(await this.zoneCandidates(rider))]).filter(
      (pair) => pair.a === rider.id || pair.b === rider.id
    );
    const currentPairs = [...unaffectedPairs, ...refreshedPairs];
    const transitions = diffZoneTransitions(this.previousPairs, currentPairs);
    this.previousPairs = currentPairs;

    return { transitions, zonePairs: currentPairs };
  }

  async removeRider(riderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM rider_presence WHERE rider_id = $1', [riderId]);
    const remaining = await this.loadAllRiders();
    this.previousPairs = computeZonePairs(remaining);
  }

  async getRider(riderId: string): Promise<Rider | undefined> {
    await ensureMigrated();
    const { rows } = await getPool().query<RiderPresenceRow>('SELECT * FROM rider_presence WHERE rider_id = $1', [riderId]);
    return rows[0] ? rowToRider(rows[0]) : undefined;
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
