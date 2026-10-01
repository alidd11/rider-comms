import { ensureMigrated, getPool } from './db.ts';

export type RateLimitAction =
  | 'auth'
  | 'api'
  | 'ride_join_rider'
  | 'ride_join_ip'
  | 'hazard_create'
  | 'directions'
  | 'places'
  | 'client_error'
  | 'presence'
  | 'verification_resend'
  | 'password_reset_request'
  | 'ride_create'
  | 'hideout_create';

export interface RateLimitPolicy {
  maxEvents: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICIES: Readonly<Record<RateLimitAction, RateLimitPolicy>> = {
  // Shared across signup/login/email verification/password-reset confirmation
  // for one client address, preserving the previous combined auth window.
  auth: { maxEvents: 20, windowMs: 60_000 },
  api: { maxEvents: 300, windowMs: 60_000 },
  // A private ride code grants access to live group features, so guessing is
  // constrained independently by authenticated rider and client address.
  ride_join_rider: { maxEvents: 5, windowMs: 60_000 },
  ride_join_ip: { maxEvents: 20, windowMs: 60_000 },
  hazard_create: { maxEvents: 10, windowMs: 10 * 60_000 },
  // Directions requests incur third-party quota/cost and can be triggered by
  // rerouting. Keep enough headroom for normal riding while bounding abuse.
  directions: { maxEvents: 60, windowMs: 10 * 60_000 },
  // Place search is billed per request. The native client debounces typing
  // (500ms) and caches repeats in memory, so this bounds a scripted client
  // without getting in the way of a rider browsing a few categories/queries.
  places: { maxEvents: 120, windowMs: 10 * 60_000 },
  // Crash reports per client address: enough for a crash loop to be visible
  // in the logs without letting one client flood them.
  client_error: { maxEvents: 30, windowMs: 10 * 60_000 },
  // Public presence per rider. Both apps send a fix every 8 s (7.5/minute),
  // so 20/minute leaves room for go-live and foreground refreshes while
  // bounding how fast a scripted client can probe with fabricated positions.
  presence: { maxEvents: 20, windowMs: 60_000 },
  verification_resend: { maxEvents: 3, windowMs: 10 * 60_000 },
  password_reset_request: { maxEvents: 3, windowMs: 10 * 60_000 },
  // Each ride is a row, a join code and a voice room. A host starting over a
  // few times is normal; dozens in minutes is a script.
  ride_create: { maxEvents: 10, windowMs: 10 * 60_000 },
  // Hideouts notify every invited friend; planning a few is normal.
  hideout_create: { maxEvents: 10, windowMs: 10 * 60_000 },
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
  async consume(subjectKey: string, action: RateLimitAction, now = Date.now()): Promise<RateLimitResult> {
    await ensureMigrated();
    const policy = RATE_LIMIT_POLICIES[action];
    const cutoff = now - policy.windowMs;
    const client = await getPool().connect();
    try {
      // Every authenticated request passes through here, so this is kept to
      // three round trips (it was six). BEGIN and the advisory lock go in one
      // simple-protocol query, which can't take bind parameters, hence the
      // escaped literal. The lock must be held before the counting statement
      // starts: under READ COMMITTED that statement's snapshot then includes
      // every insert committed by whoever held the lock before us.
      const lockName = client.escapeLiteral(`api-rate:${action}:${subjectKey}`);
      await client.query(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`);

      // One statement prunes expired rows, counts the live window and inserts
      // the new event only if there is room. CTEs share a snapshot, so the
      // count ignores the prune and the insert; it filters on the cutoff itself.
      const { rows } = await client.query<RateWindowRow & { inserted: boolean }>(
        `WITH pruned AS (
           DELETE FROM rate_limit_events WHERE subject_key = $1 AND action = $2 AND created_at <= $3
         ), live AS (
           SELECT COUNT(*) AS event_count, MIN(created_at) AS oldest_created_at
           FROM rate_limit_events
           WHERE subject_key = $1 AND action = $2 AND created_at > $3
         ), inserted AS (
           INSERT INTO rate_limit_events (subject_key, action, created_at)
           SELECT $1, $2, $4 FROM live WHERE live.event_count < $5
           RETURNING 1
         )
         SELECT live.event_count, live.oldest_created_at, EXISTS (SELECT 1 FROM inserted) AS inserted
         FROM live`,
        [subjectKey, action, cutoff, now, policy.maxEvents],
      );
      await client.query('COMMIT');

      if (rows[0]?.inserted) return { allowed: true, retryAfterSeconds: 0 };
      const oldest = rows[0]?.oldest_created_at == null ? null : Number(rows[0].oldest_created_at);
      const retryAfterMs = oldest == null ? policy.windowMs : oldest + policy.windowMs - now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
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
