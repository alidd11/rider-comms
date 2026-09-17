import { computeZonePairs } from '@rider-comms/shared';
import type { Rider, ZonePair, ZoneTransition } from '@rider-comms/shared';
import type { PoolClient } from 'pg';
import { ensureMigrated, getPool } from './db.ts';

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
const MILES_PER_DEGREE_LAT = 69;

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
    const latDelta = MAX_ZONE_RADIUS_MILES / MILES_PER_DEGREE_LAT;
    const minLat = Math.max(-90, rider.location.lat - latDelta);
    const maxLat = Math.min(90, rider.location.lat + latDelta);
    const longitudeScale = MILES_PER_DEGREE_LAT * Math.abs(Math.cos(rider.location.lat * Math.PI / 180));
    const lonDelta = longitudeScale < 0.000001
      ? 180
      : Math.min(180, MAX_ZONE_RADIUS_MILES / longitudeScale);

    const values: unknown[] = [rider.id, cutoff, minLat, maxLat];
    let longitudeClause = '';
    if (lonDelta < 180) {
      const minLon = rider.location.lon - lonDelta;
      const maxLon = rider.location.lon + lonDelta;
      if (minLon < -180) {
        values.push(minLon + 360, maxLon);
        longitudeClause = 'AND (lon >= $5 OR lon <= $6)';
      } else if (maxLon > 180) {
        values.push(minLon, maxLon - 360);
        longitudeClause = 'AND (lon >= $5 OR lon <= $6)';
      } else {
        values.push(minLon, maxLon);
        longitudeClause = 'AND lon BETWEEN $5 AND $6';
      }
    }

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
    await ensureMigrated();
    const client = await getPool().connect();
    const cutoff = rider.updatedAt - this.staleAfterMs;
    try {
      await client.query('BEGIN');

      const stalePairs = await client.query<PairRow>(
        `SELECT DISTINCT pair.rider_a, pair.rider_b
         FROM presence_zone_pairs pair
         JOIN rider_presence presence
           ON presence.rider_id = pair.rider_a OR presence.rider_id = pair.rider_b
         WHERE presence.updated_at < $1`,
        [cutoff]
      );
      await client.query('DELETE FROM rider_presence WHERE updated_at < $1', [cutoff]);

      const accepted = await client.query(
        `INSERT INTO rider_presence
           (rider_id, lat, lon, radius_miles, accuracy_meters, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (rider_id) DO UPDATE SET
           lat = EXCLUDED.lat,
           lon = EXCLUDED.lon,
           radius_miles = EXCLUDED.radius_miles,
           accuracy_meters = EXCLUDED.accuracy_meters,
           updated_at = EXCLUDED.updated_at
         WHERE rider_presence.updated_at < EXCLUDED.updated_at
         RETURNING rider_id`,
        [rider.id, rider.location.lat, rider.location.lon, rider.radiusMiles, rider.accuracyMeters ?? 0, rider.updatedAt]
      );
      if (accepted.rowCount !== 1) throw new StaleLocationFixError();

      const candidates = await this.loadCandidates(client, rider, cutoff);
      const desiredPairs = computeZonePairs([rider, ...candidates])
        .filter((pair) => pair.a === rider.id || pair.b === rider.id)
        .map(canonicalPair);
      const desiredKeys = new Set(desiredPairs.map(pairKey));

      const existing = await client.query<PairRow>(
        `SELECT rider_a, rider_b FROM presence_zone_pairs
         WHERE rider_a = $1 OR rider_b = $1`,
        [rider.id]
      );
      const transitions: ZoneTransition[] = stalePairs.rows
        .filter((pair) => pair.rider_a === rider.id || pair.rider_b === rider.id)
        .map((pair) => ({ ...pairToZonePair(pair), type: 'left' as const }));

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

      for (const pair of desiredPairs) {
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

  ridersInZoneWith(riderId: string, zonePairs: ZonePair[]): string[] {
    const partners: string[] = [];
    for (const pair of zonePairs) {
      if (pair.a === riderId) partners.push(pair.b);
      if (pair.b === riderId) partners.push(pair.a);
    }
    return partners;
  }
}
