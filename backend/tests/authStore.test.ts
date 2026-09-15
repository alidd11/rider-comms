import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AuthStore } from '../src/authStore.ts';
import { getPool, resetDbForTests } from '../src/db.ts';

describe('AuthStore', () => { it('issues unique readable IDs and authenticates the matching token', () => { const store = new AuthStore(); const a = store.createGuest(); const b = store.createGuest(); assert.match(a.riderId, /^rider_[a-z2-9]{8}$/); assert.notEqual(a.riderId, b.riderId); assert.equal(store.riderForToken(a.token), a.riderId); assert.equal(store.riderForToken(`${a.token}x`), undefined); }); });

// The username/password account flow is backed by real Postgres (see
// db.ts) — these tests need DATABASE_URL to point at a reachable Postgres
// instance and are skipped otherwise, rather than failing every run in a
// sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('AuthStore account signup/login (Postgres-backed)', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed auth tests' }, () => {
  before(async () => {
    // Sanity-check connectivity before running the suite so a bad
    // DATABASE_URL fails fast with a clear reason instead of a wall of
    // per-test connection errors.
    try {
      await getPool().query('SELECT 1');
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  after(async () => {
    await getPool().query("DELETE FROM users WHERE username LIKE 'tst_%'");
    await resetDbForTests();
  });

  // USERNAME_PATTERN in authStore.ts caps usernames at 20 chars, so keep
  // this prefix + random suffix comfortably under that.
  function uniqueUsername(): string {
    return `tst_${Math.random().toString(36).slice(2, 10)}`;
  }

  it('signs up a new account and issues a working session', async () => {
    const store = new AuthStore();
    const username = uniqueUsername();
    const result = await store.signUp(username, 'correct-horse-battery');
    assert.ok(!('error' in result), `expected success, got ${JSON.stringify(result)}`);
    if ('error' in result) return;
    assert.match(result.riderId, /^rider_[a-z2-9]{8}$/);
    assert.equal(store.riderForToken(result.token), result.riderId);
  });

  it('rejects a duplicate username, case-insensitively', async () => {
    const store = new AuthStore();
    const username = uniqueUsername();
    const first = await store.signUp(username, 'correct-horse-battery');
    assert.ok(!('error' in first));
    const second = await store.signUp(username.toUpperCase(), 'another-strong-password');
    assert.deepEqual(second, { error: 'username_taken' });
  });

  it('rejects a password shorter than 8 characters', async () => {
    const store = new AuthStore();
    const result = await store.signUp(uniqueUsername(), 'short1');
    assert.deepEqual(result, { error: 'weak_password' });
  });

  it('rejects an invalid username', async () => {
    const store = new AuthStore();
    const result = await store.signUp('a b!', 'correct-horse-battery');
    assert.deepEqual(result, { error: 'invalid_username' });
  });

  it('logs in with the correct username and password, case-insensitively', async () => {
    const store = new AuthStore();
    const username = uniqueUsername();
    const signedUp = await store.signUp(username, 'correct-horse-battery');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    const loggedIn = await store.logIn(username.toUpperCase(), 'correct-horse-battery');
    assert.ok(!('error' in loggedIn));
    if ('error' in loggedIn) return;
    assert.equal(loggedIn.riderId, signedUp.riderId);
    assert.equal(store.riderForToken(loggedIn.token), signedUp.riderId);
  });

  it('rejects login with the wrong password', async () => {
    const store = new AuthStore();
    const username = uniqueUsername();
    await store.signUp(username, 'correct-horse-battery');
    const result = await store.logIn(username, 'wrong-password');
    assert.deepEqual(result, { error: 'invalid_credentials' });
  });

  it('rejects login for an unknown username', async () => {
    const store = new AuthStore();
    const result = await store.logIn(uniqueUsername(), 'whatever-password');
    assert.deepEqual(result, { error: 'invalid_credentials' });
  });
});
