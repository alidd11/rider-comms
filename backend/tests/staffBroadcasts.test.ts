import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { PushNotifier } from '../src/pushNotifier.ts';
import { PushStore } from '../src/pushStore.ts';
import { parseBroadcast } from '../src/staffBroadcasts.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_bcadmin';
const MOD = 'rider_bcmod';
const RIDER_ON = 'rider_bcon';
const RIDER_OFF = 'rider_bcoff';
const RIDER_SUSPENDED = 'rider_bcsusp';
const SEEDED = [ADMIN, MOD, RIDER_ON, RIDER_OFF, RIDER_SUSPENDED];

describe('broadcast input', () => {
  it('trims, limits and only allows known pages', () => {
    assert.deepEqual(parseBroadcast({ title: '  Hello  ', body: ' New\n rides ', route: '#friends' }), { title: 'Hello', body: 'New rides', route: '#friends' });
    assert.deepEqual(parseBroadcast({ title: 'Hi', body: 'There' }), { title: 'Hi', body: 'There', route: '#map' });
    assert.ok('error' in parseBroadcast({ title: '', body: 'x' }));
    assert.ok('error' in parseBroadcast({ title: 'x'.repeat(61), body: 'x' }));
    assert.ok('error' in parseBroadcast({ title: 'x', body: 'x'.repeat(181) }));
    assert.ok('error' in parseBroadcast({ title: 'x', body: 'x', route: 'https://evil.example' }));
  });
});

describe('staff push notifications', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const sent: { to: string; body: string }[] = [];
  const cleanup = async () => {
    await getPool().query('DELETE FROM push_broadcasts WHERE sent_by = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM push_subscriptions WHERE rider_id = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM moderation_actions WHERE moderator_id = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
  };
  before(async () => {
    await ensureMigrated();
    const store = new PushStore();
    const notifier = new PushNotifier({
      store,
      getProfile: async () => ({}),
      fetchImpl: async (url, init) => {
        const payload = JSON.parse(String(init?.body ?? '[]')) as { to: string; body: string }[];
        for (const item of payload) sent.push({ to: item.to, body: item.body });
        return new Response(JSON.stringify({ data: payload.map(() => ({ status: 'ok' })) }), { status: 200 });
      },
    });
    ctx = startTestServer({ pushStore: store, pushNotifier: notifier });
    await ctx.ready;
  });
  beforeEach(async () => {
    sent.length = 0;
    await cleanup();
    // Other tests' devices must not count here.
    await getPool().query('DELETE FROM push_subscriptions WHERE rider_id <> ALL($1::text[])', [SEEDED]);
    const pool = getPool();
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin, suspended_at)
       VALUES ($1,'bc_admin','bcadmin@example.org','x',now(),true,NULL), ($2,'bc_mod','bcmod@example.org','x',now(),false,NULL),
        ($3,'bc_on','bcon@example.org','x',now(),false,NULL), ($4,'bc_off','bcoff@example.org','x',now(),false,NULL),
        ($5,'bc_susp','bcsusp@example.org','x',now(),false,1)`, SEEDED);
    await pool.query(`INSERT INTO staff_roles (rider_id, role, granted_by, granted_at) VALUES ($1, 'moderator', $2, 0)`, [MOD, ADMIN]);
    await ctx.profileStore.update(RIDER_OFF, { notifyUpdates: false });
    for (const [i, id] of SEEDED.entries()) {
      await pool.query(
        `INSERT INTO push_subscriptions (rider_id, kind, address, p256dh, auth, created_at, updated_at) VALUES ($1, 'expo', $2, NULL, NULL, 0, 0)`,
        [id, `ExponentPushToken[bc${i}]`]);
    }
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  const settled = async () => {
    for (let i = 0; i < 50; i += 1) {
      const { rows } = await getPool().query("SELECT 1 FROM push_broadcasts WHERE status = 'sending' AND sent_by = $1", [ADMIN]);
      if (!rows.length) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('broadcast never finished');
  };

  it('admins only; a test goes to the sender, a real send respects Settings and suspension', async () => {
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/broadcasts')).status, 403);
    const overview = await (await authenticatedFetch(ctx, ADMIN, '/admin/broadcasts')).json() as { audience: { riders: number; devices: number } };
    assert.deepEqual(overview.audience, { riders: 3, devices: 3 }); // admin, moderator, rider who allows updates

    const message = { title: 'Winter riding', body: 'Grip is low this week.', route: '#map' };
    assert.equal((await postJson(ctx, ADMIN, '/admin/broadcasts', { ...message, route: '#evil' })).status, 400);
    assert.equal((await postJson(ctx, ADMIN, '/admin/broadcasts', { ...message, test: true })).status, 202);
    await settled();
    assert.deepEqual(sent.map((item) => item.to), ['ExponentPushToken[bc0]']);

    sent.length = 0;
    assert.equal((await postJson(ctx, ADMIN, '/admin/broadcasts', message)).status, 400); // a note is required
    const response = await postJson(ctx, ADMIN, '/admin/broadcasts', { ...message, note: 'Seasonal safety' });
    assert.equal(response.status, 202);
    await settled();
    assert.deepEqual(sent.map((item) => item.to).sort(), ['ExponentPushToken[bc0]', 'ExponentPushToken[bc1]', 'ExponentPushToken[bc2]']);
    const list = await (await authenticatedFetch(ctx, ADMIN, '/admin/broadcasts')).json() as { items: { test: boolean; status: string; riders: number; delivered: number }[] };
    assert.deepEqual(list.items.map((item) => [item.test, item.status, item.riders, item.delivered]), [[false, 'sent', 3, 3], [true, 'sent', 1, 1]]);
    const audit = await getPool().query("SELECT note FROM moderation_actions WHERE action = 'push_broadcast' AND moderator_id = $1", [ADMIN]);
    assert.deepEqual(audit.rows.map((row) => row.note), ['Seasonal safety']);

    // A second send to everyone waits out the cooldown; tests don't.
    const again = await postJson(ctx, ADMIN, '/admin/broadcasts', { ...message, note: 'Again' });
    assert.equal(again.status, 429);
    assert.equal((await postJson(ctx, ADMIN, '/admin/broadcasts', { ...message, test: true })).status, 202);
    await settled();
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/broadcasts', { method: 'PUT' })).status, 405);
  });
});
