import type { FriendActivity } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

export const SOCIAL_ONLINE_WINDOW_MS = 90_000;
export const SOCIAL_ACTIVITY_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MIN_ACTIVITY_WRITE_INTERVAL_MS = 15_000;

interface ActivityRow {
  rider_id: string;
  last_seen_at: string | number | null;
}

/**
 * Durable app-activity state, deliberately separate from GPS presence.
 *
 * A rider can be "online" without sharing location. Conversely, public
 * proximity data must never be used as a social last-seen signal. Writes are
 * coalesced in Postgres so a busy client does not update the row on every API
 * request.
 */
export class SocialActivityStore {
  async touch(riderId: string, now = Date.now()): Promise<void> {
    await ensureMigrated();
    await getPool().query(
      `INSERT INTO rider_activity (rider_id, last_seen_at)
       VALUES ($1, $2)
       ON CONFLICT (rider_id) DO UPDATE SET
         last_seen_at = GREATEST(rider_activity.last_seen_at, EXCLUDED.last_seen_at)
       WHERE rider_activity.last_seen_at <= EXCLUDED.last_seen_at - $3`,
      [riderId, now, MIN_ACTIVITY_WRITE_INTERVAL_MS],
    );
  }

  /**
   * Activity is visible only for current, unblocked friends. The query never
   * accepts arbitrary rider IDs, preventing last-seen from becoming a rider
   * lookup/tracking endpoint.
   */
  async getFriendActivity(riderId: string, now = Date.now()): Promise<FriendActivity[]> {
    await ensureMigrated();
    const cutoff = now - SOCIAL_ONLINE_WINDOW_MS;
    const { rows } = await getPool().query<ActivityRow>(
      `SELECT friendship.friend_id AS rider_id, activity.last_seen_at
       FROM friendships friendship
       LEFT JOIN rider_activity activity ON activity.rider_id = friendship.friend_id
       WHERE friendship.rider_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM rider_blocks block
           WHERE (block.rider_id = $1 AND block.blocked_rider_id = friendship.friend_id)
              OR (block.rider_id = friendship.friend_id AND block.blocked_rider_id = $1)
         )
       ORDER BY friendship.friend_id`,
      [riderId],
    );
    return rows.map((row) => {
      const lastSeenAt = row.last_seen_at == null ? null : Number(row.last_seen_at);
      return {
        riderId: row.rider_id,
        online: lastSeenAt !== null && lastSeenAt >= cutoff,
        lastSeenAt,
      };
    });
  }

  async cleanupExpired(now = Date.now()): Promise<number> {
    await ensureMigrated();
    const result = await getPool().query(
      'DELETE FROM rider_activity WHERE last_seen_at < $1',
      [now - SOCIAL_ACTIVITY_RETENTION_MS],
    );
    return result.rowCount ?? 0;
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM rider_activity WHERE rider_id = $1', [riderId]);
  }
}
