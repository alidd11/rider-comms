import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { postJson, startTestServer } from './httpTestUtils.ts';
import type { SocialRateAction } from '../src/socialRateLimitStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('social write abuse controls', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed social abuse tests' }, () => {
  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
    await getPool().query(
      'TRUNCATE social_rate_events, friend_requests, friendships, direct_messages, rider_blocks, safety_reports',
    );
  });

  after(async () => {
    await resetDbForTests();
  });

  it('maps friend requests, direct messages, and safety reports onto dedicated limits', async () => {
    const consumed: Array<{ actorId: string; action: SocialRateAction }> = [];
    const ctx = startTestServer({
      socialRateLimitStore: {
        consume: async (actorId: string, action: SocialRateAction) => {
          consumed.push({ actorId, action });
          return { allowed: false, retryAfterSeconds: 17 };
        },
      },
    });
    await ctx.ready;

    try {
      ctx.authStore.createTestSession('abuse-friend-target');
      const friend = await postJson(ctx, 'abuse-friend-sender', '/friends/requests', {
        toRiderId: 'abuse-friend-target',
      });
      assert.equal(friend.status, 429);
      assert.equal(friend.headers.get('retry-after'), '17');
      assert.deepEqual(await friend.json(), { error: 'rate_limited' });

      ctx.authStore.createTestSession('abuse-message-sender');
      ctx.authStore.createTestSession('abuse-message-target');
      const pending = await ctx.friendStore.createRequest('abuse-message-sender', 'abuse-message-target');
      assert.equal(pending.ok, true);
      if (pending.ok) await ctx.friendStore.accept(pending.request.id);

      const message = await postJson(ctx, 'abuse-message-sender', '/messages', {
        toRiderId: 'abuse-message-target',
        text: 'flood attempt',
      });
      assert.equal(message.status, 429);
      assert.equal(message.headers.get('retry-after'), '17');

      ctx.authStore.createTestSession('abuse-report-target');
      const report = await postJson(ctx, 'abuse-reporter', '/reports', {
        riderId: 'abuse-report-target',
        reason: 'spam',
        details: 'Repeated unsolicited contact',
      });
      assert.equal(report.status, 429);
      assert.equal(report.headers.get('retry-after'), '17');

      assert.deepEqual(consumed, [
        { actorId: 'abuse-friend-sender', action: 'friend_request' },
        { actorId: 'abuse-message-sender', action: 'direct_message' },
        { actorId: 'abuse-reporter', action: 'safety_report' },
      ]);
    } finally {
      await ctx.close();
    }
  });

  it('does not spend social-write quota on invalid or unauthorised attempts', async () => {
    const consumed: SocialRateAction[] = [];
    const ctx = startTestServer({
      socialRateLimitStore: {
        consume: async (_actorId: string, action: SocialRateAction) => {
          consumed.push(action);
          return { allowed: true, retryAfterSeconds: 0 };
        },
      },
    });
    await ctx.ready;

    try {
      ctx.authStore.createTestSession('invalid-target');

      assert.equal((await postJson(ctx, 'invalid-message', '/messages', {
        toRiderId: 'invalid-target',
        text: 'not friends',
      })).status, 403);

      assert.equal((await postJson(ctx, 'invalid-friend', '/friends/requests', {
        toRiderId: 'invalid-friend',
      })).status, 400);

      assert.equal((await postJson(ctx, 'invalid-report', '/reports', {
        riderId: 'invalid-target',
        reason: 'not-a-reason',
      })).status, 400);

      assert.deepEqual(consumed, []);
    } finally {
      await ctx.close();
    }
  });
});
