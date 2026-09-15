import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModerationStore } from '../src/moderationStore.ts';
import { getPool, resetDbForTests } from '../src/db.ts';

// ModerationStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('ModerationStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed ModerationStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query('TRUNCATE rider_blocks, safety_reports');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('treats a one-sided block as mutual communication isolation', async () => {
    const store = new ModerationStore();
    await store.block('alice', 'bob');
    assert.equal(await store.isBlockedBetween('alice', 'bob'), true);
    assert.equal(await store.isBlockedBetween('bob', 'alice'), true);
    assert.deepEqual(await store.getBlocked('alice'), ['bob']);
    await store.unblock('alice', 'bob');
    assert.equal(await store.isBlockedBetween('alice', 'bob'), false);
  });

  it('accepts a validated safety report', async () => {
    const report = await new ModerationStore().report('alice', 'bob', 'unsafe', 'Dangerous riding');
    assert.equal(report.reporterId, 'alice');
    assert.equal(report.reportedRiderId, 'bob');
    assert.equal(report.reason, 'unsafe');
    assert.ok(report.id);
  });
});
