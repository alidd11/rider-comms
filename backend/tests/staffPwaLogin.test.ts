import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('standalone staff PWA login', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const created: string[] = [];
  const password = 'Correct-horse-battery-2026';

  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });

  after(async () => {
    await ctx.close();
    if (created.length) await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [created]);
    await resetDbForTests();
  });

  const login = async (username: string, suppliedPassword: string) =>
    fetch(ctx.baseUrl() + '/auth/staff-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: suppliedPassword, deviceName: 'Rider Comms Staff PWA' }),
    });

  it('rejects invalid credentials and ordinary riders, then issues a revocable staff session', async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const staffUsername = 'pwa_admin_' + suffix;
    const riderUsername = 'pwa_rider_' + suffix;
    const staff = await ctx.authStore.signUp(staffUsername, staffUsername + '@example.com', password);
    const rider = await ctx.authStore.signUp(riderUsername, riderUsername + '@example.com', password);
    assert.ok('riderId' in staff);
    assert.ok('riderId' in rider);
    created.push(staff.riderId, rider.riderId);
    await getPool().query('UPDATE users SET is_admin = true WHERE id = $1', [staff.riderId]);

    assert.equal((await login(staffUsername, 'incorrect-password')).status, 401);
    const initialRiderSessions = Number((await getPool().query<{ count: string }>(
      'SELECT count(*) FROM account_sessions WHERE user_id = $1', [rider.riderId],
    )).rows[0]!.count);
    const denied = await login(riderUsername, password);
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'staff_only' });
    const afterDenied = Number((await getPool().query<{ count: string }>(
      'SELECT count(*) FROM account_sessions WHERE user_id = $1', [rider.riderId],
    )).rows[0]!.count);
    assert.equal(afterDenied, initialRiderSessions, 'non-staff sign-in must revoke its temporary token');

    const response = await login(staffUsername, password);
    assert.equal(response.status, 200);
    const identity = await response.json() as { riderId: string; token: string };
    assert.equal(identity.riderId, staff.riderId);
    assert.equal(typeof identity.token, 'string');
    const auth = { Authorization: 'Bearer ' + identity.token };
    const me = await fetch(ctx.baseUrl() + '/admin/me', { headers: auth });
    assert.equal(me.status, 200);
    const details = await me.json() as { role: string };
    assert.equal(details.role, 'admin');
    assert.equal((await fetch(ctx.baseUrl() + '/auth/logout', {
      method: 'POST', headers: auth,
    })).status, 204);
    assert.equal((await fetch(ctx.baseUrl() + '/admin/me', { headers: auth })).status, 401);
  });
});
