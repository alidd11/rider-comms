import { randomUUID } from 'node:crypto';
import {
  RIDE_CODE_IDLE_TTL_MS,
  createRideCodeRecord,
  isRideCodeExpired,
} from '@rider-comms/shared';
import type { RegroupPoint, RideCodeRecord } from '@rider-comms/shared';
import { ensureMigrated, getPool, withTransaction } from './db.ts';

export interface Ride {
  id: string;
  createdBy: string;
  createdAt: number;
  memberIds: Set<string>;
  regroup: RegroupPoint | null;
}

export interface RideSession {
  ride: Ride;
  shareRideLocation: boolean;
  code: string | null;
}

export type JoinRideResult =
  | { ok: true; rideId: string }
  | { ok: false; reason: 'invalid_or_expired' | 'ride_full' | 'removed_by_host' };

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
  /** Present (true) only while the rider's phone battery is nearly flat. */
  batteryLow?: true;
}

export type RideLocationsResult =
  | { ok: true; locations: RideMemberLocation[] }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_member' | 'location_sharing_disabled' };

export type RideLocationUpdateResult =
  | { ok: true; ride: Ride; locations: RideMemberLocation[] }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_member' | 'location_sharing_disabled' };

/** How long a member's last position stays visible to the ride after their
 * updates stop (lost signal, phone locked), so the group can see where they
 * were last seen. Turning sharing off or leaving deletes it straight away. */
export const RIDE_LOCATION_LAST_SEEN_MS = 10 * 60 * 1000;
/** Slide the invite code forward at most this often, not on every poll. */
const RIDE_CODE_SLIDE_STEP_MS = 10 * 60 * 1000;

interface RideRow {
  id: string;
  created_by: string;
  created_at: string | number;
  regroup_lat: number | null;
  regroup_lon: number | null;
  regroup_label: string | null;
  regroup_set_at: string | number | null;
}

function regroupFromRow(row: RideRow): RegroupPoint | null {
  if (row.regroup_lat === null || row.regroup_lon === null || row.regroup_set_at === null) return null;
  return { lat: row.regroup_lat, lon: row.regroup_lon, label: row.regroup_label ?? '', setAt: Number(row.regroup_set_at) };
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
 * others join with it. The HTTP security boundary rate-limits join attempts
 * durably by both authenticated rider and client address (Section 13 — a ride
 * code is effectively a password to a live voice room). An invalid code and
 * an expired code return the identical response, so a guesser can't use the
 * response to tell a near-miss from a stale one.
 *
 * Persisted in Postgres (see db.ts): `rides` + `ride_members` (one row per
 * member, rather than the in-memory Set) + `ride_codes`.
 */
/** Pushes a still-valid invite code's expiry to 12 hours from now. */
async function slideRideCode(db: { query: (sql: string, values: unknown[]) => Promise<unknown> }, rideId: string): Promise<void> {
  const now = Date.now();
  await db.query(
    `UPDATE ride_codes SET expires_at = $2
     WHERE ride_id = $1 AND expires_at > $3 AND expires_at < $4`,
    [rideId, now + RIDE_CODE_IDLE_TTL_MS, now, now + RIDE_CODE_IDLE_TTL_MS - RIDE_CODE_SLIDE_STEP_MS]
  );
}

export class RideStore {

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
      regroup: regroupFromRow(rows[0]),
    };
  }

  async createRide(creatorId: string): Promise<{ ride: Ride; codeRecord: RideCodeRecord }> {
    await ensureMigrated();
    const id = randomUUID();
    const createdAt = Date.now();
    let codeRecord = createRideCodeRecord(id);
    await withTransaction(async (client) => {
      await client.query('INSERT INTO rides (id, created_by, created_at) VALUES ($1, $2, $3)', [id, creatorId, createdAt]);
      await client.query('INSERT INTO ride_members (ride_id, rider_id) VALUES ($1, $2)', [id, creatorId]);

      // A conflict does not abort the transaction, unlike catching a unique
      // violation after a plain INSERT. Regenerate until a code is reserved.
      while (true) {
        const inserted = await client.query(
          `INSERT INTO ride_codes (code, ride_id, created_at, expires_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (code) DO NOTHING
           RETURNING code`,
          [codeRecord.code, codeRecord.rideId, codeRecord.createdAt, codeRecord.expiresAt]
        );
        if (inserted.rowCount) break;
        codeRecord = createRideCodeRecord(id);
      }
    });

    const ride: Ride = { id, createdBy: creatorId, createdAt, memberIds: new Set([creatorId]), regroup: null };
    return { ride, codeRecord };
  }

  async joinRide(code: string, riderId: string): Promise<JoinRideResult> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const { rows } = await client.query<RideCodeRow>(
        `SELECT code.* FROM ride_codes code
         INNER JOIN rides ride ON ride.id = code.ride_id
         WHERE code.code = $1
         FOR UPDATE OF ride`,
        [code.toUpperCase()]
      );
      if (!rows[0] || isRideCodeExpired(rowToCodeRecord(rows[0]))) {
        return { ok: false, reason: 'invalid_or_expired' };
      }
      const rideId = rows[0].ride_id;
      // Removal is a host decision; the code they already have doesn't undo it.
      const removed = await client.query(
        'SELECT 1 FROM ride_removed_members WHERE ride_id = $1 AND rider_id = $2',
        [rideId, riderId]
      );
      if (removed.rowCount) return { ok: false, reason: 'removed_by_host' };
      // A block either way between the joiner and anyone already riding
      // keeps them apart. The joiner hears the same answer as a wrong code,
      // so the block itself is never revealed.
      const blocked = await client.query(
        `SELECT 1 FROM ride_members member
         INNER JOIN rider_blocks block
           ON (block.rider_id = $2 AND block.blocked_rider_id = member.rider_id)
           OR (block.rider_id = member.rider_id AND block.blocked_rider_id = $2)
         WHERE member.ride_id = $1 AND member.rider_id <> $2
         LIMIT 1`,
        [rideId, riderId]
      );
      if (blocked.rowCount) return { ok: false, reason: 'invalid_or_expired' };
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
          return { ok: false, reason: 'ride_full' };
        }
        await client.query('INSERT INTO ride_members (ride_id, rider_id) VALUES ($1, $2)', [rideId, riderId]);
      }
      await slideRideCode(client, rideId);
      return { ok: true, rideId };
    });
  }

  /** Ride activity that isn't a read of the ride (location, voice) keeps it alive too. */
  async keepRideActive(rideId: string): Promise<void> {
    await ensureMigrated();
    await slideRideCode(getPool(), rideId);
  }

  async getRide(rideId: string): Promise<Ride | undefined> {
    await ensureMigrated();
    return this.loadRide(rideId);
  }

  async getSharedRideIds(riderA: string, riderB: string): Promise<string[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ ride_id: string }>(
      `SELECT a.ride_id
       FROM ride_members a
       INNER JOIN ride_members b ON b.ride_id = a.ride_id
       WHERE a.rider_id = $1 AND b.rider_id = $2
       ORDER BY a.ride_id`,
      [riderA, riderB],
    );
    return rows.map((row) => row.ride_id);
  }

  /** Every ride the rider is a member of (they can belong to several). */
  async getRideIdsForMember(riderId: string): Promise<string[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ ride_id: string }>(
      'SELECT ride_id FROM ride_members WHERE rider_id = $1 ORDER BY ride_id',
      [riderId],
    );
    return rows.map((row) => row.ride_id);
  }

  async getRideForMember(rideId: string, riderId: string): Promise<RideActionResult> {
    await ensureMigrated();
    const ride = await this.loadRide(rideId);
    if (!ride) return { ok: false, reason: 'not_found' };
    if (!ride.memberIds.has(riderId)) return { ok: false, reason: 'not_member' };
    return { ok: true, ride };
  }

  /** Reconcile foreground clients from membership and consent stored in the
   * database. Never infer private location consent from cached UI state. */
  async getMemberRideSession(rideId: string, riderId: string): Promise<RideSession | null> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ location_sharing_enabled: boolean; code: string | null }>(
      `SELECT member.location_sharing_enabled, (
         SELECT code.code FROM ride_codes code
         WHERE code.ride_id = member.ride_id AND code.expires_at > $3
         ORDER BY code.expires_at DESC LIMIT 1
       ) AS code
       FROM ride_members member WHERE member.ride_id = $1 AND member.rider_id = $2`,
      [rideId, riderId, Date.now()]
    );
    if (!rows[0]) return null;
    // Members' apps read this while the ride is in use, which keeps the
    // invite code alive: it lapses only after 12 idle hours.
    if (rows[0].code) await slideRideCode(getPool(), rideId);
    const ride = await this.loadRide(rideId);
    return ride?.memberIds.has(riderId) ? {
      ride, shareRideLocation: rows[0].location_sharing_enabled, code: rows[0].code,
    } : null;
  }

  async getCurrentRideForMember(riderId: string): Promise<RideSession | null> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ ride_id: string }>(
      `SELECT member.ride_id FROM ride_members member
       INNER JOIN rides ride ON ride.id = member.ride_id
       WHERE member.rider_id = $1 ORDER BY ride.created_at DESC, ride.id DESC LIMIT 1`,
      [riderId]
    );
    return rows[0] ? this.getMemberRideSession(rows[0].ride_id, riderId) : null;
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
    await withTransaction(async (client) => {
      await client.query('DELETE FROM ride_members WHERE ride_id = $1 AND rider_id = $2', [rideId, memberId]);
      await client.query('DELETE FROM ride_locations WHERE ride_id = $1 AND rider_id = $2', [rideId, memberId]);
      await client.query(
        `INSERT INTO ride_removed_members (ride_id, rider_id, removed_at) VALUES ($1, $2, $3)
         ON CONFLICT (ride_id, rider_id) DO NOTHING`,
        [rideId, memberId, Date.now()]
      );
    });
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
    return withTransaction(async (client) => {
      const updated = await client.query(
        'UPDATE ride_members SET location_sharing_enabled = $3 WHERE ride_id = $1 AND rider_id = $2 RETURNING rider_id',
        [rideId, riderId, enabled]
      );
      if (updated.rowCount === 0) {
        return { ok: false, reason: 'not_member' };
      }
      if (!enabled) {
        await client.query('DELETE FROM ride_locations WHERE ride_id = $1 AND rider_id = $2', [rideId, riderId]);
      }
      return result;
    });
  }

  /** Sets (or, with null, clears) the group's regroup point. Host only. */
  async setRegroupPoint(
    rideId: string,
    actorId: string,
    point: Omit<RegroupPoint, 'setAt'> | null,
  ): Promise<RideActionResult> {
    await ensureMigrated();
    const ride = await this.loadRide(rideId);
    if (!ride) return { ok: false, reason: 'not_found' };
    if (!ride.memberIds.has(actorId)) return { ok: false, reason: 'not_member' };
    if (ride.createdBy !== actorId) return { ok: false, reason: 'forbidden' };
    const regroup = point ? { ...point, setAt: Date.now() } : null;
    await getPool().query(
      'UPDATE rides SET regroup_lat = $2, regroup_lon = $3, regroup_label = $4, regroup_set_at = $5 WHERE id = $1',
      [rideId, regroup?.lat ?? null, regroup?.lon ?? null, regroup?.label ?? null, regroup?.setAt ?? null],
    );
    return { ok: true, ride: { ...ride, regroup } };
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

  private async loadFreshMemberLocations(rideId: string): Promise<RideMemberLocation[]> {
    const pool = getPool();
    const freshSince = Date.now() - RIDE_LOCATION_LAST_SEEN_MS;
    await pool.query('DELETE FROM ride_locations WHERE ride_id = $1 AND updated_at < $2', [rideId, freshSince]);
    const { rows } = await pool.query<{ rider_id: string; lat: number; lon: number; updated_at: string | number; battery_low: boolean }>(
      `SELECT location.rider_id, location.lat, location.lon, location.updated_at, location.battery_low
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
    return rows.map((row) => ({
      riderId: row.rider_id,
      lat: row.lat,
      lon: row.lon,
      updatedAt: Number(row.updated_at),
      ...(row.battery_low ? { batteryLow: true as const } : {}),
    }));
  }

  /** Private-ride location is separate from public presence and requires
   * explicit, per-ride consent. Membership alone never enables upload.
   * Return the same fresh ride-location snapshot that the read endpoint
   * exposes so clients do not need a second authenticated request per tick. */
  async updateMemberLocation(rideId: string, riderId: string, lat: number, lon: number, batteryLow = false): Promise<RideLocationUpdateResult> {
    const result = await this.getRideForMember(rideId, riderId);
    if (!result.ok) return result;
    const pool = getPool();
    const updated = await pool.query(
      `INSERT INTO ride_locations (ride_id, rider_id, lat, lon, updated_at, battery_low)
       SELECT $1, $2, $3, $4, $5, $6
       FROM ride_members
       WHERE ride_id = $1 AND rider_id = $2 AND location_sharing_enabled = TRUE
       ON CONFLICT (ride_id, rider_id)
       DO UPDATE SET lat = $3, lon = $4, updated_at = $5, battery_low = $6
       RETURNING rider_id`,
      [rideId, riderId, lat, lon, Date.now(), batteryLow]
    );
    if (updated.rowCount === 0) return { ok: false, reason: 'location_sharing_disabled' };
    await slideRideCode(pool, rideId);
    return { ...result, locations: await this.loadFreshMemberLocations(rideId) };
  }

  async getMemberLocations(rideId: string, actorId: string): Promise<RideLocationsResult> {
    const result = await this.getRideForMember(rideId, actorId);
    if (!result.ok) return result;
    return { ok: true, locations: await this.loadFreshMemberLocations(rideId) };
  }
}
