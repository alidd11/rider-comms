import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendSocialEvent,
  decodeSocialEventCursor,
  encodeSocialEventCursor,
  InvalidSocialEventCursorError,
  SOCIAL_EVENT_RETENTION_MS,
  SocialEventStore,
} from '../src/socialEventStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

async function publish(
  riderId: string,
  actorId: string,
  entityId: string,
  createdAt = Date.now(),
): Promise<void> {
  const client = await getPool().connect();
  try {
    await appendSocialEvent(client, riderId, 'message', actorId, entityId, createdAt);
  } finally {
    client.release();
  }
}

describe('social event cursors', () => {
  it('round-trips canonical opaque cursors and rejects malformed ones', () => {
    const cursor = encodeSocialEventCursor('12345');
    assert.equal(decodeSocialEventCursor(cursor), '12345');
    assert.equal(decodeSocialEventCursor(undefined), undefined);
    assert.throws(() => decodeSocialEventCursor('not+base64url'), InvalidSocialEventCursorError);
    assert.throws(() => decodeSocialEventCursor(Buffer.from('01').toString('base64url')), InvalidSocialEventCursorError);
  });
});

describe('SocialEventStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed realtime tests' }, () => {
  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE social_events RESTART IDENTITY');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('establishes a tail cursor without replaying old events, then replays newer events in order', async () => {
    const store = new SocialEventStore();
    try {
      await publish('bob', 'alice', 'old-message', 1_000);
      const baseline = await store.establishCursor('bob');
      assert.deepEqual(baseline.events, []);

      await publish('bob', 'alice', 'message-2', 2_000);
      await publish('bob', 'charlie', 'message-3', 3_000);

      const page = await store.waitForEvents('bob', baseline.cursor, 10, 0);
      assert.deepEqual(page.events.map(({ actorRiderId, entityId, createdAt }) => ({ actorRiderId, entityId, createdAt })), [
        { actorRiderId: 'alice', entityId: 'message-2', createdAt: 2_000 },
        { actorRiderId: 'charlie', entityId: 'message-3', createdAt: 3_000 },
      ]);
      assert.equal(page.hasMore, false);
    } finally {
      await store.close();
    }
  });

  it('keeps event streams strictly recipient scoped', async () => {
    const store = new SocialEventStore();
    try {
      await publish('bob', 'alice', 'for-bob');
      await publish('mallory', 'alice', 'for-mallory');

      const page = await store.waitForEvents('bob', encodeSocialEventCursor(0), 10, 0);
      assert.deepEqual(page.events.map(({ entityId }) => entityId), ['for-bob']);
    } finally {
      await store.close();
    }
  });

  it('wakes a long poll through PostgreSQL LISTEN/NOTIFY', async () => {
    const store = new SocialEventStore();
    try {
      const baseline = await store.establishCursor('bob');
      const waiting = store.waitForEvents('bob', baseline.cursor, 10, 2_000);

      await new Promise((resolve) => setTimeout(resolve, 50));
      await publish('bob', 'alice', 'live-message');

      const page = await waiting;
      assert.deepEqual(page.events.map(({ entityId }) => entityId), ['live-message']);
    } finally {
      await store.close();
    }
  });

  it('cleans events after the replay retention window', async () => {
    const store = new SocialEventStore();
    const now = 10_000_000_000;
    try {
      await publish('bob', 'alice', 'old', now - SOCIAL_EVENT_RETENTION_MS - 1);
      await publish('bob', 'alice', 'fresh', now);

      assert.equal(await store.cleanupExpired(now), 1);
      const page = await store.waitForEvents('bob', encodeSocialEventCursor(0), 10, 0);
      assert.deepEqual(page.events.map(({ entityId }) => entityId), ['fresh']);
    } finally {
      await store.close();
    }
  });
});
