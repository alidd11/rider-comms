import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIAL_ACTIVITY_RETENTION_MS,
  SOCIAL_ONLINE_WINDOW_MS,
  SocialActivityStore,
} from '../src/socialActivityStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('SocialActivityStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed social activity tests' }, () => {
  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE rider_activity, friendships, rider_blocks');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('coalesces frequent activity writes while keeping timestamps monotonic', async () => {
    const store = new SocialActivityStore();
    await store.touch('alice', 100_000);
    await store.touch('alice', 105_000);

    let { rows } = await getPool().query<{ last_seen_at: string | number }>(
      'SELECT last_seen_at FROM rider_activity WHERE rider_id = $1',
      ['alice'],
    );
    assert.equal(Number(rows[0]?.last_seen_at), 100_000);

    await store.touch('alice', 116_000);
    await store.touch('alice', 90_000);
    ({ rows } = await getPool().query<{ last_seen_at: string | number }>(
      'SELECT last_seen_at FROM rider_activity WHERE rider_id = $1',
      ['alice'],
    ));
    assert.equal(Number(rows[0]?.last_seen_at), 116_000);
  });

  it('exposes online and last-seen state only for current unblocked friends', async () => {
    const store = new SocialActivityStore();
    const now = 1_000_000;

    for (const friendId of ['online-friend', 'offline-friend', 'blocked-friend']) {
      await getPool().query(
        'INSERT INTO friendships (rider_id, friend_id, created_at) VALUES ($1, $2, $3)',
        ['me', friendId, now],
      );
    }
    await getPool().query(
      'INSERT INTO rider_blocks (rider_id, blocked_rider_id, created_at) VALUES ($1, $2, $3)',
      ['blocked-friend', 'me', now],
    );

    await store.touch('online-friend', now - 1_000);
    await store.touch('offline-friend', now - SOCIAL_ONLINE_WINDOW_MS - 1);
    await store.touch('blocked-friend', now);

    assert.deepEqual(await store.getFriendActivity('me', now), [
      {
        riderId: 'offline-friend',
        online: false,
        lastSeenAt: now - SOCIAL_ONLINE_WINDOW_MS - 1,
      },
      {
        riderId: 'online-friend',
        online: true,
        lastSeenAt: now - 1_000,
      },
    ]);
  });

  it('drops stale last-seen records after the retention window', async () => {
    const store = new SocialActivityStore();
    const now = 10_000_000_000;
    await store.touch('old', now - SOCIAL_ACTIVITY_RETENTION_MS - 1);
    await store.touch('fresh', now);

    assert.equal(await store.cleanupExpired(now), 1);
    const { rows } = await getPool().query<{ rider_id: string }>(
      'SELECT rider_id FROM rider_activity ORDER BY rider_id',
    );
    assert.deepEqual(rows.map(({ rider_id }) => rider_id), ['fresh']);
  });
});
