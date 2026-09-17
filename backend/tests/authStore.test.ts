import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AuthStore } from '../src/authStore.ts';
import { AccountDeletionStore } from '../src/accountDeletionStore.ts';
import type { sendPasswordResetEmail, sendVerificationEmail } from '../src/email.ts';
import { getPool, resetDbForTests } from '../src/db.ts';

describe('AuthStore', () => { it('issues unique readable IDs and authenticates the matching token', async () => { const store = new AuthStore(); const a = store.createGuest(); const b = store.createGuest(); assert.match(a.riderId, /^rider_[a-z2-9]{8}$/); assert.notEqual(a.riderId, b.riderId); assert.equal(await store.riderForToken(a.token), a.riderId); assert.equal(await store.riderForToken(`${a.token}x`), undefined); }); });

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

  function uniqueEmail(): string {
    return `${uniqueUsername()}@example.com`;
  }

  /**
   * Fake sender that never calls Resend (or the network at all) — records
   * every call so tests can assert on it, and hands back the raw token so
   * a test can drive the verify-email flow without a live inbox. This is
   * the same "inject the network call" shape as mobile/tests/places.test.ts's
   * fakeFetch, one level up: authStore.ts takes a whole sendVerificationEmail
   * function rather than a fetch, since that's the seam it already has.
   */
  function fakeSender(): { fn: typeof sendVerificationEmail; calls: { email: string; token: string }[] } {
    const calls: { email: string; token: string }[] = [];
    const fn: typeof sendVerificationEmail = async (email, token) => {
      calls.push({ email, token });
      return true;
    };
    return { fn, calls };
  }

  function fakeResetSender(): { fn: typeof sendPasswordResetEmail; calls: { email: string; token: string }[] } {
    const calls: { email: string; token: string }[] = [];
    const fn: typeof sendPasswordResetEmail = async (email, token) => {
      calls.push({ email, token });
      return true;
    };
    return { fn, calls };
  }

  it('signs up a new account, issues a working session, and sends a verification email', async () => {
    const { fn, calls } = fakeSender();
    const store = new AuthStore(fn);
    const username = uniqueUsername();
    const email = uniqueEmail();
    const result = await store.signUp(username, email, 'correct-horse-battery');
    assert.ok(!('error' in result), `expected success, got ${JSON.stringify(result)}`);
    if ('error' in result) return;
    assert.match(result.riderId, /^rider_[a-z2-9]{8}$/);
    assert.equal(await store.riderForToken(result.token), result.riderId);
    assert.equal(result.emailVerified, false);
    assert.equal(result.emailVerificationSent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].email, email);
    assert.ok(calls[0].token.length > 0);
  });

  it('rejects a duplicate username, case-insensitively', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const username = uniqueUsername();
    const first = await store.signUp(username, uniqueEmail(), 'correct-horse-battery');
    assert.ok(!('error' in first));
    const second = await store.signUp(username.toUpperCase(), uniqueEmail(), 'another-strong-password');
    assert.deepEqual(second, { error: 'username_taken' });
  });

  it('rejects a duplicate email, case-insensitively', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const email = uniqueEmail();
    const first = await store.signUp(uniqueUsername(), email, 'correct-horse-battery');
    assert.ok(!('error' in first));
    const second = await store.signUp(uniqueUsername(), email.toUpperCase(), 'another-strong-password');
    assert.deepEqual(second, { error: 'email_taken' });
  });

  it('rejects an invalid email', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const result = await store.signUp(uniqueUsername(), 'not-an-email', 'correct-horse-battery');
    assert.deepEqual(result, { error: 'invalid_email' });
  });

  it('rejects a password shorter than 8 characters', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const result = await store.signUp(uniqueUsername(), uniqueEmail(), 'short1');
    assert.deepEqual(result, { error: 'weak_password' });
  });

  it('rejects an invalid username', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const result = await store.signUp('a b!', uniqueEmail(), 'correct-horse-battery');
    assert.deepEqual(result, { error: 'invalid_username' });
  });

  it('logs in with the correct username and password, case-insensitively, and reports emailVerified: false before verification', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const username = uniqueUsername();
    const signedUp = await store.signUp(username, uniqueEmail(), 'correct-horse-battery');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    const loggedIn = await store.logIn(username.toUpperCase(), 'correct-horse-battery');
    assert.ok(!('error' in loggedIn));
    if ('error' in loggedIn) return;
    assert.equal(loggedIn.riderId, signedUp.riderId);
    assert.equal(loggedIn.emailVerified, false);
    assert.equal(await store.riderForToken(loggedIn.token), signedUp.riderId);
  });

  it('persists account sessions across AuthStore instances and supports revocation', async () => {
    const { fn } = fakeSender();
    const firstProcess = new AuthStore(fn);
    const signedUp = await firstProcess.signUp(uniqueUsername(), uniqueEmail(), 'correct-horse-battery');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;

    const restartedProcess = new AuthStore(fn);
    assert.equal(await restartedProcess.riderForToken(signedUp.token), signedUp.riderId);
    await restartedProcess.revokeToken(signedUp.token);
    assert.equal(await firstProcess.riderForToken(signedUp.token), undefined);
    const nextProcess = new AuthStore(fn);
    assert.equal(await nextProcess.riderForToken(signedUp.token), undefined);
  });

  it('lists named sessions, identifies the current token, and revokes another device', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const signedUp = await store.signUp(uniqueUsername(), uniqueEmail(), 'correct-horse-battery', 'iPhone');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    const second = await store.logIn((await store.getIdentity(signedUp.riderId))!.username, 'correct-horse-battery', 'Web app');
    assert.ok(!('error' in second));
    if ('error' in second) return;

    const sessions = await store.listSessions(signedUp.riderId, signedUp.token);
    assert.equal(sessions.length, 2);
    assert.equal(sessions.find((session) => session.current)?.deviceName, 'iPhone');
    const other = sessions.find((session) => !session.current)!;
    assert.equal(other.deviceName, 'Web app');
    assert.equal(await store.revokeSession(signedUp.riderId, other.id), true);
    assert.equal(await store.riderForToken(second.token), undefined);
  });

  it('reports when verification email delivery is unavailable without blocking signup', async () => {
    const sender: typeof sendVerificationEmail = async () => false;
    const store = new AuthStore(sender);
    const signedUp = await store.signUp(uniqueUsername(), uniqueEmail(), 'correct-horse-battery');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    assert.equal(signedUp.emailVerificationSent, false);
  });

  it('rejects excessively long passwords before running scrypt', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const result = await store.signUp(uniqueUsername(), uniqueEmail(), 'x'.repeat(129));
    assert.deepEqual(result, { error: 'weak_password' });
  });

  it('rejects login with the wrong password', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const username = uniqueUsername();
    await store.signUp(username, uniqueEmail(), 'correct-horse-battery');
    const result = await store.logIn(username, 'wrong-password');
    assert.deepEqual(result, { error: 'invalid_credentials' });
  });

  it('rejects login for an unknown username', async () => {
    const store = new AuthStore();
    const result = await store.logIn(uniqueUsername(), 'whatever-password');
    assert.deepEqual(result, { error: 'invalid_credentials' });
  });

  it('verifies the email from the token sent at signup, flips emailVerified on login, and rejects reuse of the same token', async () => {
    const { fn, calls } = fakeSender();
    const store = new AuthStore(fn);
    const username = uniqueUsername();
    const signedUp = await store.signUp(username, uniqueEmail(), 'correct-horse-battery');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    const token = calls[0].token;

    const verified = await store.verifyEmail(token);
    assert.ok(!('error' in verified), `expected success, got ${JSON.stringify(verified)}`);
    if ('error' in verified) return;
    assert.equal(verified.riderId, signedUp.riderId);
    assert.equal(verified.verified, true);

    const loggedIn = await store.logIn(username, 'correct-horse-battery');
    assert.ok(!('error' in loggedIn));
    if ('error' in loggedIn) return;
    assert.equal(loggedIn.emailVerified, true);

    const reused = await store.verifyEmail(token);
    assert.deepEqual(reused, { error: 'invalid_token' });
  });

  it('rejects an unknown or malformed verification token', async () => {
    const store = new AuthStore();
    const result = await store.verifyEmail('not-a-real-token');
    assert.deepEqual(result, { error: 'invalid_token' });
  });

  it('rejects an expired verification token', async () => {
    const { fn, calls } = fakeSender();
    const store = new AuthStore(fn);
    const username = uniqueUsername();
    const signedUp = await store.signUp(username, uniqueEmail(), 'correct-horse-battery');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    const token = calls[0].token;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await getPool().query('UPDATE email_verifications SET expires_at = now() - interval \'1 hour\' WHERE token_hash = $1', [tokenHash]);

    const result = await store.verifyEmail(token);
    assert.deepEqual(result, { error: 'expired_token' });
    // Expired tokens are invalidated on the failed attempt, same as a used one.
    const retried = await store.verifyEmail(token);
    assert.deepEqual(retried, { error: 'invalid_token' });
  });

  it('resend-verification re-issues a working token that supersedes the original', async () => {
    const { fn, calls } = fakeSender();
    const store = new AuthStore(fn);
    const username = uniqueUsername();
    const signedUp = await store.signUp(username, uniqueEmail(), 'correct-horse-battery');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    const originalToken = calls[0].token;

    const resent = await store.resendVerification(signedUp.riderId);
    assert.deepEqual(resent, { sent: true });
    assert.equal(calls.length, 2);
    const newToken = calls[1].token;
    assert.notEqual(newToken, originalToken);

    // The superseded token no longer works.
    assert.deepEqual(await store.verifyEmail(originalToken), { error: 'invalid_token' });
    // The freshly issued one does.
    const verified = await store.verifyEmail(newToken);
    assert.ok(!('error' in verified));
  });

  it('rejects resend-verification once the email is already verified', async () => {
    const { fn, calls } = fakeSender();
    const store = new AuthStore(fn);
    const username = uniqueUsername();
    const signedUp = await store.signUp(username, uniqueEmail(), 'correct-horse-battery');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    await store.verifyEmail(calls[0].token);

    const result = await store.resendVerification(signedUp.riderId);
    assert.deepEqual(result, { error: 'already_verified' });
  });

  it('rejects resend-verification for an unknown rider', async () => {
    const store = new AuthStore();
    const result = await store.resendVerification('rider_doesnotexist');
    assert.deepEqual(result, { error: 'not_found' });
  });

  it('resets a password with a single-use token and revokes every existing session', async () => {
    const verification = fakeSender();
    const reset = fakeResetSender();
    const store = new AuthStore(verification.fn, reset.fn);
    const username = uniqueUsername();
    const email = uniqueEmail();
    const signedUp = await store.signUp(username, email, 'old-password-value');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    const secondSession = await store.logIn(username, 'old-password-value');
    assert.ok(!('error' in secondSession));
    if ('error' in secondSession) return;

    assert.deepEqual(await store.requestPasswordReset(email.toUpperCase()), { accepted: true });
    assert.equal(reset.calls.length, 1);
    assert.equal(reset.calls[0].email, email);
    const token = reset.calls[0].token;
    assert.deepEqual(await store.resetPassword(token, 'new-password-value'), { reset: true });
    assert.equal(await store.riderForToken(signedUp.token), undefined);
    assert.equal(await store.riderForToken(secondSession.token), undefined);
    assert.deepEqual(await store.logIn(username, 'old-password-value'), { error: 'invalid_credentials' });
    assert.ok(!('error' in await store.logIn(username, 'new-password-value')));
    assert.deepEqual(await store.resetPassword(token, 'another-password'), { error: 'invalid_token' });
  });

  it('does not reveal unknown reset emails and rejects weak or expired resets', async () => {
    const verification = fakeSender();
    const reset = fakeResetSender();
    const store = new AuthStore(verification.fn, reset.fn);
    const email = uniqueEmail();
    const signedUp = await store.signUp(uniqueUsername(), email, 'old-password-value');
    assert.ok(!('error' in signedUp));
    assert.deepEqual(await store.requestPasswordReset('missing@example.com'), { accepted: true });
    assert.equal(reset.calls.length, 0);
    assert.deepEqual(await store.requestPasswordReset(email), { accepted: true });
    const token = reset.calls[0].token;
    assert.deepEqual(await store.resetPassword(token, 'short'), { error: 'weak_password' });
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await getPool().query("UPDATE password_resets SET expires_at = now() - interval '1 hour' WHERE token_hash = $1", [tokenHash]);
    assert.deepEqual(await store.resetPassword(token, 'valid-new-password'), { error: 'expired_token' });
    assert.deepEqual(await store.resetPassword(token, 'valid-new-password'), { error: 'invalid_token' });
  });

  it('deletes the persistent account and all of its sessions', async () => {
    const { fn } = fakeSender();
    const store = new AuthStore(fn);
    const username = uniqueUsername();
    const signedUp = await store.signUp(username, uniqueEmail(), 'correct-horse-battery');
    assert.ok(!('error' in signedUp));
    if ('error' in signedUp) return;
    await new AccountDeletionStore().deleteRider(signedUp.riderId);
    store.forgetRider(signedUp.riderId);
    assert.equal(await store.hasRider(signedUp.riderId), false);
    assert.equal(await new AuthStore(fn).riderForToken(signedUp.token), undefined);
    const { rowCount } = await getPool().query('SELECT 1 FROM users WHERE id = $1', [signedUp.riderId]);
    assert.equal(rowCount, 0);
  });
});
