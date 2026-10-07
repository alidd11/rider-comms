import { computeZonePairsFor, haversineMeters, ZONE_EXIT_HYSTERESIS } from '@rider-comms/shared';
import type { Rider, ZonePair, ZoneTransition } from '@rider-comms/shared';
import type { PoolClient } from 'pg';
import { ensureMigrated, getPool } from './db.ts';
import { latLonBoundingBox } from './geoBoundingBox.ts';

export interface PresenceUpdateResult {
  transitions: ZoneTransition[];
  zonePairs: ZonePair[];
}

export class StaleLocationFixError extends Error {
  constructor() {
    super('location fix is older than the last accepted fix');
    this.name = 'StaleLocationFixError';
  }
}

/** 250 mph. Faster than any rider travels on the road, so a larger jump
 * between two fixes is a faked or corrupt position. */
export const MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND = 111.76;
/** A previous fix older than this is not compared against, so a rider who
 * flies or takes a long break is not locked out when they go live again. */
export const MOVEMENT_ANCHOR_WINDOW_MS = 30 * 60_000;
/** Allowance for GPS error at short intervals: two fixes at the backend's
 * 100 m accuracy cap can disagree by up to 200 m without the rider moving. */
export const MOVEMENT_JUMP_SLACK_METERS = 200;

/**
 * Thrown when a presence fix is too far from the rider's previous fix for
 * the time between them. Without this check, anyone signed in could submit
 * fabricated positions and use the in-zone replies to locate other riders.
 */
export class ImplausibleLocationJumpError extends Error {
  constructor() {
    super('location fix is implausibly far from the previous fix');
    this.name = 'ImplausibleLocationJumpError';
  }
}

interface AnchorRow {
  lat: number;
  lon: number;
  recorded_at: string | number;
}

interface PresenceFix extends Rider {
  accuracyMeters?: number;
}

interface RiderPresenceRow {
  rider_id: string;
  lat: number;
  lon: number;
  radius_miles: number;
  accuracy_meters: number;
  updated_at: string | number;
}

interface PairRow {
  rider_a: string;
  rider_b: string;
}

const MAX_ZONE_RADIUS_MILES = 20;
const DEADLOCK_DETECTED = '40P01';
const SERIALIZATION_FAILURE = '40001';
const MAX_PRESENCE_ATTEMPTS = 3;

function rowToRider(row: RiderPresenceRow): Rider {
  return {
    id: row.rider_id,
    location: { lat: Number(row.lat), lon: Number(row.lon) },
    radiusMiles: Number(row.radius_miles),
    updatedAt: Number(row.updated_at),
  };
}

function canonicalPair(pair: ZonePair): ZonePair {
  return pair.a < pair.b ? pair : { a: pair.b, b: pair.a, distanceMiles: pair.distanceMiles };
}

function pairKey(pair: ZonePair): string {
  return `${pair.a}\u0000${pair.b}`;
}

function pairToZonePair(row: PairRow): ZonePair {
  return { a: row.rider_a, b: row.rider_b, distanceMiles: 0 };
}

/**
 * Public nearby-rider presence. Candidate selection is performed by an
 * indexed latitude/longitude bounding query and then verified with the
 * shared great-circle matcher. The database stores the current pair set,
 * so enter/leave transitions survive restarts and behave consistently
 * across replicas.
 */
export class PresenceStore {
  private readonly staleAfterMs: number;

  constructor(staleAfterMs = 30_000) {
    this.staleAfterMs = staleAfterMs;
  }

  private async loadCandidates(client: PoolClient, rider: Rider, cutoff: number): Promise<Rider[]> {
    const box = latLonBoundingBox(rider.location, MAX_ZONE_RADIUS_MILES * ZONE_EXIT_HYSTERESIS, 5);
    const { minLat, maxLat, longitudeClause } = box;
    const values: unknown[] = [rider.id, cutoff, minLat, maxLat, ...box.longitudeParams];

    const { rows } = await client.query<RiderPresenceRow>(
      `SELECT rider_id, lat, lon, radius_miles, accuracy_meters, updated_at
       FROM rider_presence
       WHERE rider_id <> $1
         AND updated_at >= $2
         AND lat BETWEEN $3 AND $4
         ${longitudeClause}`,
      values
    );
    return rows.map(rowToRider);
  }

  async zoneCandidates(rider: Rider): Promise<Rider[]> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      return await this.loadCandidates(client, rider, rider.updatedAt - this.staleAfterMs);
    } finally {
      client.release();
    }
  }

  async updatePresence(rider: PresenceFix): Promise<PresenceUpdateResult> {
    // Lock ordering makes deadlocks unlikely, but Postgres may still pick a
    // victim under heavy contention; the transaction is safe to replay.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.updatePresenceOnce(rider);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if ((code === DEADLOCK_DETECTED || code === SERIALIZATION_FAILURE) && attempt < MAX_PRESENCE_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  private async updatePresenceOnce(rider: PresenceFix): Promise<PresenceUpdateResult> {
    await ensureMigrated();
    const client = await getPool().connect();
    const cutoff = rider.updatedAt - this.staleAfterMs;
    try {
      await client.query('BEGIN');

      // This transaction only touches the updating rider's own rows and
      // pairs. Deleting every stale row here (as it once did) made
      // concurrent updates lock each other's rows and deadlock under a busy
      // group ride. Stale rows are ignored by every read (cutoff filters),
      // their pairs are removed below as "left", and the retention sweep
      // deletes them.

      // Speed gate against the last accepted fix (kept longer than the
      // presence lease, see migration 0038). The row lock serialises
      // concurrent fixes from the same rider.
      const anchor = await client.query<AnchorRow>(
        'SELECT lat, lon, recorded_at FROM presence_movement_anchors WHERE rider_id = $1 FOR UPDATE',
        [rider.id]
      );
      const previous = anchor.rows[0];
      if (previous) {
        const elapsedMs = rider.updatedAt - Number(previous.recorded_at);
        if (elapsedMs < 0) throw new StaleLocationFixError();
        if (elapsedMs <= MOVEMENT_ANCHOR_WINDOW_MS) {
          const movedMeters = haversineMeters(
            { lat: Number(previous.lat), lon: Number(previous.lon) },
            rider.location,
          );
          const allowedMeters = MAX_PLAUSIBLE_SPEED_METERS_PER_SECOND * (elapsedMs / 1000) + MOVEMENT_JUMP_SLACK_METERS;
          if (movedMeters > allowedMeters) throw new ImplausibleLocationJumpError();
        }
      }

      // A plain UPDATE of non-key columns takes a FOR NO KEY UPDATE row lock,
      // which doesn't block the KEY SHARE locks that other riders' pair
      // inserts take on this row through the foreign key. INSERT ... ON
      // CONFLICT DO UPDATE takes a full FOR UPDATE lock and caused
      // rider-A-waits-for-B, B-waits-for-A deadlocks.
      const fixValues = [rider.id, rider.location.lat, rider.location.lon, rider.radiusMiles, rider.accuracyMeters ?? 0, rider.updatedAt];
      let accepted = await client.query(
        `UPDATE rider_presence
         SET lat = $2, lon = $3, radius_miles = $4, accuracy_meters = $5, updated_at = $6
         WHERE rider_id = $1 AND updated_at < $6
         RETURNING rider_id`,
        fixValues
      );
      if (accepted.rowCount !== 1) {
        accepted = await client.query(
          `INSERT INTO rider_presence (rider_id, lat, lon, radius_miles, accuracy_meters, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (rider_id) DO NOTHING
           RETURNING rider_id`,
          fixValues
        );
      }
      // Neither updated nor inserted: a newer fix is already stored.
      if (accepted.rowCount !== 1) throw new StaleLocationFixError();
      await client.query(
        `INSERT INTO presence_movement_anchors (rider_id, lat, lon, recorded_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (rider_id) DO UPDATE SET
           lat = EXCLUDED.lat, lon = EXCLUDED.lon, recorded_at = EXCLUDED.recorded_at`,
        [rider.id, rider.location.lat, rider.location.lon, rider.updatedAt]
      );

      const existing = await client.query<PairRow>(
        `SELECT rider_a, rider_b FROM presence_zone_pairs
         WHERE rider_a = $1 OR rider_b = $1`,
        [rider.id]
      );
      const currentPartnerIds = new Set(existing.rows.map((row) => (row.rider_a === rider.id ? row.rider_b : row.rider_a)));
      const candidates = await this.loadCandidates(client, rider, cutoff);
      // Existing pairs get a little extra range before they drop (see
      // ZONE_EXIT_HYSTERESIS), so riders at the edge don't flicker in and out.
      const desiredPairs = computeZonePairsFor(rider, candidates, currentPartnerIds).map(canonicalPair);
      const desiredKeys = new Set(desiredPairs.map(pairKey));
      const transitions: ZoneTransition[] = [];

      // Pair rows are always locked in one global order (by key), so two
      // riders updating at once can never wait on each other in a cycle.
      // Plain code-unit comparison: cheaper than localeCompare and the same
      // order on every replica regardless of locale.
      const byKey = (left: ZonePair, right: ZonePair) => {
        const l = pairKey(left);
        const r = pairKey(right);
        return l < r ? -1 : l > r ? 1 : 0;
      };
      existing.rows.sort((left, right) => byKey(pairToZonePair(left), pairToZonePair(right)));
      desiredPairs.sort(byKey);

      for (const row of existing.rows) {
        const pair = pairToZonePair(row);
        if (desiredKeys.has(pairKey(pair))) continue;
        const removed = await client.query(
          `DELETE FROM presence_zone_pairs
           WHERE rider_a = $1 AND rider_b = $2
           RETURNING rider_a`,
          [pair.a, pair.b]
        );
        if (removed.rowCount === 1) transitions.push({ ...pair, type: 'left' });
      }

      // Only pairs that are new need a write. Re-inserting every existing
      // pair cost one round trip per nearby rider on every fix, which
      // exhausted the connection pool when hundreds of riders were close
      // together (see LOAD_TESTING.md). If a partner deletes a pair between
      // our read and commit, the next fix (8 s later) recreates it.
      const existingKeys = new Set(existing.rows.map((row) => pairKey(pairToZonePair(row))));
      for (const pair of desiredPairs) {
        if (existingKeys.has(pairKey(pair))) continue;
        const inserted = await client.query(
          `INSERT INTO presence_zone_pairs (rider_a, rider_b, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (rider_a, rider_b) DO NOTHING
           RETURNING rider_a`,
          [pair.a, pair.b, rider.updatedAt]
        );
        if (inserted.rowCount === 1) transitions.push({ ...pair, type: 'entered' });
      }

      await client.query('COMMIT');
      return { transitions, zonePairs: desiredPairs };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async removeRider(riderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM rider_presence WHERE rider_id = $1', [riderId]);
  }

  async getRider(riderId: string): Promise<Rider | undefined> {
    await ensureMigrated();
    const { rows } = await getPool().query<RiderPresenceRow>(
      `SELECT rider_id, lat, lon, radius_miles, accuracy_meters, updated_at
       FROM rider_presence WHERE rider_id = $1`,
      [riderId]
    );
    return rows[0] ? rowToRider(rows[0]) : undefined;
  }

  /** Every rider this rider is paired with, fresh or not: the set whose
   * Nearby Voice pair rooms may still hold a connection. */
  async getPairedRiderIds(riderId: string): Promise<string[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ peer_id: string }>(
      `SELECT CASE WHEN rider_a = $1 THEN rider_b ELSE rider_a END AS peer_id
       FROM presence_zone_pairs WHERE rider_a = $1 OR rider_b = $1 ORDER BY peer_id`,
      [riderId],
    );
    return rows.map((row) => row.peer_id);
  }

  /** Returns only current, mutually matched proximity peers. The pair table
   * is the durable authorisation source and both endpoints must still have a
   * fresh presence fix before voice credentials can be minted. */
  async getCurrentPeerIds(riderId: string, now = Date.now(), maxFixAgeMs = 0): Promise<string[]> {
    await ensureMigrated();
    // updated_at is when the fix was taken, which can already be up to
    // maxFixAgeMs old when the server accepts it; allow for that so a fresh
    // update doesn't count as stale moments later.
    const cutoff = now - this.staleAfterMs - Math.max(0, maxFixAgeMs);
    const { rows } = await getPool().query<{ peer_id: string }>(
      `SELECT CASE WHEN pair.rider_a = $1 THEN pair.rider_b ELSE pair.rider_a END AS peer_id
       FROM presence_zone_pairs pair
       JOIN rider_presence actor ON actor.rider_id = $1 AND actor.updated_at >= $2
       JOIN rider_presence peer
         ON peer.rider_id = CASE WHEN pair.rider_a = $1 THEN pair.rider_b ELSE pair.rider_a END
        AND peer.updated_at >= $2
       WHERE pair.rider_a = $1 OR pair.rider_b = $1
       ORDER BY peer_id`,
      [riderId, cutoff]
    );
    return rows.map((row) => row.peer_id);
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
