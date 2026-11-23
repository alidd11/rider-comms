import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'synthetic-security-password';
const WINDOW_MS = 15 * 60_000;

/** Live PostgreSQL bearer sessions, never synthetic in-memory bypass tokens. */
describe('sensitive account step-up lifetime and revocation', {
  skip: !hasDatabase && 'DATABASE_URL not set; requires isolated PostgreSQL',
}, () => {
  let ctx: TestServer;
  const created: string[] = [];

  before(async () => {
    await ensureMigrated();
    ctx = startTestServer({ liveKitCredentials: null });
    await ctx.ready;
  });

  after(async () => {
    await ctx?.close();
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [created]);
    await resetDbForTests();
  });

  async function rider() {
    const username = 'stepup_' + randomUUID().replace(/-/g, '').slice(0, 12);
    const session = await ctx.authStore.signUp(username, username + '@example.com', PASSWORD);
    assert.ok('token' in session);
    created.push(session.riderId);
    return session;
  }

  const request = (token: string, path: string, method = 'GET', body?: unknown) =>
    fetch(ctx.baseUrl() + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('fails closed when a session was revoked during password confirmation', async () => {
    const a = await rider();
    await ctx.authStore.revokeToken(a.token);

    assert.equal(await ctx.authStore.reauthenticate(a.riderId, a.token, PASSWORD), false,
      'a correct password cannot revive a revoked bearer session');
    assert.equal(await ctx.authStore.recentlyReauthenticated(a.token, WINDOW_MS), false);
    assert.equal((await request(a.token, '/auth/me')).status, 401);
    const { rows } = await getPool().query<{ count: string }>(
      "SELECT count(*)::text AS count FROM security_events WHERE rider_id = $1 AND event = 'reauthenticated'",
      [a.riderId],
    );
    assert.equal(rows[0]?.count, '0', 'revoked token must not emit a successful step-up event');
  });

  it('rejects expired and cross-account bearer tokens even with a correct password', async () => {
    const a = await rider();
    const b = await rider();

    assert.equal(await ctx.authStore.reauthenticate(a.riderId, b.token, PASSWORD), false,
      'a token owned by a different rider must not authorize step-up');
    assert.equal(await ctx.authStore.recentlyReauthenticated(b.token, WINDOW_MS), false);

    await getPool().query(
      "UPDATE account_sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [a.riderId],
    );
    assert.equal(await ctx.authStore.reauthenticate(a.riderId, a.token, PASSWORD), false,
      'an expired session must never be marked reauthenticated');
    assert.equal(await ctx.authStore.recentlyReauthenticated(a.token, WINDOW_MS), false);
    assert.equal((await request(a.token, '/auth/me')).status, 401);
    assert.equal((await request(b.token, '/auth/me')).status, 200);
  });

  it('invalidates an earlier sensitive-action proof on incorrect or malformed password retry', async () => {
    const previous = process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED;
    process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED = 'true';
    try {
      const a = await rider();
      const b = await rider();
      const confirm = (token: string, body: unknown) => request(token, '/auth/reauthenticate', 'POST', body);

      assert.equal((await confirm(a.token, { password: PASSWORD })).status, 200);
      assert.equal((await confirm(b.token, { password: PASSWORD })).status, 200);
      assert.equal((await request(a.token, '/auth/export')).status, 200);
      assert.equal((await request(b.token, '/auth/export')).status, 200);

      assert.equal((await confirm(a.token, { password: 'incorrect-password' })).status, 401);
      assert.equal(await ctx.authStore.recentlyReauthenticated(a.token, WINDOW_MS), false);
      assert.equal((await request(a.token, '/auth/export')).status, 403,
        'a failed retry must revoke an older successful proof');
      assert.equal((await request(a.token, '/auth/me', 'DELETE')).status, 403);
      assert.equal((await request(a.token, '/auth/me')).status, 200,
        'a failed retry must not sign out the active rider');
      assert.equal((await request(b.token, '/auth/export')).status, 200,
        'a failed retry must not invalidate another session');

      assert.equal((await confirm(a.token, { password: PASSWORD })).status, 200);
      assert.equal((await request(a.token, '/auth/export')).status, 200);

      assert.equal((await confirm(a.token, { password: null })).status, 401);
      assert.equal(await ctx.authStore.recentlyReauthenticated(a.token, WINDOW_MS), false,
        'malformed password input must not preserve earlier proof');
      assert.equal((await request(a.token, '/auth/export')).status, 403);
      assert.equal((await request(b.token, '/auth/export')).status, 200);
    } finally {
      if (previous === undefined) delete process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED;
      else process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED = previous;
    }
  });

  it('enforces the 15-minute window independently of the authenticated session lifetime', async () => {
    const previous = process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED;
    process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED = 'true';
    try {
      const a = await rider();
      const b = await rider();
      assert.equal((await request(a.token, '/auth/export')).status, 403);
      assert.equal((await request(a.token, '/auth/me', 'DELETE')).status, 403);
      assert.equal((await request(a.token, '/auth/reauthenticate', 'POST',
        { password: 'incorrect' })).status, 401);
      assert.equal((await request(a.token, '/auth/me')).status, 200);

      const confirmed = await request(a.token, '/auth/reauthenticate', 'POST', { password: PASSWORD });
      assert.equal(confirmed.status, 200);
      assert.equal(await ctx.authStore.recentlyReauthenticated(a.token, WINDOW_MS), true);
      assert.equal((await request(a.token, '/auth/export')).status, 200);
      assert.equal((await request(b.token, '/auth/export')).status, 403,
        'one rider reauthenticating must not authorize a second rider');

      // Age only the password proof, not the valid bearer session.
      await getPool().query(
        "UPDATE account_sessions SET reauthenticated_at = now() - interval '16 minutes' WHERE user_id = $1",
        [a.riderId],
      );
      assert.equal(await ctx.authStore.recentlyReauthenticated(a.token, WINDOW_MS), false);
      assert.equal((await request(a.token, '/auth/export')).status, 403);
      assert.equal((await request(a.token, '/auth/me', 'DELETE')).status, 403);
      assert.equal((await request(a.token, '/auth/me')).status, 200,
        'an expired step-up proof must not sign the user out');
      assert.equal((await request(a.token, '/auth/reauthenticate', 'POST', { password: PASSWORD })).status, 200);
      const exported = await request(a.token, '/auth/export');
      assert.equal(exported.status, 200);
      assert.equal(exported.headers.get('cache-control'), 'no-store');
      assert.equal((await exported.json() as { account: { rider_id: string } }).account.rider_id, a.riderId);
      assert.equal((await request(b.token, '/auth/export')).status, 403);
    } finally {
      if (previous === undefined) delete process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED;
      else process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED = previous;
    }
  });
});
