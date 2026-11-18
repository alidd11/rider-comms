import { ensureMigrated, getPool } from './db.ts';

/**
 * With several backend replicas every one runs the same timers. Before a
 * recurring job runs, a replica claims it in job_runs; only the first claim
 * per interval succeeds, so a cleanup or a "site is down" check happens once
 * across all replicas rather than once per replica. Claims allow 10% slack
 * so timers that drift slightly don't skip a run.
 */
export async function claimJobRun(job: string, intervalMs: number, now = Date.now()): Promise<boolean> {
  await ensureMigrated();
  const { rowCount } = await getPool().query(
    `INSERT INTO job_runs (job, last_run_at) VALUES ($1, $2)
     ON CONFLICT (job) DO UPDATE SET last_run_at = EXCLUDED.last_run_at
     WHERE job_runs.last_run_at <= $2 - $3
     RETURNING job`,
    [job, now, Math.floor(intervalMs * 0.9)],
  );
  return rowCount === 1;
}

/** The task, run only by the replica that claims this interval. */
export function onceAcrossReplicas(job: string, intervalMs: number, task: () => Promise<unknown>): () => Promise<unknown> {
  return async () => ((await claimJobRun(job, intervalMs)) ? task() : undefined);
}
