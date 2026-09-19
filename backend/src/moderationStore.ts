import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ensureMigrated, getPool } from './db.ts';
import { appendSocialEventForRiders } from './socialEventStore.ts';

export const REPORT_REASONS = ['harassment', 'unsafe', 'spam', 'sexual', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface SafetyReport {
  id: string;
  reporterId: string;
  reportedRiderId: string;
  reason: ReportReason;
  details: string;
  createdAt: number;
}

/** Blocks and safety reports, persisted in Postgres (see db.ts) and routed
 * to a staffed moderation workflow before user content launches. */
export class ModerationStore {
  private async lockPair(client: PoolClient, a: string, b: string): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended(LEAST($1::text, $2::text) || ':' || GREATEST($1::text, $2::text), 0)
       )`,
      [a, b],
    );
  }

  /**
   * Blocking is the authoritative relationship teardown for the pair. It
   * shares the same advisory pair lock as friendship creation/removal, so a
   * concurrent friend request or acceptance cannot commit "through" a block.
   */
  async block(riderId: string, blockedRiderId: string): Promise<void> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockPair(client, riderId, blockedRiderId);
      const blockInserted = await client.query(
        'INSERT INTO rider_blocks (rider_id, blocked_rider_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (rider_id, blocked_rider_id) DO NOTHING',
        [riderId, blockedRiderId, Date.now()]
      );
      const removedFriendships = await client.query(
        `DELETE FROM friendships
         WHERE (rider_id = $1 AND friend_id = $2)
            OR (rider_id = $2 AND friend_id = $1)
         RETURNING rider_id, friend_id`,
        [riderId, blockedRiderId],
      );
      const removedRequests = await client.query<{ id: string }>(
        `DELETE FROM friend_requests
         WHERE status = 'pending'
           AND ((from_rider_id = $1 AND to_rider_id = $2)
             OR (from_rider_id = $2 AND to_rider_id = $1))
         RETURNING id`,
        [riderId, blockedRiderId],
      );
      // Realtime invalidation deliberately stays generic: the affected peer
      // learns only that the relationship/request disappeared, never that a
      // block was the reason.
      if ((removedFriendships.rowCount ?? 0) > 0) {
        await appendSocialEventForRiders(client, [riderId, blockedRiderId], 'friend_removed', riderId, riderId);
      }
      for (const request of removedRequests.rows) {
        await appendSocialEventForRiders(client, [riderId, blockedRiderId], 'friend_request_resolved', riderId, request.id);
      }
      // A direct hideout share is effectively a location-sharing link
      // between its creator and participant. Remove that direct link when
      // either side blocks the other; third-party group hideouts remain
      // intact and are filtered per viewer by the API.
      await client.query(
        `DELETE FROM hideout_participants participant
         USING hideouts hideout
         WHERE participant.hideout_id = hideout.id
           AND ((hideout.created_by = $1 AND participant.rider_id = $2)
             OR (hideout.created_by = $2 AND participant.rider_id = $1))`,
        [riderId, blockedRiderId],
      );
      if ((blockInserted.rowCount ?? 0) > 0) {
        await appendSocialEventForRiders(client, [riderId], 'social_refresh', riderId, 'blocks');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async unblock(riderId: string, blockedRiderId: string): Promise<void> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const removed = await client.query(
        'DELETE FROM rider_blocks WHERE rider_id = $1 AND blocked_rider_id = $2',
        [riderId, blockedRiderId],
      );
      if ((removed.rowCount ?? 0) > 0) {
        await appendSocialEventForRiders(client, [riderId], 'social_refresh', riderId, 'blocks');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBlocked(riderId: string): Promise<string[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ blocked_rider_id: string }>(
      'SELECT blocked_rider_id FROM rider_blocks WHERE rider_id = $1',
      [riderId]
    );
    return rows.map((row) => row.blocked_rider_id);
  }

  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    await ensureMigrated();
    const { rows } = await getPool().query(
      'SELECT 1 FROM rider_blocks WHERE (rider_id = $1 AND blocked_rider_id = $2) OR (rider_id = $2 AND blocked_rider_id = $1)',
      [a, b]
    );
    return rows.length > 0;
  }

  /**
   * Bulk block filtering for presence/voice/group social responses. This
   * avoids an N+1 block lookup for every nearby peer while preserving the
   * caller's input order.
   */
  async filterAllowedPeerIds(riderId: string, peerIds: string[]): Promise<string[]> {
    const uniquePeerIds = [...new Set(peerIds.filter((peerId) => peerId !== riderId))];
    if (uniquePeerIds.length === 0) return [];
    await ensureMigrated();
    const { rows } = await getPool().query<{ peer_id: string }>(
      `SELECT CASE WHEN rider_id = $1 THEN blocked_rider_id ELSE rider_id END AS peer_id
       FROM rider_blocks
       WHERE (rider_id = $1 AND blocked_rider_id = ANY($2::text[]))
          OR (blocked_rider_id = $1 AND rider_id = ANY($2::text[]))`,
      [riderId, uniquePeerIds],
    );
    const blocked = new Set(rows.map((row) => row.peer_id));
    return uniquePeerIds.filter((peerId) => !blocked.has(peerId));
  }

  async report(reporterId: string, reportedRiderId: string, reason: ReportReason, details: string): Promise<SafetyReport> {
    await ensureMigrated();
    const report: SafetyReport = { id: randomUUID(), reporterId, reportedRiderId, reason, details, createdAt: Date.now() };
    await getPool().query(
      'INSERT INTO safety_reports (id, reporter_id, reported_rider_id, reason, details, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [report.id, report.reporterId, report.reportedRiderId, report.reason, report.details, report.createdAt]
    );
    return report;
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    const pool = getPool();
    await pool.query('DELETE FROM rider_blocks WHERE rider_id = $1 OR blocked_rider_id = $1', [riderId]);
    await pool.query('DELETE FROM safety_reports WHERE reporter_id = $1 OR reported_rider_id = $1', [riderId]);
  }
}
