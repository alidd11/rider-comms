import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SocialRateLimitStore, SOCIAL_RATE_POLICIES } from '../src/socialRateLimitStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('SocialRateLimitStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed social rate tests' }, () => {
  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE social_rate_events');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('enforces an exact sliding window and returns a retry delay', async () => {
    const store = new SocialRateLimitStore();
    const now = 1_000_000;
    const policy = SOCIAL_RATE_POLICIES.friend_request;

    for (let i = 0; i < policy.maxEvents; i += 1) {
      assert.deepEqual(await store.consume('alice', 'friend_request', now), {
        allowed: true,
        retryAfterSeconds: 0,
      });
    }

    assert.deepEqual(await store.consume('alice', 'friend_request', now), {
      allowed: false,
      retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
    });

    assert.deepEqual(await store.consume('alice', 'friend_request', now + policy.windowMs + 1), {
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('isolates limits by rider and social action', async () => {
    const store = new SocialRateLimitStore();
    const now = 2_000_000;
    for (let i = 0; i < SOCIAL_RATE_POLICIES.safety_report.maxEvents; i += 1) {
      assert.equal((await store.consume('alice', 'safety_report', now)).allowed, true);
    }

    assert.equal((await store.consume('alice', 'safety_report', now)).allowed, false);
    assert.equal((await store.consume('alice', 'direct_message', now)).allowed, true);
    assert.equal((await store.consume('bob', 'safety_report', now)).allowed, true);
  });

  it('serialises concurrent attempts so the limit cannot be raced', async () => {
    const store = new SocialRateLimitStore();
    const policy = SOCIAL_RATE_POLICIES.friend_request;
    const attempts = await Promise.all(
      Array.from({ length: policy.maxEvents + 5 }, () => store.consume('race-rider', 'friend_request', 3_000_000)),
    );

    assert.equal(attempts.filter(({ allowed }) => allowed).length, policy.maxEvents);
    assert.equal(attempts.filter(({ allowed }) => !allowed).length, 5);

    const { rows } = await getPool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM social_rate_events WHERE actor_id = $1 AND action = $2',
      ['race-rider', 'friend_request'],
    );
    assert.equal(Number(rows[0]?.count), policy.maxEvents);
  });

  it('cleans expired rows belonging to inactive riders', async () => {
    const store = new SocialRateLimitStore();
    const now = 4_000_000;
    assert.equal((await store.consume('old-a', 'friend_request', now)).allowed, true);
    assert.equal((await store.consume('old-b', 'direct_message', now)).allowed, true);
    assert.equal((await store.consume('old-c', 'safety_report', now)).allowed, true);

    const deleted = await store.cleanupExpired(now + SOCIAL_RATE_POLICIES.safety_report.windowMs + 1);
    assert.equal(deleted, 3);
    assert.equal((await getPool().query('SELECT 1 FROM social_rate_events')).rowCount, 0);
  });
});
