import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { APP_SWITCH_CACHE_MS, appSwitches, isAppSwitch } from '../src/appSwitches.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_switchadmin';
const MOD = 'rider_switchmod';
const RIDER = 'rider_switchrider';
const SEEDED = [ADMIN, MOD, RIDER];

describe('app switch names', () => {
  it('knows only the three switches', () => {
    assert.ok(isAppSwitch('signups') && isAppSwitch('social_posting') && isAppSwitch('nearby_voice'));
    assert.equal(isAppSwitch('everything'), false);
  });
});

describe('staff app switches', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const cleanup = async () => {
    await getPool().query('DELETE FROM app_switches');
    await getPool().query('DELETE FROM moderation_actions WHERE moderator_id = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[]) OR username = $2', [SEEDED, 'switch_new']);
    appSwitches.clearCache();
  };
  before(async () => {
    await ensureMigrated();
    ctx = startTestServer({ liveKitCredentials: { apiKey: 'key', apiSecret: 'secret-secret-secret-secret-secret', url: 'wss://voice.example' } });
    await ctx.ready;
  });
  beforeEach(async () => {
    await cleanup();
    await getPool().query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin, terms_version)
       VALUES ($1,'sw_admin','swadmin@example.org','x',now(),true,'2026-10-01'), ($2,'sw_mod','swmod@example.org','x',now(),false,'2026-10-01'),
        ($3,'sw_rider','swrider@example.org','x',now(),false,'2026-10-01')`, SEEDED);
    await getPool().query(`INSERT INTO staff_roles (rider_id, role, granted_by, granted_at) VALUES ($1, 'moderator', $2, 0)`, [MOD, ADMIN]);
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  const flip = (key: string, body: unknown) => postJson(ctx, ADMIN, `/admin/switches/${key}`, body);

  it('admins only; a change needs a note and lands in the audit log', async () => {
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/switches')).status, 403);
    const list = await (await authenticatedFetch(ctx, ADMIN, '/admin/switches')).json() as { switches: { key: string; on: boolean }[] };
    assert.deepEqual(list.switches.map((item) => [item.key, item.on]), [['signups', true], ['social_posting', true], ['nearby_voice', true]]);

    assert.equal((await flip('signups', { on: false })).status, 400);
    assert.equal((await flip('signups', { on: 'no', note: 'x' })).status, 400);
    assert.equal((await flip('everything', { on: false, note: 'x' })).status, 404);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/switches', { method: 'POST', body: '{}' })).status, 405);
    const off = await flip('signups', { on: false, note: 'Bot sign-ups' });
    assert.equal(off.status, 200);
    const after = await (await authenticatedFetch(ctx, ADMIN, '/admin/switches')).json() as { switches: { key: string; on: boolean; changedBy: string; note: string }[] };
    assert.deepEqual(after.switches[0], { ...after.switches[0], on: false, changedBy: ADMIN, note: 'Bot sign-ups' });
    const audit = await (await authenticatedFetch(ctx, ADMIN, '/moderation/actions')).json() as { actions: { action: string; detail?: string; note: string }[] };
    assert.ok(audit.actions.some((row) => row.action === 'app_switch_off' && row.detail === 'signups' && row.note === 'Bot sign-ups'));
  });

  it('pauses new accounts but not sign-in', async () => {
    await appSwitches.set('signups', false, ADMIN, 'Bot sign-ups');
    const signup = await fetch(`${ctx.baseUrl()}/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'switch_new', email: 'switchnew@example.org', password: 'long-enough-password', acceptTerms: true }),
    });
    assert.equal(signup.status, 403);
    assert.equal((await signup.json() as { error: string }).error, 'signups_paused');
    await appSwitches.set('signups', true, ADMIN, 'Fixed');
    const again = await fetch(`${ctx.baseUrl()}/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'switch_new', email: 'switchnew@example.org', password: 'long-enough-password', acceptTerms: true }),
    });
    assert.equal(again.status, 201);
  });

  it('hands out no Nearby Voice calls while paused, and says so', async () => {
    await appSwitches.set('nearby_voice', false, ADMIN, 'Voice provider incident');
    const res = await postJson(ctx, RIDER, '/voice/token', { target: 'channel' });
    assert.equal(res.status, 200);
    const body = await res.json() as { connections: unknown[]; paused?: boolean; refreshAfterMs: number };
    assert.deepEqual([body.connections, body.paused], [[], true]);
    assert.ok(body.refreshAfterMs > 0);
    await appSwitches.set('nearby_voice', true, ADMIN, 'Resolved');
    const on = await (await postJson(ctx, RIDER, '/voice/token', { target: 'channel' })).json() as { paused?: boolean };
    assert.equal(on.paused, undefined);
  });

  it('another replica sees a change once its short cache runs out', async () => {
    const start = Date.now();
    assert.equal(await appSwitches.isOn('nearby_voice', start), true);
    await getPool().query(`INSERT INTO app_switches (key, enabled, changed_by, changed_at, note) VALUES ('nearby_voice', false, $1, 0, 'elsewhere')`, [ADMIN]);
    assert.equal(await appSwitches.isOn('nearby_voice', start + 1), true, 'still cached');
    assert.equal(await appSwitches.isOn('nearby_voice', start + APP_SWITCH_CACHE_MS), false);
  });
});
