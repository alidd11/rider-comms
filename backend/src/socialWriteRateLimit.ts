/**
 * Social write limiter: independent from the shared 300/min API throttle.
 * A caller must authenticate and verify email/terms/age before invoking this.
 * This module does not register routes or enable publishing.
 */
export const SOCIAL_WRITE_RATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS social_write_rate_windows (
  actor_id uuid NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (actor_id, action, window_start)
);
CREATE INDEX IF NOT EXISTS social_write_rate_windows_expiry
  ON social_write_rate_windows (window_start);
`;

export interface SocialRateQuery {
  query(sql: string, params: readonly unknown[]): Promise<{ rows: Array<{ hits: number }> }>;
}
export interface SocialRateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z][a-z0-9_]{0,47}$/;

/**
 * Fixed-window counter is atomic across backend instances via PostgreSQL
 * ON CONFLICT. A missing result means the quota was exhausted.
 * Do not call inside a transaction that may roll back on an ordinary denial.
 */
export async function consumeSocialWriteQuota(
  db: SocialRateQuery,
  actorId: string,
  action: string,
  limit: number,
  windowSeconds: number,
  nowMs = Date.now(),
): Promise<SocialRateDecision> {
  if (!UUID.test(actorId) || !ACTION.test(action) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
      !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400 ||
      !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('invalid_social_write_quota');
  }
  const windowMs = windowSeconds * 1000;
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((startMs + windowMs - nowMs) / 1000));
  // No SELECT-then-UPDATE race; one statement serialises concurrent writers.
  const result = await db.query(
    `INSERT INTO social_write_rate_windows (actor_id, action, window_start, hits)
     VALUES ($1::uuid, $2, $3::timestamptz, 1)
     ON CONFLICT (actor_id, action, window_start)
     DO UPDATE SET hits = social_write_rate_windows.hits + 1
       WHERE social_write_rate_windows.hits < $4
     RETURNING hits`,
    [actorId, action, new Date(startMs).toISOString(), limit],
  );
  if (result.rows.length > 1 || (result.rows.length === 1 &&
      (!Number.isSafeInteger(result.rows[0].hits) || result.rows[0].hits < 1 ||
       result.rows[0].hits > limit))) {
    throw new Error('invalid_social_write_quota_result');
  }
  return { allowed: result.rows.length === 1, retryAfterSeconds: result.rows.length ? 0 : retryAfterSeconds };
}
