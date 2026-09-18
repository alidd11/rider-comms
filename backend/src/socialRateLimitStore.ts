import type { PoolClient } from 'pg';
import { ensureMigrated, getPool } from './db.ts';

export type SocialRateAction = 'friend_request' | 'direct_message' | 'safety_report';

export interface SocialRatePolicy {
  maxEvents: number;
  windowMs: number;
}

export const SOCIAL_RATE_POLICIES: Readonly<Record<SocialRateAction, SocialRatePolicy>> = {
  // Friend requests are deliberately much slower than chat: this is a
  // discovery/contact action that can become unsolicited outreach.
  friend_request: { maxEvents: 20, windowMs: 10 * 60_000 },
  // A sustained two messages per second is already far above normal chat,
  // while still leaving headroom for quick conversational bursts.
  direct_message: { maxEvents: 120, windowMs: 60_000 },
  // Reports feed a human moderation queue, so abusive duplication has a much
  // lower ceiling than ordinary social traffic.
  safety_report: { maxEvents: 5, windowMs: 60 * 60_000 },
};

export interface SocialRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateWindowRow {
  event_count: string | number;
  oldest_created_at: string | number | null;
}

const MAX_POLICY_WINDOW_MS = Math.max(...Object.values(SOCIAL_RATE_POLICIES).map(({ windowMs }) => windowMs));

/**
 * Durable social-write rate limiting.
 *
 * The generic API limiter is intentionally broad and process-local. Social
 * abuse controls need to survive restarts and remain consistent if the
 * backend runs more than one replica, so these windows are enforced in
 * Postgres. An advisory transaction lock serialises one actor/action key
 * before count+insert, preventing concurrent requests from racing through
 * the same remaining slot.
 */
export class SocialRateLimitStore {
  private async lockKey(client: PoolClient, actorId: string, action: SocialRateAction): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`social-rate:${action}:${actorId}`],
    );
  }

  async consume(actorId: string, action: SocialRateAction, now = Date.now()): Promise<SocialRateLimitResult> {
    await ensureMigrated();
    const policy = SOCIAL_RATE_POLICIES[action];
    const cutoff = now - policy.windowMs;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockKey(client, actorId, action);

      // Keep the hot key bounded while it is active. A separate periodic
      // cleanup removes expired rows belonging to inactive riders.
      await client.query(
        'DELETE FROM social_rate_events WHERE actor_id = $1 AND action = $2 AND created_at <= $3',
        [actorId, action, cutoff],
      );

      const { rows } = await client.query<RateWindowRow>(
        `SELECT COUNT(*) AS event_count, MIN(created_at) AS oldest_created_at
         FROM social_rate_events
         WHERE actor_id = $1 AND action = $2 AND created_at > $3`,
        [actorId, action, cutoff],
      );
      const count = Number(rows[0]?.event_count ?? 0);
      const oldest = rows[0]?.oldest_created_at == null ? null : Number(rows[0].oldest_created_at);
      if (count >= policy.maxEvents) {
        await client.query('COMMIT');
        const retryAfterMs = oldest == null ? policy.windowMs : oldest + policy.windowMs - now;
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }

      await client.query(
        'INSERT INTO social_rate_events (actor_id, action, created_at) VALUES ($1, $2, $3)',
        [actorId, action, now],
      );
      await client.query('COMMIT');
      return { allowed: true, retryAfterSeconds: 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cleanupExpired(now = Date.now()): Promise<number> {
    await ensureMigrated();
    const result = await getPool().query(
      'DELETE FROM social_rate_events WHERE created_at <= $1',
      [now - MAX_POLICY_WINDOW_MS],
    );
    return result.rowCount ?? 0;
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM social_rate_events WHERE actor_id = $1', [riderId]);
  }
}
