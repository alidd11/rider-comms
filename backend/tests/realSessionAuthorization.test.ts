import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'correct-horse-battery';

/**
 * Security regression through real account-issued bearer sessions and the
 * production HTTP router. Unlike createTestSession(), these sessions are
 * persisted and can be revoked in Postgres. No real accounts are touched.
 */
describe('real-session cross-account authorization', {
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

  async function signUp() {
    const username = 'secflow_' + randomUUID().replace(/-/g, '').slice(0, 12);
    const session = await ctx.authStore.signUp(username, username + '@example.com', PASSWORD);
    assert.ok('token' in session);
    created.push(session.riderId);
    return { ...session, username };
  }

  const call = (token: string, path: string, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) =>
    fetch(ctx.baseUrl() + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it('isolates direct messages, blocks and staff access; revocation kills all protected HTTP access', async () => {
    const a = await signUp();
    const b = await signUp();
    const c = await signUp();

    // Verify the three synthetic sign-ups as the email-confirmation service
    // would. This keeps the actual verified-email gate enabled in the router.
    await getPool().query(
      'UPDATE users SET email_verified_at = now() WHERE id = ANY($1::text[])',
      [[a.riderId, b.riderId, c.riderId]],
    );

    const request = await call(a.token, '/friends/requests', 'POST', { toRiderId: b.riderId });
    assert.equal(request.status, 201);
    const pending = await request.json() as { id: string };
    assert.equal((await call(b.token, '/friends/requests/' + pending.id + '/accept', 'POST', {})).status, 200);

    const uniqueText = 'private regression ' + randomUUID();
    const sent = await call(a.token, '/messages', 'POST', {
      toRiderId: b.riderId, fromRiderId: c.riderId, text: uniqueText,
    });
    assert.equal(sent.status, 201);
    const message = await sent.json() as { id: string; fromRiderId: string; toRiderId: string };
    assert.equal(message.fromRiderId, a.riderId, 'body cannot spoof sender');
    assert.equal(message.toRiderId, b.riderId);

    const readThread = (token: string, peer: string) =>
      call(token, '/messages?withRiderId=' + encodeURIComponent(peer));
    const aThread = await readThread(a.token, b.riderId);
    const bThread = await readThread(b.token, a.riderId);
    assert.equal(aThread.status, 200);
    assert.equal(bThread.status, 200);
    assert.ok(JSON.stringify(await aThread.json()).includes(uniqueText));
    assert.ok(JSON.stringify(await bThread.json()).includes(uniqueText));

    assert.equal((await readThread(c.token, a.riderId)).status, 403,
      'unrelated account cannot read someone else\'s DMs');
    assert.equal((await call(c.token, '/messages/read', 'POST', { withRiderId: a.riderId })).status, 403);
    assert.equal((await call(c.token, '/messages/' + message.id, 'DELETE')).status, 404);
    const conversations = await call(c.token, '/conversations');
    assert.equal(conversations.status, 200);
    assert.equal(JSON.stringify(await conversations.json()).includes(uniqueText), false,
      'conversation listings must not disclose another pair\'s message');
    assert.equal((await getPool().query(
      'SELECT 1 FROM direct_message_reads WHERE rider_id = $1', [c.riderId],
    )).rowCount, 0, 'denied read attempt must not mutate another conversation');
    assert.equal((await getPool().query(
      'SELECT 1 FROM direct_messages WHERE id = $1', [message.id],
    )).rowCount, 1, 'denied delete must not remove the sender\'s message');

    assert.equal((await call(b.token, '/blocks', 'POST', { riderId: a.riderId })).status, 200);
    assert.equal((await readThread(a.token, b.riderId)).status, 403);
    assert.equal((await readThread(b.token, a.riderId)).status, 403);
    assert.equal((await call(a.token, '/messages', 'POST', {
      toRiderId: b.riderId, text: 'contact after block',
    })).status, 403);
    assert.equal((await getPool().query(
      'SELECT 1 FROM friendships WHERE (rider_id = $1 AND friend_id = $2) OR (rider_id = $2 AND friend_id = $1)',
      [a.riderId, b.riderId],
    )).rowCount, 0, 'block revokes friendship on both sides');

    const spoofed = await call(c.token, '/admin/me', 'GET', undefined, {
      'X-Rider-Id': a.riderId, 'X-Staff-Role': 'admin',
    });
    assert.equal(spoofed.status, 403);
    assert.equal((await getPool().query(
      'SELECT 1 FROM staff_roles WHERE rider_id = $1', [c.riderId],
    )).rowCount, 0);

    // Exercise durable account sessions rather than createTestSession's
    // in-memory fast path, and prove foreign revocation cannot damage a token.
    const secondary = await ctx.authStore.logIn(c.username, PASSWORD, 'Second security device');
    assert.ok('token' in secondary);
    const listing = await call(c.token, '/auth/sessions');
    assert.equal(listing.status, 200);
    const sessions = (await listing.json() as { sessions: Array<{ id: string; deviceName: string }> }).sessions;
    const target = sessions.find((s) => s.deviceName === 'Second security device');
    assert.ok(target, 'second device must have a durable session id');
    assert.equal((await call(a.token, '/auth/sessions/' + target.id, 'DELETE')).status, 404);
    assert.equal((await call(secondary.token, '/auth/me')).status, 200);
    assert.equal((await call(c.token, '/auth/sessions/' + target.id, 'DELETE')).status, 204);
    for (const path of ['/auth/me', '/auth/export', '/conversations', '/blocks']) {
      assert.equal((await call(secondary.token, path)).status, 401, 'revoked token must not access ' + path);
    }
    assert.equal((await call(c.token, '/auth/me')).status, 200, 'other session remains active');
    assert.equal((await getPool().query(
      'SELECT 1 FROM account_sessions WHERE id = $1', [target.id],
    )).rowCount, 0, 'revocation is durable in the database');
  });
});
