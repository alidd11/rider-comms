import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { SECURITY_EVENT_RETENTION_MS, sessionTokenHash } from '../src/authStore.ts';
import { STAFF_REAUTH_WINDOW_MS } from '../src/routes/context.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'correct-horse-battery';

describe('security events and staff re-authentication', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const created: string[] = [];
  const unique = () => `sec_${Math.random().toString(36).slice(2, 10)}`;

  async function signUp(): Promise<{ riderId: string; token: string; username: string }> {
    const username = unique();
    const result = await ctx.authStore.signUp(username, `${username}@example.com`, PASSWORD, 'Test phone');
    assert.ok('token' in result);
    created.push(result.riderId);
    return { riderId: result.riderId, token: result.token, username };
  }
  const call = (token: string, path: string, init: RequestInit = {}) => fetch(`${ctx.baseUrl()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const events = async (riderId: string) => (await ctx.authStore.listSecurityEvents({ riderId })).map((event) => event.event);

  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });
  after(async () => {
    await ctx.close();
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [created]);
    await resetDbForTests();
  });

  it('records sign-ups, sign-ins, failed passwords, sign-outs and revoked devices', async () => {
    const { riderId, username } = await signUp();
    assert.equal('error' in await ctx.authStore.logIn(username, 'wrong-password'), true);
    const second = await ctx.authStore.logIn(username, PASSWORD, 'Laptop');
    assert.ok('token' in second);
    await ctx.authStore.revokeToken(second.token);
    const third = await ctx.authStore.logIn(username, PASSWORD);
    assert.ok('token' in third);
    const sessions = await ctx.authStore.listSessions(riderId, third.token);
    const other = sessions.find((session) => !session.current)!;
    assert.equal(await ctx.authStore.revokeSession(riderId, other.id), true);
    assert.deepEqual((await events(riderId)).reverse(), ['account_created', 'login_failed', 'login', 'signed_out', 'login', 'session_revoked']);

    const mine = await call(third.token, '/auth/security-events');
    assert.equal(mine.status, 200);
    const body = await mine.json() as { events: { event: string; device: string | null }[] };
    assert.equal(body.events.length, 6);
    assert.equal(body.events.at(-1)!.device, 'Test phone');
  });

  it('records a password reset', async () => {
    const { riderId } = await signUp();
    await getPool().query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval \'1 hour\')', [sessionTokenHash('reset-token-sec'), riderId]);
    assert.deepEqual(await ctx.authStore.resetPassword('reset-token-sec', 'another-strong-password'), { reset: true });
    assert.equal((await events(riderId))[0], 'password_reset');
  });

  it('makes staff re-enter their password before a staff change, then allows it for a while', async () => {
    const { riderId, token } = await signUp();
    await getPool().query('UPDATE users SET is_admin = true, email_verified_at = now() WHERE id = $1', [riderId]);
    const change = () => call(token, '/admin/staff', { method: 'POST', body: JSON.stringify({ rider: 'rider_nobody_sec', role: 'support', note: 'n' }) });

    const refused = await change();
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: 'reauth_required', windowMs: STAFF_REAUTH_WINDOW_MS });
    assert.equal((await call(token, '/moderation/riders/rider_nobody_sec/unsuspend', { method: 'POST', body: JSON.stringify({ note: 'n' }) })).status, 403);
    assert.equal((await call(token, '/moderation/social-posts/11111111-1111-4111-8111-111111111111/remove', { method: 'POST', body: JSON.stringify({ note: 'n' }) })).status, 403);

    const wrong = await call(token, '/auth/reauthenticate', { method: 'POST', body: JSON.stringify({ password: 'nope-nope-nope' }) });
    assert.equal(wrong.status, 401);
    assert.equal((await call(token, '/auth/reauthenticate', { method: 'POST', body: JSON.stringify({}) })).status, 401);
    const ok = await call(token, '/auth/reauthenticate', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) });
    assert.deepEqual(await ok.json(), { reauthenticated: true, validForMs: STAFF_REAUTH_WINDOW_MS });
    assert.equal((await change()).status, 404);
    assert.deepEqual((await events(riderId)).slice(0, 2), ['reauthenticated', 'reauth_failed']);

    // The window runs out.
    await getPool().query(`UPDATE account_sessions SET reauthenticated_at = now() - interval '16 minutes' WHERE user_id = $1`, [riderId]);
    assert.equal((await change()).status, 403);
    assert.equal(await ctx.authStore.recentlyReauthenticated('', STAFF_REAUTH_WINDOW_MS), false);
    assert.equal(await ctx.authStore.reauthenticate('rider_missing_sec', token, PASSWORD), false);
  });

  it("shows admins staff sign-ins, or one rider's history", async () => {
    const admin = await signUp();
    const rider = await signUp();
    await getPool().query('UPDATE users SET is_admin = true WHERE id = $1', [admin.riderId]);
    const staffOnly = await (await call(admin.token, '/admin/security-events?staff=1&limit=200')).json() as { events: { riderId: string }[] };
    assert.ok(staffOnly.events.some((event) => event.riderId === admin.riderId));
    assert.ok(!staffOnly.events.some((event) => event.riderId === rider.riderId));
    const one = await (await call(admin.token, `/admin/security-events?riderId=${rider.riderId}`)).json() as { events: { riderId: string; event: string }[] };
    assert.deepEqual(one.events.map((event) => [event.riderId, event.event]), [[rider.riderId, 'account_created']]);
    assert.equal((await call(admin.token, '/admin/security-events?limit=0')).status, 400);
    assert.equal((await call(rider.token, '/admin/security-events')).status, 403);
  });

  it('keeps 180 days of history and never fails the action when a line cannot be written', async (t) => {
    const { riderId } = await signUp();
    await getPool().query('INSERT INTO security_events (rider_id, event, created_at) VALUES ($1, \'login\', $2)', [riderId, Date.now() - SECURITY_EVENT_RETENTION_MS - 1000]);
    const cleaned = await ctx.authStore.cleanupExpiredRecords();
    assert.ok(cleaned.securityEvents >= 1);
    assert.deepEqual(await events(riderId), ['account_created']);

    const logged: string[] = [];
    t.mock.method(console, 'error', (line: string) => { logged.push(line); });
    // No such rider: the insert fails, which is logged, not thrown.
    await (ctx.authStore as unknown as { recordSecurityEvent: (...args: unknown[]) => Promise<void> }).recordSecurityEvent('rider_missing_sec', 'login', null, null);
    assert.ok(logged.some((line) => line.includes('security_event_not_recorded')));
  });
});
