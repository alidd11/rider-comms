import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('social activity and realtime API', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed realtime API tests' }, () => {
  let ctx: TestServer;

  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });

  beforeEach(async () => {
    await getPool().query(
      'TRUNCATE social_events RESTART IDENTITY, rider_activity, friend_requests, friendships, direct_message_reads, direct_messages, rider_blocks, safety_reports, social_rate_events',
    );
  });

  after(async () => {
    await ctx.close();
    await resetDbForTests();
  });

  async function makeFriends(a: string, b: string): Promise<void> {
    ctx.authStore.createTestSession(b);
    const made = await postJson(ctx, a, '/friends/requests', { toRiderId: b });
    assert.equal(made.status, 201);
    const request = await made.json() as { id: string };
    assert.equal((await postJson(ctx, b, `/friends/requests/${request.id}/accept`, {})).status, 200);
  }

  it('reports online and last-seen state only through the current-friends endpoint', async () => {
    await makeFriends('activity-a', 'activity-b');
    ctx.authStore.createTestSession('not-a-friend');

    const response = await authenticatedFetch(ctx, 'activity-a', '/friends/activity');
    assert.equal(response.status, 200);
    const body = await response.json() as {
      activity: Array<{ riderId: string; online: boolean; lastSeenAt: number | null }>;
    };

    assert.equal(body.activity.length, 1);
    assert.equal(body.activity[0]?.riderId, 'activity-b');
    assert.equal(body.activity[0]?.online, true);
    assert.equal(typeof body.activity[0]?.lastSeenAt, 'number');
    assert.equal(body.activity.some(({ riderId }) => riderId === 'not-a-friend'), false);
  });

  it('establishes an event cursor without replaying old state, then returns new message events', async () => {
    await makeFriends('message-alice', 'message-bob');

    const baselineResponse = await authenticatedFetch(ctx, 'message-bob', '/social/events?waitMs=0');
    assert.equal(baselineResponse.status, 200);
    const baseline = await baselineResponse.json() as { events: unknown[]; cursor: string; hasMore: boolean };
    assert.deepEqual(baseline.events, []);
    assert.ok(baseline.cursor);

    const sent = await postJson(ctx, 'message-alice', '/messages', {
      toRiderId: 'message-bob',
      text: 'realtime hello',
    });
    assert.equal(sent.status, 201);
    const message = await sent.json() as { id: string };

    const eventsResponse = await authenticatedFetch(
      ctx,
      'message-bob',
      `/social/events?after=${encodeURIComponent(baseline.cursor)}&waitMs=0`,
    );
    assert.equal(eventsResponse.status, 200);
    const page = await eventsResponse.json() as {
      events: Array<{ type: string; actorRiderId: string; entityId: string; createdAt: number; text?: string }>;
      cursor: string;
      hasMore: boolean;
    };

    assert.equal(page.events.length, 1);
    assert.deepEqual(
      {
        type: page.events[0]?.type,
        actorRiderId: page.events[0]?.actorRiderId,
        entityId: page.events[0]?.entityId,
      },
      { type: 'message', actorRiderId: 'message-alice', entityId: message.id },
    );
    assert.equal('text' in (page.events[0] ?? {}), false);
    assert.notEqual(page.cursor, baseline.cursor);
    assert.equal(page.hasMore, false);
  });

  it('wakes a pending event request when a new message commits', async () => {
    await makeFriends('live-alice', 'live-bob');
    const baselineResponse = await authenticatedFetch(ctx, 'live-bob', '/social/events?waitMs=0');
    const baseline = await baselineResponse.json() as { cursor: string };

    const pending = authenticatedFetch(
      ctx,
      'live-bob',
      `/social/events?after=${encodeURIComponent(baseline.cursor)}&waitMs=2000`,
    );
    await new Promise((resolve) => setTimeout(resolve, 75));

    const sent = await postJson(ctx, 'live-alice', '/messages', {
      toRiderId: 'live-bob',
      text: 'wake up',
    });
    assert.equal(sent.status, 201);

    const response = await pending;
    assert.equal(response.status, 200);
    const page = await response.json() as { events: Array<{ type: string; actorRiderId: string }> };
    assert.deepEqual(page.events.map(({ type, actorRiderId }) => ({ type, actorRiderId })), [
      { type: 'message', actorRiderId: 'live-alice' },
    ]);
  });

  it('publishes friend-request invalidations to the affected peer', async () => {
    ctx.authStore.createTestSession('request-target');
    const baselineResponse = await authenticatedFetch(ctx, 'request-target', '/social/events?waitMs=0');
    const baseline = await baselineResponse.json() as { cursor: string };

    const made = await postJson(ctx, 'request-sender', '/friends/requests', { toRiderId: 'request-target' });
    assert.equal(made.status, 201);
    const request = await made.json() as { id: string };

    const eventsResponse = await authenticatedFetch(
      ctx,
      'request-target',
      `/social/events?after=${encodeURIComponent(baseline.cursor)}&waitMs=0`,
    );
    const page = await eventsResponse.json() as {
      events: Array<{ type: string; actorRiderId: string; entityId: string }>;
    };
    assert.deepEqual(page.events, [
      {
        cursor: (page.events[0] as { cursor?: string })?.cursor,
        type: 'friend_request',
        actorRiderId: 'request-sender',
        entityId: request.id,
        createdAt: (page.events[0] as { createdAt?: number })?.createdAt,
      },
    ]);
  });

  it('rejects malformed cursors and excessive long-poll windows', async () => {
    assert.equal(
      (await authenticatedFetch(ctx, 'cursor-rider', '/social/events?after=%25%25%25&waitMs=0')).status,
      400,
    );
    assert.equal(
      (await authenticatedFetch(ctx, 'cursor-rider', '/social/events?waitMs=25001')).status,
      400,
    );
  });
});
