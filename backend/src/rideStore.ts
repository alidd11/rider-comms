import { randomUUID } from 'node:crypto';
import {
  createRideCodeRecord,
  isRideCodeExpired,
  SlidingWindowRateLimiter,
} from '@rider-comms/shared';
import type { RideCodeRecord } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

export interface Ride {
  id: string;
  createdBy: string;
  createdAt: number;
  memberIds: Set<string>;
}

export type JoinRideResult =
  | { ok: true; rideId: string }
  | { ok: false; reason: 'rate_limited' | 'invalid_or_expired' | 'ride_full' };

// Product rule: a private ride group is 2-20 riders. The lower bound isn't
// something to reject on — a ride starts at 1 member (the creator) until
// someone joins, that's just bootstrapping, not a violation. Only the upper
// bound needs active enforcement.
const MAX_RIDE_MEMBERS = 20;

export type RideActionResult =
  | { ok: true; ride: Ride }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_member' | 'location_sharing_disabled' };

export interface RideMemberLocation {
  riderId: string;
  lat: number;
  lon: number;
  updatedAt: number;
}

export type RideLocationsResult =
  | { ok: true; locations: RideMemberLocation[] }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_member' | 'location_sharing_disabled' };

const RIDE_LOCATION_MAX_AGE_MS = 30_000;

interface RideRow {
  id: string;
  created_by: string;
  created_at: string | number;
}

interface RideCodeRow {
  code: string;
  ride_id: string;
  created_at: string | number;
  expires_at: string | number;
}

function rowToCodeRecord(row: RideCodeRow): RideCodeRecord {
  return {
    code: row.code,
    rideId: row.ride_id,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  };
}

/**
 * Private ride groups (Section 5 of the spec): create a ride, get a code,
 * others join with it. Join attempts are rate-limited (Section 13 — a ride
 * code is effectively a password to a live voice room) and an invalid code
 * and an expired code return the identical response, so a guesser can't
 * use the response to tell a near-miss from a stale one.
 *
 * Persisted in Postgres (see db.ts): `rides` + `ride_members` (one row per
 * member, rather than the in-memory Set) + `ride_codes`. Rate limiters stay
 * in-process — they're a per-request-burst defense, not durable state.
 */
export class RideStore {
  private riderJoinLimiter: SlidingWindowRateLimiter;
  private ipJoinLimiter: SlidingWindowRateLimiter;

  constructor(maxJoinAttempts = 5, windowMs = 60_000) {
    this.riderJoinLimiter = new SlidingWindowRateLimiter(maxJoinAttempts, windowMs);
    this.ipJoinLimiter = new SlidingWindowRateLimiter(maxJoinAttempts * 4, windowMs);
  }

  private async loadRide(rideId: string): Promise<Ride | undefined> {
    const pool = getPool();
    const { rows } = await pool.query<RideRow>('SELECT * FROM rides WHERE id = $1', [rideId]);
    if (!rows[0]) return undefined;
    const { rows: memberRows } = await pool.query<{ rider_id: string }>(
      'SELECT rider_id FROM ride_members WHERE ride_id = $1',
      [rideId]
    );
    return {
      id: rows[0].id,
      createdBy: rows[0].created_by,
      createdAt: Number(rows[0].created_at),
      memberIds: new Set(memberRows.map((row) => row.rider_id)),
    };
  }

  async createRide(creatorId: string): Promise<{ ride: Ride; codeRecord: RideCodeRecord }> {
    await ensureMigrated();
    const pool = getPool();
    const id = randomUUID();
    const createdAt = Date.now();
    await pool.query('INSERT INTO rides (id, created_by, created_at) VALUES ($1, $2, $3)', [id, creatorId, createdAt]);
    await pool.query('INSERT INTO ride_members (ride_id, rider_id) VALUES ($1, $2)', [id, creatorId]);

    let codeRecord = createRideCodeRecord(id);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await pool.query(
          'INSERT INTO ride_codes (code, ride_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
          [codeRecord.code, codeRecord.rideId, codeRecord.createdAt, codeRecord.expiresAt]
        );
        break;
      } catch (error) {
        // Unique-violation on `code` (astronomically rare, 30 bits of
        // entropy) — regenerate and retry, same as the in-memory
        // `while (this.codesByValue.has(...))` loop this replaces.
        if ((error as { code?: string }).code !== '23505') throw error;
        codeRecord = createRideCodeRecord(id);
      }
    }

    const ride: Ride = { id, createdBy: creatorId, createdAt, memberIds: new Set([creatorId]) };
    return { ride, codeRecord };
  }

  async joinRide(code: string, riderId: string, rateLimitKey: string): Promise<JoinRideResult> {
    if (!this.riderJoinLimiter.tryConsume(riderId) || !this.ipJoinLimiter.tryConsume(rateLimitKey)) {
      return { ok: false, reason: 'rate_limited' };
    }

    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<RideCodeRow>('SELECT * FROM ride_codes WHERE code = $1', [code.toUpperCase()]);
    if (!rows[0]) return { ok: false, reason: 'invalid_or_expired' };
    const record = rowToCodeRecord(rows[0]);
    if (isRideCodeExpired(record)) return { ok: false, reason: 'invalid_or_expired' };

    const ride = await this.loadRide(record.rideId);
    if (!ride) return { ok: false, reason: 'invalid_or_expired' };

    if (!ride.memberIds.has(riderId) && ride.memberIds.size >= MAX_RIDE_MEMBERS) {
      return { ok: false, reason: 'ride_full' };
    }

    await pool.query(
      'INSERT INTO ride_members (ride_id, rider_id) VALUES ($1, $2) ON CONFLICT (ride_id, rider_id) DO NOTHING',
      [ride.id, riderId]
    );
    return { ok: true, rideId: ride.id };
  }

  async getRide(rideId: string): Promise<Ride | undefined> {
    await ensureMigrated();
    return this.loadRide(rideId);
  }

  async getRideForMember(rideId: string, riderId: string): Promise<RideActionResult> {
    await ensureMigrated();
    const ride = await this.loadRide(rideId);
    if (!ride) return { ok: false, reason: 'not_found' };
    if (!ride.memberIds.has(riderId)) return { ok: false, reason: 'not_member' };
    return { ok: true, ride };
  }

  async leaveRide(rideId: string, riderId: string): Promise<RideActionResult> {
    const result = await this.getRideForMember(rideId, riderId);
    if (!result.ok) return result;
    if (result.ride.createdBy === riderId) return { ok: false, reason: 'forbidden' };
    await getPool().query('DELETE FROM ride_members WHERE ride_id = $1 AND rider_id = $2', [rideId, riderId]);
    result.ride.memberIds.delete(riderId);
    return result;
  }

  async removeMember(rideId: string, actorId: string, memberId: string): Promise<RideActionResult> {
    await ensureMigrated();
    const ride = await this.loadRide(rideId);
    if (!ride) return { ok: false, reason: 'not_found' };
    if (ride.createdBy !== actorId || memberId === actorId) return { ok: false, reason: 'forbidden' };
    await getPool().query('DELETE FROM ride_members WHERE ride_id = $1 AND rider_id = $2', [rideId, memberId]);
    ride.memberIds.delete(memberId);
    return { ok: true, ride };
  }

  async setMemberLocationSharing(
    rideId: string,
    riderId: string,
    enabled: boolean
  ): Promise<RideActionResult> {
    const result = await this.getRideForMember(rideId, riderId);
    if (!result.ok) return result;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        'UPDATE ride_members SET location_sharing_enabled = $3 WHERE ride_id = $1 AND rider_id = $2 RETURNING rider_id',
        [rideId, riderId, enabled]
      );
      if (updated.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_member' };
      }
      if (!enabled) {
        await client.query('DELETE FROM ride_locations WHERE ride_id = $1 AND rider_id = $2', [rideId, riderId]);
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async endRide(rideId: string, actorId: string): Promise<RideActionResult> {
    await ensureMigrated();
    const ride = await this.loadRide(rideId);
    if (!ride) return { ok: false, reason: 'not_found' };
    if (ride.createdBy !== actorId) return { ok: false, reason: 'forbidden' };
    // ride_members and ride_codes cascade-delete with the ride row.
    await getPool().query('DELETE FROM rides WHERE id = $1', [rideId]);
    return { ok: true, ride };
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    const pool = getPool();
    await pool.query('DELETE FROM rides WHERE created_by = $1', [riderId]);
    await pool.query('DELETE FROM ride_members WHERE rider_id = $1', [riderId]);
  }

  /** Private-ride location is separate from public presence and requires
   * explicit, per-ride consent. Membership alone never enables upload. */
  async updateMemberLocation(rideId: string, riderId: string, lat: number, lon: number): Promise<RideActionResult> {
    const result = await this.getRideForMember(rideId, riderId);
    if (!result.ok) return result;
    const pool = getPool();
    const updated = await pool.query(
      `INSERT INTO ride_locations (ride_id, rider_id, lat, lon, updated_at)
       SELECT $1, $2, $3, $4, $5
       FROM ride_members
       WHERE ride_id = $1 AND rider_id = $2 AND location_sharing_enabled = TRUE
       ON CONFLICT (ride_id, rider_id)
       DO UPDATE SET lat = $3, lon = $4, updated_at = $5
       RETURNING rider_id`,
      [rideId, riderId, lat, lon, Date.now()]
    );
    if (updated.rowCount === 0) return { ok: false, reason: 'location_sharing_disabled' };
    return result;
  }

  async getMemberLocations(rideId: string, actorId: string): Promise<RideLocationsResult> {
    const result = await this.getRideForMember(rideId, actorId);
    if (!result.ok) return result;
    const pool = getPool();
    const freshSince = Date.now() - RIDE_LOCATION_MAX_AGE_MS;
    await pool.query('DELETE FROM ride_locations WHERE ride_id = $1 AND updated_at < $2', [rideId, freshSince]);
    const { rows } = await pool.query<{ rider_id: string; lat: number; lon: number; updated_at: string | number }>(
      `SELECT location.rider_id, location.lat, location.lon, location.updated_at
       FROM ride_locations location
       INNER JOIN ride_members member
         ON member.ride_id = location.ride_id
        AND member.rider_id = location.rider_id
       WHERE location.ride_id = $1
         AND member.location_sharing_enabled = TRUE
         AND location.updated_at >= $2
       ORDER BY location.rider_id ASC`,
      [rideId, freshSince]
    );
    return {
      ok: true,
      locations: rows.map((row) => ({ riderId: row.rider_id, lat: row.lat, lon: row.lon, updatedAt: Number(row.updated_at) })),
    };
  }
}
