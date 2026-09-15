import { randomUUID } from 'node:crypto';
import type { FriendRequest, FriendRequestStatus, FriendSummary } from '@rider-comms/shared';
import type { ProfileStore } from './profileStore.ts';
import { ensureMigrated, getPool } from './db.ts';

export type CreateFriendRequestResult =
  | { ok: true; request: FriendRequest }
  | { ok: false; error: 'invalid' | 'already_friends' | 'request_exists'; message?: string };

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

  private async areFriends(a: string, b: string): Promise<boolean> {
    await ensureMigrated();
    const { rows } = await getPool().query('SELECT 1 FROM friendships WHERE rider_id = $1 AND friend_id = $2', [a, b]);
    return rows.length > 0;
  }

  private async findPendingBetween(a: string, b: string): Promise<FriendRequest | undefined> {
    await ensureMigrated();
    const { rows } = await getPool().query<FriendRequestRow>(
      `SELECT * FROM friend_requests
       WHERE status = 'pending' AND ((from_rider_id = $1 AND to_rider_id = $2) OR (from_rider_id = $2 AND to_rider_id = $1))
       LIMIT 1`,
      [a, b]
    );
    return rows[0] ? rowToRequest(rows[0]) : undefined;
  }

  async createRequest(fromRiderId: string, toRiderId: string): Promise<CreateFriendRequestResult> {
    if (await this.areFriends(fromRiderId, toRiderId)) {
      return { ok: false, error: 'already_friends' };
    }
    if (await this.findPendingBetween(fromRiderId, toRiderId)) {
      return { ok: false, error: 'request_exists' };
    }

    const request: FriendRequest = {
      id: randomUUID(),
      fromRiderId,
      toRiderId,
      status: 'pending',
      createdAt: Date.now(),
    };
    await getPool().query(
      'INSERT INTO friend_requests (id, from_rider_id, to_rider_id, status, created_at) VALUES ($1, $2, $3, $4, $5)',
      [request.id, request.fromRiderId, request.toRiderId, request.status, request.createdAt]
    );
    return { ok: true, request };
  }

  async getRequest(requestId: string): Promise<FriendRequest | undefined> {
    await ensureMigrated();
    const { rows } = await getPool().query<FriendRequestRow>('SELECT * FROM friend_requests WHERE id = $1', [requestId]);
    return rows[0] ? rowToRequest(rows[0]) : undefined;
  }

  async getRequestsFor(riderId: string): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
    await ensureMigrated();
    const { rows } = await getPool().query<FriendRequestRow>(
      `SELECT * FROM friend_requests WHERE status = 'pending' AND (to_rider_id = $1 OR from_rider_id = $1)`,
      [riderId]
    );
    const incoming: FriendRequest[] = [];
    const outgoing: FriendRequest[] = [];
    for (const row of rows) {
      const request = rowToRequest(row);
      if (request.toRiderId === riderId) incoming.push(request);
      else if (request.fromRiderId === riderId) outgoing.push(request);
    }
    return { incoming, outgoing };
  }

  private async addFriendship(a: string, b: string): Promise<void> {
    const pool = getPool();
    const now = Date.now();
    await pool.query(
      'INSERT INTO friendships (rider_id, friend_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (rider_id, friend_id) DO NOTHING',
      [a, b, now]
    );
    await pool.query(
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
    const { rows } = await getPool().query<FriendRequestRow>(
      `UPDATE friend_requests SET status = 'accepted' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [requestId]
    );
    if (!rows[0]) return { ok: false, error: 'not_found' };
    const request = rowToRequest(rows[0]);
    await this.addFriendship(request.fromRiderId, request.toRiderId);
    return { ok: true, request, friend: await this.summaryFor(request.fromRiderId) };
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

  async getFriends(riderId: string): Promise<FriendSummary[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ friend_id: string }>('SELECT friend_id FROM friendships WHERE rider_id = $1', [riderId]);
    const summaries: FriendSummary[] = [];
    for (const row of rows) summaries.push(await this.summaryFor(row.friend_id));
    return summaries;
  }

  async removeFriend(riderId: string, friendId: string): Promise<void> {
    await ensureMigrated();
    const pool = getPool();
    await pool.query('DELETE FROM friendships WHERE rider_id = $1 AND friend_id = $2', [riderId, friendId]);
    await pool.query('DELETE FROM friendships WHERE rider_id = $1 AND friend_id = $2', [friendId, riderId]);
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    const pool = getPool();
    await pool.query('DELETE FROM friendships WHERE rider_id = $1 OR friend_id = $1', [riderId]);
    await pool.query('DELETE FROM friend_requests WHERE from_rider_id = $1 OR to_rider_id = $1', [riderId]);
  }

  /** Exposed for the messages endpoint's friendship check. */
  async isFriendOf(a: string, b: string): Promise<boolean> {
    return this.areFriends(a, b);
  }
}
