import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimitStore, RATE_LIMIT_POLICIES } from '../src/rateLimitStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('RateLimitStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed rate-limit tests' }, () => {
  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE rate_limit_events');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('enforces an exact sliding window and returns the remaining retry delay', async () => {
    const store = new RateLimitStore();
    const now = 1_000_000;
    const policy = RATE_LIMIT_POLICIES.password_reset_request;

    for (let i = 0; i < policy.maxEvents; i += 1) {
      assert.deepEqual(await store.consume('ip-hash-a', 'password_reset_request', now), {
        allowed: true,
        retryAfterSeconds: 0,
      });
    }

    assert.deepEqual(await store.consume('ip-hash-a', 'password_reset_request', now), {
      allowed: false,
      retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
    });

    assert.deepEqual(await store.consume('ip-hash-a', 'password_reset_request', now + policy.windowMs + 1), {
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('shares limits across store instances while isolating subjects and actions', async () => {
    const first = new RateLimitStore();
    const second = new RateLimitStore();
    const now = 2_000_000;
    const policy = RATE_LIMIT_POLICIES.verification_resend;

    for (let i = 0; i < policy.maxEvents; i += 1) {
      assert.equal((await first.consume('rider-hash-a', 'verification_resend', now)).allowed, true);
    }

    assert.equal((await second.consume('rider-hash-a', 'verification_resend', now)).allowed, false);
    assert.equal((await second.consume('rider-hash-b', 'verification_resend', now)).allowed, true);
    assert.equal((await second.consume('rider-hash-a', 'hazard_create', now)).allowed, true);
  });

  it('serialises concurrent attempts so replicas cannot race the final slot', async () => {
    const store = new RateLimitStore();
    const policy = RATE_LIMIT_POLICIES.password_reset_request;
    const attempts = await Promise.all(
      Array.from({ length: policy.maxEvents + 5 }, () => store.consume('race-key', 'password_reset_request', 3_000_000)),
    );

    assert.equal(attempts.filter(({ allowed }) => allowed).length, policy.maxEvents);
    assert.equal(attempts.filter(({ allowed }) => !allowed).length, 5);

    const { rows } = await getPool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM rate_limit_events WHERE subject_key = $1 AND action = $2',
      ['race-key', 'password_reset_request'],
    );
    assert.equal(Number(rows[0]?.count), policy.maxEvents);
  });

  it('cleans expired rows using the longest configured window', async () => {
    const store = new RateLimitStore();
    const now = 4_000_000;
    assert.equal((await store.consume('old-a', 'auth', now)).allowed, true);
    assert.equal((await store.consume('old-b', 'api', now)).allowed, true);
    assert.equal((await store.consume('old-c', 'hazard_create', now)).allowed, true);

    const deleted = await store.cleanupExpired(now + RATE_LIMIT_POLICIES.hazard_create.windowMs + 1);
    assert.equal(deleted, 3);
    assert.equal((await getPool().query('SELECT 1 FROM rate_limit_events')).rowCount, 0);
  });
});
