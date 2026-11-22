import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'correct-horse-battery';

/** Synthetic HTTP checks: never export or delete another rider via client-provided identity fields. */
describe('sensitive account HTTP ownership', {
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

  const signUp = async () => {
    const username = 'secacc_' + randomUUID().replace(/-/g, '').slice(0, 12);
    const result = await ctx.authStore.signUp(username, username + '@example.com', PASSWORD);
    assert.ok('token' in result, 'synthetic account creation succeeds');
    created.push(result.riderId);
    return { riderId: result.riderId, token: result.token };
  };
  const request = (token: string | null, path: string, init: RequestInit = {}) =>
    fetch(ctx.baseUrl() + path, {
      ...init,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

  it('denies unauthenticated export/deletion and ignores forged identity on each sensitive operation', async () => {
    const owner = await signUp();
    const stranger = await signUp();
    assert.equal((await request(null, '/auth/export')).status, 401);
    assert.equal((await request(null, '/auth/me', { method: 'DELETE' })).status, 401);
    assert.equal((await request(owner.token, '/auth/me')).status, 200);

    // Query strings and identity headers cannot turn an ordinary rider's export
    // into another person's full data export (messages, hideouts and devices).
    const forgedExport = await request(stranger.token,
      '/auth/export?riderId=' + encodeURIComponent(owner.riderId), {
        headers: { 'X-Rider-Id': owner.riderId, 'X-Staff-Role': 'admin' },
      });
    assert.equal(forgedExport.status, 200);
    const data = await forgedExport.json() as { account: { rider_id: string; email: string } };
    assert.equal(data.account.rider_id, stranger.riderId);
    assert.notEqual(data.account.rider_id, owner.riderId);
    assert.equal((await request(stranger.token, '/admin/riders/' + owner.riderId + '/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'forged staff request' }),
    })).status, 403);

    // Deletion is scoped to the bearer identity, regardless of untrusted body
    // fields, query parameters or custom role headers. Verify durable state.
    const attemptedImpersonation = await request(stranger.token,
      '/auth/me?riderId=' + encodeURIComponent(owner.riderId), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Rider-Id': owner.riderId,
          'X-Staff-Role': 'admin',
        },
        body: JSON.stringify({ riderId: owner.riderId, deleteRiderId: owner.riderId }),
      });
    assert.equal(attemptedImpersonation.status, 200);
    const remaining = await getPool().query<{ id: string }>(
      'SELECT id FROM users WHERE id = ANY($1::text[]) ORDER BY id',
      [[owner.riderId, stranger.riderId]],
    );
    assert.deepEqual(remaining.rows.map((row) => row.id), [owner.riderId]);
    assert.equal((await request(owner.token, '/auth/me')).status, 200,
      'another rider must remain signed in and undeleted');
    assert.equal((await request(stranger.token, '/auth/me')).status, 401,
      'the deleted rider session must no longer authorize any request');
    assert.equal((await request(stranger.token, '/auth/export')).status, 401);
  });
  it('requires a recent password on the same session when the staged gate is on', async () => {
    const previous = process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED;
    process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED = 'true';
    try {
      const a = await signUp();
      const b = await signUp();
      const deletion = (token: string) => request(token, '/auth/me', { method: 'DELETE' });
      const confirm = (token: string, password: string) => request(token, '/auth/reauthenticate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      });
      assert.equal((await request(a.token, '/auth/export')).status, 403);
      assert.equal((await deletion(a.token)).status, 403);
      assert.equal((await confirm(a.token, 'incorrect-password')).status, 401);
      assert.equal((await request(a.token, '/auth/me')).status, 200);
      assert.equal((await confirm(b.token, PASSWORD)).status, 200);
      assert.equal((await request(a.token, '/auth/export')).status, 403);
      assert.equal((await deletion(a.token)).status, 403);
      assert.equal((await request(b.token, '/auth/export')).status, 200);
      assert.equal((await confirm(a.token, PASSWORD)).status, 200);
      const exported = await request(a.token, '/auth/export');
      assert.equal(exported.status, 200);
      assert.equal((await exported.json() as { account: { rider_id: string } }).account.rider_id, a.riderId);
      assert.equal((await deletion(a.token)).status, 200);
      assert.equal((await request(a.token, '/auth/me')).status, 401);
      assert.equal((await request(b.token, '/auth/me')).status, 200);
    } finally {
      if (previous === undefined) delete process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED;
      else process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED = previous;
    }
  });

});
