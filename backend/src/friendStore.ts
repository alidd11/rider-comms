import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { FriendRequest, FriendRequestStatus, FriendSummary } from '@rider-comms/shared';
import type { ProfileStore } from './profileStore.ts';
import { ensureMigrated, getPool } from './db.ts';

export type CreateFriendRequestResult =
  | { ok: true; request: FriendRequest }
  | { ok: false; error: 'invalid' | 'already_friends' | 'request_exists' | 'blocked'; message?: string };

export type ResolveRequestResult =
  | { ok: true; request: FriendRequest }
  | { ok: false; error: 'not_found' };

interface FriendRequestRow {
  id: string;
  from_rider_id: string;
  to_rider_id: string;
  status: string;
  created_at: string | number;
}

interface FriendSummaryRow {
  rider_id: string;
  display_name: string | null;
  handle: string | null;
  avatar_id: string | null;
  created_at: string | number;
}

interface FriendRequestProfileRow extends FriendRequestRow {
  other_rider_id: string;
  display_name: string | null;
  handle: string | null;
  avatar_id: string | null;
}

interface ListCursor { createdAt: number; id: string }
export class InvalidFriendCursorError extends Error {
  constructor() { super('invalid friend cursor'); this.name = 'InvalidFriendCursorError'; }
}

function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): ListCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ListCursor>;
    if (!Number.isSafeInteger(parsed.createdAt) || (parsed.createdAt ?? -1) < 0 || typeof parsed.id !== 'string' || !parsed.id) throw new Error();
    if (encodeCursor(parsed as ListCursor) !== value) throw new Error();
    return parsed as ListCursor;
  } catch { throw new InvalidFriendCursorError(); }
}

function summaryFromRow(row: FriendSummaryRow): FriendSummary {
  return {
    riderId: row.rider_id,
    displayName: row.display_name ?? 'Rider',
    handle: row.handle ?? `@${row.rider_id.replace(/^rider_/, '')}`,
    avatarId: row.avatar_id ?? 'ember',
  };
}

export interface FriendPage { friends: FriendSummary[]; nextCursor: string | null }
export interface FriendRequestPage {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  profiles: Record<string, FriendSummary>;
  nextCursor: string | null;
}

function rowToRequest(row: FriendRequestRow): FriendRequest {
  return {
    id: row.id,
    fromRiderId: row.from_rider_id,
    toRiderId: row.to_rider_id,
    status: row.status as FriendRequestStatus,
    createdAt: Number(row.created_at),
  };
}

/**
 * Friend requests + the resulting friendships, persisted in Postgres (see
 * db.ts). Friendships are stored as a symmetric adjacency table (both
 * directions inserted/removed together) since there's no directionality to
 * "being friends" once accepted — only the pending *request* has a
 * from/to direction.
 */
export class FriendStore {
  private profileStore: ProfileStore;

  constructor(profileStore: ProfileStore) {
    this.profileStore = profileStore;
  }

  private async lockPair(client: PoolClient, a: string, b: string): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended(LEAST($1::text, $2::text) || ':' || GREATEST($1::text, $2::text), 0)
       )`,
      [a, b],
    );
  }

  private async areFriends(a: string, b: string, database: Pick<Pool, 'query'> = getPool()): Promise<boolean> {
    await ensureMigrated();
    const { rows } = await database.query('SELECT 1 FROM friendships WHERE rider_id = $1 AND friend_id = $2', [a, b]);
    return rows.length > 0;
  }

  private async isBlockedBetween(a: string, b: string, database: Pick<Pool, 'query'> = getPool()): Promise<boolean> {
    await ensureMigrated();
    const { rows } = await database.query(
      `SELECT 1 FROM rider_blocks
       WHERE (rider_id = $1 AND blocked_rider_id = $2)
          OR (rider_id = $2 AND blocked_rider_id = $1)
       LIMIT 1`,
      [a, b],
    );
    return rows.length > 0;
  }

  private async findPendingBetween(a: string, b: string, database: Pick<Pool, 'query'> = getPool()): Promise<FriendRequest | undefined> {
    await ensureMigrated();
    const { rows } = await database.query<FriendRequestRow>(
      `SELECT * FROM friend_requests
       WHERE status = 'pending' AND ((from_rider_id = $1 AND to_rider_id = $2) OR (from_rider_id = $2 AND to_rider_id = $1))
       LIMIT 1`,
      [a, b]
    );
    return rows[0] ? rowToRequest(rows[0]) : undefined;
  }

  async createRequest(fromRiderId: string, toRiderId: string): Promise<CreateFriendRequestResult> {
    await ensureMigrated();
    const request: FriendRequest = {
      id: randomUUID(),
      fromRiderId,
      toRiderId,
      status: 'pending',
      createdAt: Date.now(),
    };
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockPair(client, fromRiderId, toRiderId);
      if (await this.isBlockedBetween(fromRiderId, toRiderId, client)) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'blocked' };
      }
      if (await this.areFriends(fromRiderId, toRiderId, client)) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'already_friends' };
      }
      if (await this.findPendingBetween(fromRiderId, toRiderId, client)) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'request_exists' };
      }
      const inserted = await client.query(
        `INSERT INTO friend_requests (id, from_rider_id, to_rider_id, status, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [request.id, request.fromRiderId, request.toRiderId, request.status, request.createdAt]
      );
      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'request_exists' };
      }
      await client.query('COMMIT');
      return { ok: true, request };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getRequest(requestId: string): Promise<FriendRequest | undefined> {
    await ensureMigrated();
    const { rows } = await getPool().query<FriendRequestRow>('SELECT * FROM friend_requests WHERE id = $1', [requestId]);
    return rows[0] ? rowToRequest(rows[0]) : undefined;
  }

  async getRequestsFor(riderId: string, limit = 100, before?: string): Promise<FriendRequestPage> {
    await ensureMigrated();
    const cursor = decodeCursor(before);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const { rows } = await getPool().query<FriendRequestProfileRow>(
      `SELECT request.*,
              CASE WHEN request.from_rider_id = $1 THEN request.to_rider_id ELSE request.from_rider_id END AS other_rider_id,
              profile.display_name, profile.handle, profile.avatar_id
       FROM friend_requests request
       LEFT JOIN rider_profiles profile
         ON profile.rider_id = CASE WHEN request.from_rider_id = $1 THEN request.to_rider_id ELSE request.from_rider_id END
       WHERE request.status = 'pending'
         AND (request.to_rider_id = $1 OR request.from_rider_id = $1)
         AND NOT EXISTS (
           SELECT 1
           FROM rider_blocks block
           WHERE (block.rider_id = $1 AND block.blocked_rider_id = CASE WHEN request.from_rider_id = $1 THEN request.to_rider_id ELSE request.from_rider_id END)
              OR (block.blocked_rider_id = $1 AND block.rider_id = CASE WHEN request.from_rider_id = $1 THEN request.to_rider_id ELSE request.from_rider_id END)
         )
         AND ($2::bigint IS NULL OR (request.created_at, request.id) < ($2::bigint, $3::text))
       ORDER BY request.created_at DESC, request.id DESC
       LIMIT $4`,
      [riderId, cursor?.createdAt ?? null, cursor?.id ?? null, boundedLimit + 1]
    );
    const incoming: FriendRequest[] = [];
    const outgoing: FriendRequest[] = [];
    const profiles: Record<string, FriendSummary> = {};
    const selected = rows.slice(0, boundedLimit);
    for (const row of selected) {
      const request = rowToRequest(row);
      if (request.toRiderId === riderId) incoming.push(request);
      else if (request.fromRiderId === riderId) outgoing.push(request);
      profiles[row.other_rider_id] = summaryFromRow({ ...row, rider_id: row.other_rider_id });
    }
    const last = selected.at(-1);
    return { incoming, outgoing, profiles, nextCursor: rows.length > boundedLimit && last ? encodeCursor({ createdAt: Number(last.created_at), id: last.id }) : null };
  }

  private async addFriendship(client: PoolClient, a: string, b: string): Promise<void> {
    const now = Date.now();
    await client.query(
      'INSERT INTO friendships (rider_id, friend_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (rider_id, friend_id) DO NOTHING',
      [a, b, now]
    );
    await client.query(
      'INSERT INTO friendships (rider_id, friend_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (rider_id, friend_id) DO NOTHING',
      [b, a, now]
    );
  }

  private async summaryFor(riderId: string): Promise<FriendSummary> {
    const profile = await this.profileStore.getOrCreate(riderId);
    return {
      riderId,
      displayName: profile.displayName,
      handle: profile.handle,
      avatarId: profile.avatarId,
    };
  }

  /** Accepts a pending request. `friend` in the result describes the
   * *other* party from the perspective of whoever is accepting — i.e. the
   * request's fromRiderId, since toRiderId is the one accepting. */
  async accept(requestId: string): Promise<ResolveRequestResult & { friend?: FriendSummary }> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query<FriendRequestRow>(
        `SELECT * FROM friend_requests WHERE id = $1 AND status = 'pending'`,
        [requestId],
      );
      if (!pending.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'not_found' };
      }
      await this.lockPair(client, pending.rows[0].from_rider_id, pending.rows[0].to_rider_id);
      const { rows } = await client.query<FriendRequestRow>(
        `UPDATE friend_requests SET status = 'accepted' WHERE id = $1 AND status = 'pending' RETURNING *`,
        [requestId]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'not_found' };
      }
      const request = rowToRequest(rows[0]);
      await this.addFriendship(client, request.fromRiderId, request.toRiderId);
      const friend = await this.summaryFor(request.fromRiderId);
      await client.query('COMMIT');
      return { ok: true, request, friend };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async decline(requestId: string): Promise<ResolveRequestResult> {
    await ensureMigrated();
    const { rows } = await getPool().query<FriendRequestRow>(
      `UPDATE friend_requests SET status = 'declined' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [requestId]
    );
    if (!rows[0]) return { ok: false, error: 'not_found' };
    return { ok: true, request: rowToRequest(rows[0]) };
  }

  async cancelRequest(requestId: string, riderId: string): Promise<ResolveRequestResult> {
    await ensureMigrated();
    const { rows } = await getPool().query<FriendRequestRow>(
      `DELETE FROM friend_requests
       WHERE id = $1 AND from_rider_id = $2 AND status = 'pending'
       RETURNING *`,
      [requestId, riderId]
    );
    if (!rows[0]) return { ok: false, error: 'not_found' };
    return { ok: true, request: rowToRequest(rows[0]) };
  }

  async getFriends(riderId: string): Promise<FriendSummary[]> {
    return (await this.getFriendPage(riderId)).friends;
  }

  async getFriendPage(riderId: string, limit = 100, before?: string): Promise<FriendPage> {
    await ensureMigrated();
    const cursor = decodeCursor(before);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const { rows } = await getPool().query<FriendSummaryRow>(
      `SELECT friendship.friend_id AS rider_id, friendship.created_at,
              profile.display_name, profile.handle, profile.avatar_id
       FROM friendships friendship
       LEFT JOIN rider_profiles profile ON profile.rider_id = friendship.friend_id
       WHERE friendship.rider_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM rider_blocks block
           WHERE (block.rider_id = $1 AND block.blocked_rider_id = friendship.friend_id)
              OR (block.blocked_rider_id = $1 AND block.rider_id = friendship.friend_id)
         )
         AND ($2::bigint IS NULL OR (friendship.created_at, friendship.friend_id) < ($2::bigint, $3::text))
       ORDER BY friendship.created_at DESC, friendship.friend_id DESC
       LIMIT $4`,
      [riderId, cursor?.createdAt ?? null, cursor?.id ?? null, boundedLimit + 1]
    );
    const selected = rows.slice(0, boundedLimit);
    const last = selected.at(-1);
    return {
      friends: selected.map(summaryFromRow),
      nextCursor: rows.length > boundedLimit && last ? encodeCursor({ createdAt: Number(last.created_at), id: last.rider_id }) : null,
    };
  }

  async removeFriend(riderId: string, friendId: string): Promise<void> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockPair(client, riderId, friendId);
      await client.query('DELETE FROM friendships WHERE rider_id = $1 AND friend_id = $2', [riderId, friendId]);
      await client.query('DELETE FROM friendships WHERE rider_id = $1 AND friend_id = $2', [friendId, riderId]);
      await client.query(
        `DELETE FROM friend_requests
         WHERE status = 'pending'
           AND ((from_rider_id = $1 AND to_rider_id = $2)
             OR (from_rider_id = $2 AND to_rider_id = $1))`,
        [riderId, friendId],
      );
      await client.query('COMMIT');
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
    await pool.query('DELETE FROM friendships WHERE rider_id = $1 OR friend_id = $1', [riderId]);
    await pool.query('DELETE FROM friend_requests WHERE from_rider_id = $1 OR to_rider_id = $1', [riderId]);
  }

  /** Social authorisation treats a block as stronger than a stale friendship row. */
  async isFriendOf(a: string, b: string): Promise<boolean> {
    await ensureMigrated();
    const { rows } = await getPool().query(
      `SELECT 1
       FROM friendships friendship
       WHERE friendship.rider_id = $1
         AND friendship.friend_id = $2
         AND NOT EXISTS (
           SELECT 1
           FROM rider_blocks block
           WHERE (block.rider_id = $1 AND block.blocked_rider_id = $2)
              OR (block.rider_id = $2 AND block.blocked_rider_id = $1)
         )
       LIMIT 1`,
      [a, b],
    );
    return rows.length > 0;
  }
}
