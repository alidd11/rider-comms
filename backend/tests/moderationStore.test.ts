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

    const selfRefresh = await getPool().query<{ event_type: string; actor_id: string; entity_id: string }>(
      `SELECT event_type, actor_id, entity_id
       FROM social_events
       WHERE rider_id = 'alice' AND event_type = 'social_refresh'
       ORDER BY seq`,
    );
    assert.deepEqual(selfRefresh.rows, [
      { event_type: 'social_refresh', actor_id: 'alice', entity_id: 'blocks' },
      { event_type: 'social_refresh', actor_id: 'alice', entity_id: 'blocks' },
    ]);
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
    const mirrored = await getPool().query<{ rider_id: string; event_type: string }>(
      `SELECT rider_id, event_type
       FROM social_events
       WHERE event_type IN ('friend_removed', 'social_refresh')
       ORDER BY seq`,
    );
    assert.deepEqual(mirrored.rows, [
      { rider_id: 'alice', event_type: 'friend_removed' },
      { rider_id: 'bob', event_type: 'friend_removed' },
      { rider_id: 'alice', event_type: 'social_refresh' },
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
    const mirrored = await getPool().query<{ rider_id: string }>(
      `SELECT rider_id
       FROM social_events
       WHERE event_type = 'friend_request_resolved' AND entity_id = 'request-1'
       ORDER BY rider_id`,
    );
    assert.deepEqual(mirrored.rows.map(({ rider_id }) => rider_id), ['alice', 'bob']);
  });

  it('accepts a validated safety report', async () => {
    const report = await new ModerationStore().report('alice', 'bob', 'unsafe', 'Dangerous riding');
    assert.equal(report.reporterId, 'alice');
    assert.equal(report.reportedRiderId, 'bob');
    assert.equal(report.reason, 'unsafe');
    assert.ok(report.id);
  });
});
