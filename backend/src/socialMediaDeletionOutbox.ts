/**
 * Social media storage deletion queue. Internal-only, no route or public upload.
 * The caller must enqueue in the SAME database transaction that revokes the
 * owning media record. Object deletion is idempotent; failures remain queued.
 */
export interface Queryable {
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}
export interface StorageDelete { deleteProcessed(key: string): Promise<void> }
export type DeleteJob = { id: string; objectKey: string; attempts: number };
const KEY = /^social\/processed\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(?:jpg|png|webp|mp4)$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_BATCH = 25;
export function assertSocialObjectKey(key: string): void {
  if (!KEY.test(key)) throw new Error('invalid_social_media_object_key');
}
/** Must run inside the revocation transaction, never as a later best-effort call. */
export async function enqueueSocialMediaDelete(tx: Queryable, objectKey: string): Promise<void> {
  assertSocialObjectKey(objectKey);
  await tx.query(
    `INSERT INTO social_media_delete_outbox (object_key)
     VALUES ($1) ON CONFLICT (object_key) DO NOTHING`,
    [objectKey],
  );
}
/**
 * Claim leases with SKIP LOCKED, allowing concurrent workers without a long
 * database transaction across S3 I/O. Expired leases are automatically retried.
 */
export async function claimSocialMediaDeletes(db: Queryable, limit = 10): Promise<DeleteJob[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH) {
    throw new Error('invalid_social_delete_batch_size');
  }
  const result = await db.query(
    `WITH claimed AS (
       SELECT id FROM social_media_delete_outbox
       WHERE completed_at IS NULL AND next_attempt_at <= now()
         AND (lease_until IS NULL OR lease_until < now())
       ORDER BY next_attempt_at, id
       FOR UPDATE SKIP LOCKED LIMIT $1
     )
     UPDATE social_media_delete_outbox AS jobs
     SET lease_token = gen_random_uuid(), lease_until = now() + interval '90 seconds',
         attempts = jobs.attempts + 1
     FROM claimed WHERE jobs.id = claimed.id
     RETURNING jobs.id, jobs.object_key, jobs.attempts, jobs.lease_token`,
    [limit],
  );
  return result.rows.map(row => {
    if (typeof row.id !== 'string' || !UUID.test(row.id) ||
      typeof row.object_key !== 'string' || !KEY.test(row.object_key) ||
      typeof row.lease_token !== 'string' || !UUID.test(row.lease_token) ||
      typeof row.attempts !== 'number' || !Number.isSafeInteger(row.attempts) ||
      row.attempts < 1) throw new Error('invalid_social_delete_job');
    return { id: row.id, objectKey: row.object_key, attempts: row.attempts,
      leaseToken: row.lease_token };
  });
}
type ClaimedJob = DeleteJob & { leaseToken: string };
/**
 * Only the lease holder can acknowledge a deletion. If the worker dies after
 * S3 DELETE, a later retry repeats an idempotent DELETE safely.
 */
export async function processSocialMediaDeletes(
  db: Queryable, storage: StorageDelete, limit = 10,
): Promise<{ succeeded: number; deferred: number }> {
  const jobs = await claimSocialMediaDeletes(db, limit) as ClaimedJob[];
  let succeeded = 0;
  let deferred = 0;
  for (const job of jobs) {
    try {
      await storage.deleteProcessed(job.objectKey);
      const done = await db.query(
        `UPDATE social_media_delete_outbox SET completed_at = now(),
           lease_until = NULL, lease_token = NULL
         WHERE id = $1 AND lease_token = $2 AND completed_at IS NULL
         RETURNING id`, [job.id, job.leaseToken],
      );
      if (done.rows.length === 1) succeeded++;
      else deferred++;
    } catch {
      // Do not log object keys, credentials or storage error details.
      await db.query(
        `UPDATE social_media_delete_outbox SET lease_until = NULL,
           lease_token = NULL,
           next_attempt_at = now() + make_interval(secs =>
             LEAST(86400, (power(2, LEAST(attempts, 16)) * 15)::int))
         WHERE id = $1 AND lease_token = $2 AND completed_at IS NULL`,
        [job.id, job.leaseToken],
      );
      deferred++;
    }
  }
  return { succeeded, deferred };
}
