import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
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
  voiceGeneration: number;
  memberIds: Set<string>;
}

export type JoinRideResult =
  | { ok: true; rideId: string }
  | { ok: false; reason: 'rate_limited' | 'invalid_or_expired' | 'ride_full' | 'excluded' };

// Product rule: a private ride group is 2-20 riders. The lower bound isn't
// something to reject on — a ride starts at 1 member (the creator) until
// someone joins, that's just bootstrapping, not a violation. Only the upper
// bound needs active enforcement.
const MAX_RIDE_MEMBERS = 20;

export type RideActionResult =
  | { ok: true; ride: Ride }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_member' | 'location_sharing_disabled' };

export type RemoveRideMemberResult =
  | { ok: true; ride: Ride; codeRecord: RideCodeRecord }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_member' };

export type RideVoiceTransition = (voiceGeneration: number) => Promise<void>;

export type RideVoiceAuthorizationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not_found' | 'not_member' };

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
  voice_generation: string | number;
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

async function reserveRideCode(client: Pick<PoolClient, 'query'>, rideId: string): Promise<RideCodeRecord> {
  // A conflict does not abort the transaction, unlike catching a unique
  // violation after a plain INSERT. Regenerate until a code is reserved.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const codeRecord = createRideCodeRecord(rideId);
    const inserted = await client.query(
      `INSERT INTO ride_codes (code, ride_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [codeRecord.code, codeRecord.rideId, codeRecord.createdAt, codeRecord.expiresAt],
    );
    if (inserted.rowCount) return codeRecord;
  }
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
      voiceGeneration: Number(rows[0].voice_generation),
      memberIds: new Set(memberRows.map((row) => row.rider_id)),
    };
  }

  async createRide(creatorId: string): Promise<{ ride: Ride; codeRecord: RideCodeRecord }> {
    await ensureMigrated();
    const client = await getPool().connect();
    const id = randomUUID();
    const createdAt = Date.now();
    let codeRecord: RideCodeRecord;
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO rides (id, created_by, created_at) VALUES ($1, $2, $3)', [id, creatorId, createdAt]);
      await client.query('INSERT INTO ride_members (ride_id, rider_id) VALUES ($1, $2)', [id, creatorId]);
      codeRecord = await reserveRideCode(client, id);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const ride: Ride = { id, createdBy: creatorId, createdAt, voiceGeneration: 1, memberIds: new Set([creatorId]) };
    return { ride, codeRecord };
  }

  async joinRide(code: string, riderId: string, rateLimitKey: string): Promise<JoinRideResult> {
    if (!this.riderJoinLimiter.tryConsume(riderId) || !this.ipJoinLimiter.tryConsume(rateLimitKey)) {
      return { ok: false, reason: 'rate_limited' };
    }

    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<RideCodeRow>(
        `SELECT code.* FROM ride_codes code
         INNER JOIN rides ride ON ride.id = code.ride_id
         WHERE code.code = $1
         FOR UPDATE OF ride`,
        [code.toUpperCase()]
      );
      if (!rows[0] || isRideCodeExpired(rowToCodeRecord(rows[0]))) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'invalid_or_expired' };
      }
      const rideId = rows[0].ride_id;
      const exclusion = await client.query(
        'SELECT 1 FROM ride_exclusions WHERE ride_id = $1 AND rider_id = $2',
        [rideId, riderId],
      );
      if (exclusion.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'excluded' };
      }
      const existing = await client.query(
        'SELECT 1 FROM ride_members WHERE ride_id = $1 AND rider_id = $2',
        [rideId, riderId]
      );
      if (!existing.rowCount) {
        const count = await client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM ride_members WHERE ride_id = $1',
          [rideId]
        );
        if (Number(count.rows[0]?.count ?? 0) >= MAX_RIDE_MEMBERS) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'ride_full' };
        }
        await client.query('INSERT INTO ride_members (ride_id, rider_id) VALUES ($1, $2)', [rideId, riderId]);
      }
      await client.query('COMMIT');
      return { ok: true, rideId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getRide(rideId: string): Promise<Ride | undefined> {
    await ensureMigrated();
    return this.loadRide(rideId);
  }

  async getVoiceCleanupTargetsForRider(riderId: string): Promise<{ hostedRideIds: string[]; memberRideIds: string[] }> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ id: string; created_by: string }>(
      `SELECT ride.id, ride.created_by
       FROM rides ride
       LEFT JOIN ride_members member
         ON member.ride_id = ride.id
        AND member.rider_id = $1
       WHERE ride.created_by = $1
          OR member.rider_id = $1
       ORDER BY ride.id`,
      [riderId],
    );
    return {
      hostedRideIds: rows.filter((row) => row.created_by === riderId).map((row) => row.id),
      memberRideIds: rows.filter((row) => row.created_by !== riderId).map((row) => row.id),
    };
  }

  async getCurrentCode(rideId: string): Promise<RideCodeRecord | undefined> {
    await ensureMigrated();
    const { rows } = await getPool().query<RideCodeRow>(
      'SELECT * FROM ride_codes WHERE ride_id = $1 ORDER BY created_at DESC LIMIT 1',
      [rideId],
    );
    if (!rows[0]) return undefined;
    const record = rowToCodeRecord(rows[0]);
    return isRideCodeExpired(record) ? undefined : record;
  }

  async getRideForMember(rideId: string, riderId: string): Promise<RideActionResult> {
    await ensureMigrated();
    const ride = await this.loadRide(rideId);
    if (!ride) return { ok: false, reason: 'not_found' };
    if (!ride.memberIds.has(riderId)) return { ok: false, reason: 'not_member' };
    return { ok: true, ride };
  }

  /**
   * Authorises and mints a private-ride voice credential while holding a
   * shared lock on the ride row. Membership-changing voice transitions take
   * an exclusive lock on the same row, so Rider Comms cannot issue a token
   * for the retiring generation concurrently with remove/leave/end.
   */
  async withVoiceAuthorization<T>(
    rideId: string,
    riderId: string,
    authorise: (voiceGeneration: number) => Promise<T>,
  ): Promise<RideVoiceAuthorizationResult<T>> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<RideRow>(
        'SELECT * FROM rides WHERE id = $1 FOR SHARE',
        [rideId],
      );
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_found' };
      }
      const member = await client.query(
        'SELECT 1 FROM ride_members WHERE ride_id = $1 AND rider_id = $2',
        [rideId, riderId],
      );
      if (!member.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_member' };
      }
      const value = await authorise(Number(row.voice_generation));
      await client.query('COMMIT');
      return { ok: true, value };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async leaveRide(
    rideId: string,
    riderId: string,
    retireVoiceRoom?: RideVoiceTransition,
  ): Promise<RideActionResult> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<RideRow>(
        'SELECT * FROM rides WHERE id = $1 FOR UPDATE',
        [rideId],
      );
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_found' };
      }
      if (row.created_by === riderId) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'forbidden' };
      }
      const member = await client.query(
        'SELECT 1 FROM ride_members WHERE ride_id = $1 AND rider_id = $2',
        [rideId, riderId],
      );
      if (!member.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_member' };
      }

      await retireVoiceRoom?.(Number(row.voice_generation));
      await client.query('DELETE FROM ride_members WHERE ride_id = $1 AND rider_id = $2', [rideId, riderId]);
      const generation = await client.query<{ voice_generation: string | number }>(
        'UPDATE rides SET voice_generation = voice_generation + 1 WHERE id = $1 RETURNING voice_generation',
        [rideId],
      );
      const { rows: memberRows } = await client.query<{ rider_id: string }>(
        'SELECT rider_id FROM ride_members WHERE ride_id = $1 ORDER BY rider_id',
        [rideId],
      );
      await client.query('COMMIT');
      return {
        ok: true,
        ride: {
          id: row.id,
          createdBy: row.created_by,
          createdAt: Number(row.created_at),
          voiceGeneration: Number(generation.rows[0]?.voice_generation),
          memberIds: new Set(memberRows.map((entry) => entry.rider_id)),
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async removeMember(
    rideId: string,
    actorId: string,
    memberId: string,
    retireVoiceRoom?: RideVoiceTransition,
  ): Promise<RemoveRideMemberResult> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<RideRow>(
        'SELECT * FROM rides WHERE id = $1 FOR UPDATE',
        [rideId],
      );
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_found' };
      }
      if (row.created_by !== actorId || memberId === actorId) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'forbidden' };
      }

      const member = await client.query(
        'SELECT 1 FROM ride_members WHERE ride_id = $1 AND rider_id = $2',
        [rideId, memberId],
      );
      if (!member.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_member' };
      }

      await retireVoiceRoom?.(Number(row.voice_generation));

      await client.query(
        `INSERT INTO ride_exclusions (ride_id, rider_id, removed_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (ride_id, rider_id)
         DO UPDATE SET removed_at = EXCLUDED.removed_at`,
        [rideId, memberId, Date.now()],
      );
      await client.query('DELETE FROM ride_members WHERE ride_id = $1 AND rider_id = $2', [rideId, memberId]);

      // A removed rider knows the old invitation code. Rotate it in the same
      // transaction as exclusion/membership teardown so a successful remove
      // can never leave a reusable shared secret behind.
      await client.query('DELETE FROM ride_codes WHERE ride_id = $1', [rideId]);
      const codeRecord = await reserveRideCode(client, rideId);
      const generation = await client.query<{ voice_generation: string | number }>(
        'UPDATE rides SET voice_generation = voice_generation + 1 WHERE id = $1 RETURNING voice_generation',
        [rideId],
      );

      const { rows: memberRows } = await client.query<{ rider_id: string }>(
        'SELECT rider_id FROM ride_members WHERE ride_id = $1 ORDER BY rider_id',
        [rideId],
      );
      await client.query('COMMIT');
      return {
        ok: true,
        ride: {
          id: row.id,
          createdBy: row.created_by,
          createdAt: Number(row.created_at),
          voiceGeneration: Number(generation.rows[0]?.voice_generation),
          memberIds: new Set(memberRows.map((entry) => entry.rider_id)),
        },
        codeRecord,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

  async endRide(
    rideId: string,
    actorId: string,
    retireVoiceRoom?: RideVoiceTransition,
  ): Promise<RideActionResult> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<RideRow>(
        'SELECT * FROM rides WHERE id = $1 FOR UPDATE',
        [rideId],
      );
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_found' };
      }
      if (row.created_by !== actorId) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'forbidden' };
      }
      const { rows: memberRows } = await client.query<{ rider_id: string }>(
        'SELECT rider_id FROM ride_members WHERE ride_id = $1',
        [rideId],
      );
      await retireVoiceRoom?.(Number(row.voice_generation));
      await client.query('DELETE FROM rides WHERE id = $1', [rideId]);
      await client.query('COMMIT');
      return {
        ok: true,
        ride: {
          id: row.id,
          createdBy: row.created_by,
          createdAt: Number(row.created_at),
          voiceGeneration: Number(row.voice_generation),
          memberIds: new Set(memberRows.map((entry) => entry.rider_id)),
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
