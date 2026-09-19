import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModerationStore } from '../src/moderationStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

// ModerationStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('ModerationStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed ModerationStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
      await ensureMigrated();
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query('TRUNCATE social_events, friend_requests, friendships, rider_blocks, safety_reports RESTART IDENTITY');
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

  it('emits only generic relationship invalidations when blocking', async () => {
    const store = new ModerationStore();
    await getPool().query(
      `INSERT INTO friendships (rider_id, friend_id, created_at)
       VALUES ('alice', 'bob', 1), ('bob', 'alice', 1)`,
    );

    await store.block('alice', 'bob');
    await store.block('alice', 'bob');

    const { rows } = await getPool().query<{ event_type: string; actor_id: string; entity_id: string }>(
      `SELECT event_type, actor_id, entity_id
       FROM social_events
       WHERE rider_id = 'bob'
       ORDER BY seq`,
    );
    assert.deepEqual(rows, [
      { event_type: 'friend_removed', actor_id: 'alice', entity_id: 'alice' },
    ]);
  });

  it('resolves pending requests generically when a block removes them', async () => {
    const store = new ModerationStore();
    await getPool().query(
      `INSERT INTO friend_requests (id, from_rider_id, to_rider_id, status, created_at)
       VALUES ('request-1', 'bob', 'alice', 'pending', 1)`,
    );

    await store.block('alice', 'bob');

    const { rows } = await getPool().query<{ event_type: string; actor_id: string; entity_id: string }>(
      `SELECT event_type, actor_id, entity_id
       FROM social_events
       WHERE rider_id = 'bob'
       ORDER BY seq`,
    );
    assert.deepEqual(rows, [
      { event_type: 'friend_request_resolved', actor_id: 'alice', entity_id: 'request-1' },
    ]);
  });

  it('accepts a validated safety report', async () => {
    const report = await new ModerationStore().report('alice', 'bob', 'unsafe', 'Dangerous riding');
    assert.equal(report.reporterId, 'alice');
    assert.equal(report.reportedRiderId, 'bob');
    assert.equal(report.reason, 'unsafe');
    assert.ok(report.id);
  });
});
