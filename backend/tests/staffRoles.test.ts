import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { GRANTABLE_STAFF_ROLES, STAFF_PERMISSIONS, isGrantableStaffRole, permissionsFor, roleCan } from '../src/staffRoles.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('staff roles', () => {
  it('gives admins everything and each other role only what its job needs', () => {
    assert.deepEqual(permissionsFor('admin'), [...STAFF_PERMISSIONS]);
    assert.deepEqual(permissionsFor(null), []);
    assert.equal(roleCan('moderator', 'moderate'), true);
    assert.equal(roleCan('moderator', 'verify_email'), false);
    assert.equal(roleCan('support', 'verify_email'), true);
    assert.equal(roleCan('support', 'moderate'), false);
    assert.equal(roleCan('analyst', 'view_overview'), true);
    assert.equal(roleCan('analyst', 'view_riders'), false);
    assert.equal(roleCan(null, 'view_overview'), false);
    for (const role of ['moderator', 'support', 'analyst'] as const) assert.equal(roleCan(role, 'manage_staff'), false);
  });

  it('only lets the dashboard grant roles below admin', () => {
    assert.deepEqual([...GRANTABLE_STAFF_ROLES], ['moderator', 'support', 'analyst']);
    assert.equal(isGrantableStaffRole('support'), true);
    assert.equal(isGrantableStaffRole('admin'), false);
    assert.equal(isGrantableStaffRole(3), false);
  });
});

const ADMIN = 'rider_staffadmin';
const MOD = 'rider_staffmod';
const OTHER = 'rider_staffother';
const SUSPENDED = 'rider_staffsusp';
const SEEDED = [ADMIN, MOD, OTHER, SUSPENDED];

async function cleanup(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM moderation_actions WHERE moderator_id = ANY($1::text[]) OR target_rider_id = ANY($1::text[])', [SEEDED]);
  await pool.query('DELETE FROM rider_profiles WHERE rider_id = ANY($1::text[])', [SEEDED]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
}

describe('staff roles API', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed staff role tests' }, () => {
  let ctx: TestServer;

  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });

  beforeEach(async () => {
    await cleanup();
    await getPool().query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin, suspended_at) VALUES
         ($1, 'tst_staff_admin', 'staff-admin@example.com', 'test-only', now(), true, NULL),
         ($2, 'tst_staff_mod', 'staff-mod@example.com', 'test-only', now(), false, NULL),
         ($3, 'tst_staff_other', 'staff-other@example.com', 'test-only', NULL, false, NULL),
         ($4, 'tst_staff_susp', 'staff-susp@example.com', 'test-only', now(), false, 123)`,
      SEEDED,
    );
    await getPool().query(
      `INSERT INTO rider_profiles (rider_id, display_name, handle, avatar_id, zone_tier, unit_system, notify_nearby, notify_invites, notify_chat, share_location, instagram_username, instagram_visibility, tiktok_username, tiktok_visibility, updated_at)
       VALUES ($1, 'Mo', '@mo_staff', 'ridge', 'free', 'mi', false, false, false, false, '', 'friends', '', 'friends', 0)`,
      [MOD],
    );
  });

  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  const grant = (body: unknown) => postJson(ctx, ADMIN, '/admin/staff', body);
  const me = async (riderId: string) => (await authenticatedFetch(ctx, riderId, '/admin/me')).json();

  it('tells each staff member their role and permissions, and refuses everyone else', async () => {
    assert.deepEqual(await me(ADMIN), { riderId: ADMIN, role: 'admin', permissions: [...STAFF_PERMISSIONS] });
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/me')).status, 403);
  });

  it('lets an admin grant, change and remove a role, each with a note in the audit log', async () => {
    const granted = await grant({ rider: 'mo_staff', role: 'moderator', note: 'Joins the safety rota' });
    assert.equal(granted.status, 200);
    assert.deepEqual(await me(MOD), { riderId: MOD, role: 'moderator', permissions: permissionsFor('moderator') });
    assert.equal((await authenticatedFetch(ctx, MOD, '/moderation/reports')).status, 200);
    assert.equal((await authenticatedFetch(ctx, MOD, '/moderation/social-posts')).status, 200);
    const denied = await authenticatedFetch(ctx, MOD, '/admin/staff');
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'permission_required', permission: 'manage_staff' });
    assert.equal((await postJson(ctx, MOD, `/moderation/riders/${OTHER}/verify-email`, { note: 'x' })).status, 403);

    const search = await (await authenticatedFetch(ctx, ADMIN, '/admin/riders?q=tst_staff')).json() as { riders: { riderId: string; staffRole: string | null }[] };
    assert.deepEqual(Object.fromEntries(search.riders.map((r) => [r.riderId, r.staffRole])), { [ADMIN]: 'admin', [MOD]: 'moderator', [OTHER]: null, [SUSPENDED]: null });

    assert.equal((await grant({ rider: MOD, role: 'support', note: 'Moves to account help' })).status, 200);
    assert.equal((await authenticatedFetch(ctx, MOD, '/moderation/reports')).status, 403);
    assert.equal((await authenticatedFetch(ctx, MOD, '/moderation/social-posts')).status, 403);
    assert.equal((await authenticatedFetch(ctx, MOD, '/moderation/actions')).status, 200);
    assert.equal((await postJson(ctx, MOD, `/moderation/riders/${OTHER}/verify-email`, { note: 'Checked by phone' })).status, 200);

    assert.equal((await grant({ rider: MOD, role: 'analyst', note: 'Reporting only' })).status, 200);
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/overview')).status, 200);
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/system')).status, 200);
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/riders')).status, 403);

    const staff = await (await authenticatedFetch(ctx, ADMIN, '/admin/staff')).json() as { staff: { riderId: string; role: string; grantedBy: string | null; handle: string | null }[] };
    const mine = staff.staff.filter((member) => SEEDED.includes(member.riderId));
    assert.deepEqual(mine.map((m) => [m.riderId, m.role, m.grantedBy, m.handle]), [[ADMIN, 'admin', null, null], [MOD, 'analyst', ADMIN, '@mo_staff']]);

    assert.equal((await postJson(ctx, ADMIN, `/admin/staff/${MOD}/remove`, { note: 'Left the team' })).status, 200);
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/me')).status, 403);

    const log = await (await authenticatedFetch(ctx, ADMIN, `/moderation/actions?riderId=${MOD}`)).json() as { actions: { action: string; note: string }[] };
    assert.deepEqual(log.actions.map((a) => [a.action, a.note]).reverse(), [
      ['staff_grant', 'moderator: Joins the safety rota'],
      ['staff_grant', 'moderator → support: Moves to account help'],
      ['staff_grant', 'support → analyst: Reporting only'],
      ['staff_revoke', 'analyst: Left the team'],
    ]);
  });

  it('checks every staff change', async () => {
    assert.equal((await grant({ rider: MOD, role: 'moderator' })).status, 400);
    assert.equal((await grant({ rider: MOD, role: 'admin', note: 'n' })).status, 400);
    assert.equal((await grant({ role: 'moderator', note: 'n' })).status, 400);
    assert.equal((await grant({ rider: 'rider_nobody_here', role: 'moderator', note: 'n' })).status, 404);
    assert.equal((await grant({ rider: '@no_such_handle', role: 'moderator', note: 'n' })).status, 404);
    assert.deepEqual(await (await grant({ rider: ADMIN, role: 'moderator', note: 'n' })).json(), { error: 'is_admin' });
    assert.deepEqual(await (await grant({ rider: SUSPENDED, role: 'moderator', note: 'n' })).json(), { error: 'suspended' });
    assert.equal((await grant({ rider: MOD, role: 'moderator', note: 'n' })).status, 200);
    assert.deepEqual(await (await grant({ rider: MOD, role: 'moderator', note: 'n' })).json(), { error: 'unchanged' });

    assert.deepEqual(await (await postJson(ctx, ADMIN, `/admin/staff/${OTHER}/remove`, { note: 'n' })).json(), { error: 'not_staff' });
    assert.deepEqual(await (await postJson(ctx, ADMIN, `/admin/staff/${ADMIN}/remove`, { note: 'n' })).json(), { error: 'is_admin' });
    assert.equal((await postJson(ctx, ADMIN, '/admin/staff/rider_nobody_here/remove', { note: 'n' })).status, 404);
    assert.equal((await postJson(ctx, ADMIN, `/admin/staff/${MOD}/remove`, {})).status, 400);
    assert.equal((await postJson(ctx, ADMIN, `/admin/staff/${MOD}/other`, { note: 'n' })).status, 404);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/staff', { method: 'DELETE' })).status, 404);
  });
});
