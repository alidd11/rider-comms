import type { PoolClient } from 'pg';
import { ensureMigrated, getPool } from './db.ts';

export type RateLimitAction =
  | 'auth'
  | 'api'
  | 'hazard_create'
  | 'verification_resend'
  | 'password_reset_request';

export interface RateLimitPolicy {
  maxEvents: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICIES: Readonly<Record<RateLimitAction, RateLimitPolicy>> = {
  // Shared across signup/login/email verification/password-reset confirmation
  // for one client address, preserving the previous combined auth window.
  auth: { maxEvents: 20, windowMs: 60_000 },
  api: { maxEvents: 300, windowMs: 60_000 },
  hazard_create: { maxEvents: 10, windowMs: 10 * 60_000 },
  verification_resend: { maxEvents: 3, windowMs: 10 * 60_000 },
  password_reset_request: { maxEvents: 3, windowMs: 10 * 60_000 },
};

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateWindowRow {
  event_count: string | number;
  oldest_created_at: string | number | null;
}

const MAX_POLICY_WINDOW_MS = Math.max(...Object.values(RATE_LIMIT_POLICIES).map(({ windowMs }) => windowMs));

/**
 * Durable sliding-window limits for general API/authentication abuse controls.
 *
 * Each subject/action pair is serialised with a Postgres advisory transaction
 * lock before count+insert, so separate backend replicas cannot race through
 * the final slot. Callers pass an opaque hashed subject key rather than a raw
 * IP address or rider ID.
 */
export class RateLimitStore {
  private async lockKey(client: PoolClient, subjectKey: string, action: RateLimitAction): Promise<void> {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`api-rate:${action}:${subjectKey}`],
    );
  }

  async consume(subjectKey: string, action: RateLimitAction, now = Date.now()): Promise<RateLimitResult> {
    await ensureMigrated();
    const policy = RATE_LIMIT_POLICIES[action];
    const cutoff = now - policy.windowMs;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockKey(client, subjectKey, action);

      await client.query(
        'DELETE FROM rate_limit_events WHERE subject_key = $1 AND action = $2 AND created_at <= $3',
        [subjectKey, action, cutoff],
      );

      const { rows } = await client.query<RateWindowRow>(
        `SELECT COUNT(*) AS event_count, MIN(created_at) AS oldest_created_at
         FROM rate_limit_events
         WHERE subject_key = $1 AND action = $2 AND created_at > $3`,
        [subjectKey, action, cutoff],
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
        'INSERT INTO rate_limit_events (subject_key, action, created_at) VALUES ($1, $2, $3)',
        [subjectKey, action, now],
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
      'DELETE FROM rate_limit_events WHERE created_at <= $1',
      [now - MAX_POLICY_WINDOW_MS],
    );
    return result.rowCount ?? 0;
  }
}
