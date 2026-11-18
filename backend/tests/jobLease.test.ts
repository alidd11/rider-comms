import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { claimJobRun, onceAcrossReplicas } from '../src/jobLease.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('job lease', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  const JOB = 'test_job_lease';
  before(async () => { await ensureMigrated(); await getPool().query('DELETE FROM job_runs WHERE job LIKE $1', ['test_%']); });
  after(async () => { await getPool().query('DELETE FROM job_runs WHERE job LIKE $1', ['test_%']); await resetDbForTests(); });

  it('lets one replica run a job per interval, with a little slack for drift', async () => {
    const start = 1_000_000;
    assert.equal(await claimJobRun(JOB, 60_000, start), true);
    assert.equal(await claimJobRun(JOB, 60_000, start + 1_000), false);
    assert.equal(await claimJobRun(JOB, 60_000, start + 55_000), true);
    assert.equal(await claimJobRun(JOB, 60_000, start + 60_000), false);
  });

  it('runs the task only for the replica that claimed it', async () => {
    let runs = 0;
    const replicaA = onceAcrossReplicas('test_job_task', 3_600_000, async () => { runs += 1; return 'done'; });
    const replicaB = onceAcrossReplicas('test_job_task', 3_600_000, async () => { runs += 1; return 'done'; });
    const results = await Promise.all([replicaA(), replicaB()]);
    assert.equal(runs, 1);
    assert.deepEqual(results.sort(), ['done', undefined].sort());
  });
});
