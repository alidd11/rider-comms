import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_contentadmin';
const SUPPORT = 'rider_contentsupport';
const POSTER = 'rider_contentposter';
const SEEDED = [ADMIN, SUPPORT, POSTER];

describe('staff map content', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const cleanup = async () => {
    await getPool().query('DELETE FROM moderation_actions WHERE moderator_id = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM hazard_reports WHERE reported_by = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM scenic_routes WHERE created_by = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
  };
  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });
  beforeEach(async () => {
    await cleanup();
    const pool = getPool();
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin)
       VALUES ($1,'c_admin','cadmin@example.org','x',now(),true), ($2,'c_support','csupport@example.org','x',now(),false),
        ($3,'c_poster','cposter@example.org','x',now(),false)`, SEEDED);
    await pool.query(`INSERT INTO staff_roles (rider_id, role, granted_by, granted_at) VALUES ($1, 'analyst', $2, 0)`, [SUPPORT, ADMIN]);
    const now = Date.now();
    await pool.query(
      `INSERT INTO hazard_reports (id, type, lat, lon, reported_by, created_at, expires_at, confirmations, denials) VALUES
        ('hz-calm', 'accident', 51.5, -0.1, $1, $2, $3, 3, 0),
        ('hz-disputed', 'road_closure', 51.6, -0.2, $1, $2, $3, 0, 2),
        ('hz-old', 'police', 51.7, -0.3, $1, $4, $4, 0, 0)`, [POSTER, now - 1000, now + 3_600_000, now - 7_200_000]);
    await pool.query(
      `INSERT INTO scenic_routes (id, name, description, vehicle_suitability, road_type, distance_miles, estimated_duration_minutes,
         difficulty, surface_quality, avoids_tolls, avoids_motorways, scenic_rating, safety_notices, start_lat, start_lon, end_lat, end_lon, created_by, created_at)
       VALUES ('rt-1', 'Snake Pass loop', 'Peak District curves', '{motorcycle}', 'a_road', 30, 60, 'moderate', 'good', true, true, 5, '{}', 53.4, -1.8, 53.4, -1.9, $1, $2)`,
      [POSTER, now]);
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  it('lists active hazards with the disputed first, and routes by name', async () => {
    assert.equal((await authenticatedFetch(ctx, SUPPORT, '/admin/content')).status, 403);
    const hazards = await (await authenticatedFetch(ctx, ADMIN, '/admin/content?kind=hazards')).json() as { items: { id: string }[]; nextOffset: number | null };
    const mine = hazards.items.map((item) => item.id).filter((id) => id.startsWith('hz-'));
    assert.deepEqual(mine, ['hz-disputed', 'hz-calm']);
    assert.equal(hazards.nextOffset, null);
    const all = await (await authenticatedFetch(ctx, ADMIN, '/admin/content?kind=hazards&include=expired')).json() as { items: { id: string; active: boolean }[] };
    assert.equal(all.items.find((item) => item.id === 'hz-old')?.active, false);
    const routes = await (await authenticatedFetch(ctx, ADMIN, '/admin/content?kind=routes&q=snake')).json() as { items: { id: string }[] };
    assert.deepEqual(routes.items.map((item) => item.id), ['rt-1']);
    assert.deepEqual((await (await authenticatedFetch(ctx, ADMIN, '/admin/content?kind=routes&q=100%25')).json() as { items: unknown[] }).items, []);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/content?kind=hideouts')).status, 400);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/content?offset=-1')).status, 400);
  });

  it('removes an item with a note and records it against the poster', async () => {
    assert.equal((await postJson(ctx, ADMIN, '/admin/content/hazards/hz-calm/remove', {})).status, 400);
    assert.equal((await postJson(ctx, ADMIN, '/admin/content/hazards/hz-calm/remove', { note: 'Fixed by the council' })).status, 200);
    assert.equal((await postJson(ctx, ADMIN, '/admin/content/hazards/hz-calm/remove', { note: 'Again' })).status, 404);
    assert.equal((await postJson(ctx, ADMIN, '/admin/content/routes/rt-1/remove', { note: 'Private land' })).status, 200);
    assert.equal((await postJson(ctx, ADMIN, '/admin/content/other/x/remove', { note: 'x' })).status, 404);
    const { rows } = await getPool().query<{ action: string; target_rider_id: string; note: string; content_ref: string }>(
      'SELECT action, target_rider_id, note, content_ref FROM moderation_actions WHERE moderator_id = $1 ORDER BY created_at', [ADMIN]);
    assert.deepEqual(rows.map((row) => [row.action, row.target_rider_id, row.note, row.content_ref]), [
      ['hazard_remove', POSTER, 'Fixed by the council', 'hazard:hz-calm:accident'],
      ['scenic_route_remove', POSTER, 'Private land', 'route:rt-1:Snake Pass loop'],
    ]);
    assert.equal((await getPool().query("SELECT 1 FROM scenic_routes WHERE id = 'rt-1'")).rowCount, 0);
  });

  it('rewords a route with a note, keeping the old name in the audit log', async () => {
    const edit = (body: unknown, id = 'rt-1') => postJson(ctx, ADMIN, `/admin/content/routes/${id}/edit`, body);
    assert.equal((await postJson(ctx, SUPPORT, '/admin/content/routes/rt-1/edit', { name: 'A', description: 'B', note: 'n' })).status, 403);
    assert.equal((await edit({ name: 'A', description: 'B' })).status, 400, 'no note');
    assert.equal((await edit({ name: ' ', description: 'B', note: 'n' })).status, 400);
    assert.equal((await edit({ name: 'x'.repeat(81), description: 'B', note: 'n' })).status, 400);
    assert.equal((await edit({ name: 'A', description: '', note: 'n' })).status, 400);
    assert.equal((await edit({ name: 'A', description: 'x'.repeat(501), note: 'n' })).status, 400);
    assert.equal((await edit({ name: 'A', description: 'B', note: 'n' }, 'missing')).status, 404);
    assert.equal((await postJson(ctx, ADMIN, '/admin/content/hazards/hz-calm/edit', { name: 'A', description: 'B', note: 'n' })).status, 404, 'hazards are not edited');
    assert.equal((await postJson(ctx, ADMIN, '/admin/content/hazards/hz-calm/expire', { note: 'n' })).status, 404);
    const res = await edit({ name: '  Snake   Pass ', description: 'Peak District curves. Watch for sheep.', note: 'Tidied the name' });
    assert.equal(res.status, 200);
    const { route } = await res.json() as { route: { name: string; description: string; createdBy: string } };
    assert.deepEqual([route.name, route.description, route.createdBy], ['Snake Pass', 'Peak District curves. Watch for sheep.', POSTER]);
    const { rows } = await getPool().query<{ action: string; target_rider_id: string; content_ref: string }>(
      'SELECT action, target_rider_id, content_ref FROM moderation_actions WHERE moderator_id = $1', [ADMIN]);
    assert.deepEqual(rows.map((row) => [row.action, row.target_rider_id, row.content_ref]), [['scenic_route_edit', POSTER, 'route:rt-1:Snake Pass loop']]);
  });
});
