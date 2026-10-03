import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { AccountDeletionStore } from '../src/accountDeletionStore.ts';
import { ModerationStore } from '../src/moderationStore.ts';
import type { ModerationAction, QueuedSafetyReport } from '../src/moderationStore.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

const ADMIN = 'mod-admin';
const OTHER_ADMIN = 'mod-admin-2';
const MEMBER = 'mod-member';
const REPORTED = 'mod-reported';
const BYSTANDER = 'mod-bystander';
const SEEDED = [ADMIN, OTHER_ADMIN, MEMBER, REPORTED, BYSTANDER];

async function insertReport(id: string, reported: string, createdAt: number, reporter = MEMBER): Promise<void> {
  await getPool().query(
    `INSERT INTO safety_reports (id, reporter_id, reported_rider_id, reason, details, created_at)
     VALUES ($1, $2, $3, 'harassment', 'details', $4)`,
    [id, reporter, reported, createdAt],
  );
}

async function reportStatus(id: string): Promise<string | undefined> {
  const { rows } = await getPool().query<{ status: string }>('SELECT status FROM safety_reports WHERE id = $1', [id]);
  return rows[0]?.status;
}

describe('moderation queue API', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed moderation queue tests' }, () => {
  let ctx: TestServer;

  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE safety_reports, moderation_actions');
    await getPool().query(`DELETE FROM users WHERE id = ANY($1::text[]) OR username LIKE 'modq_%'`, [SEEDED]);
    await getPool().query(
      `INSERT INTO users (id, username, password_hash, email_verified_at, is_admin, terms_version) VALUES
         ($1, 'tst_mod_admin', 'test-only', now(), true, '2026-10-01'),
         ($2, 'tst_mod_admin2', 'test-only', now(), true, '2026-10-01'),
         ($3, 'tst_mod_member', 'test-only', now(), false, '2026-10-01'),
         ($4, 'tst_mod_reported', 'test-only', now(), false, '2026-10-01'),
         ($5, 'tst_mod_bystander', 'test-only', now(), false, '2026-10-01')`,
      SEEDED,
    );
  });

  after(async () => {
    await ctx.close();
    await getPool().query(`DELETE FROM users WHERE id = ANY($1::text[]) OR username LIKE 'modq_%'`, [SEEDED]);
    await resetDbForTests();
  });

  it('is restricted to signed-in admins', async () => {
    assert.equal((await fetch(`${ctx.baseUrl()}/moderation/reports`)).status, 401);
    const member = await authenticatedFetch(ctx, MEMBER, '/moderation/reports');
    assert.equal(member.status, 403);
    assert.deepEqual(await member.json(), { error: 'admin_required' });
    const memberResolve = await postJson(ctx, MEMBER, '/moderation/reports/x/resolve', { resolution: 'dismiss', note: 'n' });
    assert.equal(memberResolve.status, 403);
  });

  it('lists open reports oldest first with how often each rider has been reported', async () => {
    await insertReport('r-new', REPORTED, 3_000);
    await insertReport('r-old', REPORTED, 1_000, BYSTANDER);
    await insertReport('r-other', BYSTANDER, 2_000);

    const res = await authenticatedFetch(ctx, ADMIN, '/moderation/reports');
    assert.equal(res.status, 200);
    const { reports } = await res.json() as { reports: QueuedSafetyReport[] };

    assert.deepEqual(reports.map((report) => report.id), ['r-old', 'r-other', 'r-new']);
    assert.equal(reports[0]!.reportsAgainstRider, 2);
    assert.equal(reports[1]!.reportsAgainstRider, 1);
    assert.equal(reports[0]!.status, 'open');
    assert.equal(reports[0]!.reportedRiderSuspended, false);

    assert.equal((await authenticatedFetch(ctx, ADMIN, '/moderation/reports?status=bogus')).status, 400);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/moderation/reports?limit=0')).status, 400);
  });

  it('dismisses a report with a required note and records it in the audit log', async () => {
    await insertReport('r-1', REPORTED, 1_000);

    assert.equal((await postJson(ctx, ADMIN, '/moderation/reports/r-1/resolve', { resolution: 'dismiss' })).status, 400);
    assert.equal((await postJson(ctx, ADMIN, '/moderation/reports/r-1/resolve', { resolution: 'ban', note: 'x' })).status, 400);

    const res = await postJson(ctx, ADMIN, '/moderation/reports/r-1/resolve', { resolution: 'dismiss', note: '  Not a violation.  ' });
    assert.equal(res.status, 200);
    const body = await res.json() as { action: ModerationAction; resolvedReportIds: string[] };
    assert.deepEqual(body.resolvedReportIds, ['r-1']);
    assert.equal(body.action.action, 'dismiss');
    assert.equal(body.action.note, 'Not a violation.');
    assert.equal(body.action.moderatorId, ADMIN);
    assert.equal(await reportStatus('r-1'), 'dismissed');

    const again = await postJson(ctx, ADMIN, '/moderation/reports/r-1/resolve', { resolution: 'dismiss', note: 'again' });
    assert.equal(again.status, 409);
    assert.equal((await postJson(ctx, ADMIN, '/moderation/reports/missing/resolve', { resolution: 'dismiss', note: 'x' })).status, 404);

    const dismissed = await (await authenticatedFetch(ctx, ADMIN, '/moderation/reports?status=dismissed')).json() as { reports: QueuedSafetyReport[] };
    assert.equal(dismissed.reports[0]!.resolvedBy, ADMIN);
    const actions = await (await authenticatedFetch(ctx, ADMIN, `/moderation/actions?riderId=${REPORTED}`)).json() as { actions: ModerationAction[] };
    assert.deepEqual(actions.actions.map((action) => action.action), ['dismiss']);
  });

  it('suspending revokes sessions, closes every open report against the rider and blocks sign-in until unsuspended', async () => {
    const username = `modq_${Math.random().toString(36).slice(2, 8)}`;
    const signup = await fetch(`${ctx.baseUrl()}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email: `${username}@example.com`, password: 'correct-horse-battery', deviceName: 'mod-test', acceptTerms: true }),
    });
    assert.equal(signup.status, 201);
    const { riderId: target, token } = await signup.json() as { riderId: string; token: string };
    assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);

    await insertReport('t-1', target, 1_000);
    await insertReport('t-2', target, 2_000, BYSTANDER);
    await insertReport('other', REPORTED, 1_500);

    const res = await postJson(ctx, ADMIN, '/moderation/reports/t-1/resolve', { resolution: 'suspend', note: 'Repeated harassment.' });
    assert.equal(res.status, 200);
    const body = await res.json() as { action: ModerationAction; resolvedReportIds: string[] };
    assert.deepEqual(body.resolvedReportIds, ['t-1', 't-2']);
    assert.equal(await reportStatus('t-2'), 'actioned');
    assert.equal(await reportStatus('other'), 'open');

    assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
    const login = () => fetch(`${ctx.baseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'correct-horse-battery' }),
    });
    const refused = await login();
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: 'account_suspended' });
    // A wrong password still gets the generic error, so suspension status
    // isn't revealed without the account's credentials.
    const wrong = await fetch(`${ctx.baseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'wrong-password-123' }),
    });
    assert.equal(wrong.status, 401);

    const queued = await (await authenticatedFetch(ctx, ADMIN, '/moderation/reports?status=actioned')).json() as { reports: QueuedSafetyReport[] };
    assert.equal(queued.reports.every((report) => report.reportedRiderSuspended), true);

    assert.equal((await postJson(ctx, ADMIN, `/moderation/riders/${target}/unsuspend`, {})).status, 400);
    const unsuspended = await postJson(ctx, ADMIN, `/moderation/riders/${target}/unsuspend`, { note: 'Appeal accepted.' });
    assert.equal(unsuspended.status, 200);
    assert.equal((await postJson(ctx, ADMIN, `/moderation/riders/${target}/unsuspend`, { note: 'again' })).status, 409);
    assert.equal((await postJson(ctx, ADMIN, '/moderation/riders/nobody/unsuspend', { note: 'x' })).status, 404);
    assert.equal((await login()).status, 200);

    const actions = await (await authenticatedFetch(ctx, ADMIN, `/moderation/actions?riderId=${target}`)).json() as { actions: ModerationAction[] };
    assert.deepEqual(actions.actions.map((action) => action.action), ['unsuspend', 'suspend']);

    await getPool().query('DELETE FROM users WHERE id = $1', [target]);
  });

  it('refuses to suspend an admin or the moderator themselves', async () => {
    await insertReport('a-1', OTHER_ADMIN, 1_000);
    await insertReport('self', ADMIN, 1_000, BYSTANDER);

    for (const id of ['a-1', 'self']) {
      const res = await postJson(ctx, ADMIN, `/moderation/reports/${id}/resolve`, { resolution: 'suspend', note: 'x' });
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: 'forbidden_target' });
      assert.equal(await reportStatus(id), 'open');
    }
    const { rows } = await getPool().query('SELECT suspended_at FROM users WHERE id = ANY($1::text[])', [[ADMIN, OTHER_ADMIN]]);
    assert.equal(rows.every((row) => row.suspended_at === null), true);
    assert.equal((await getPool().query('SELECT 1 FROM moderation_actions')).rowCount, 0);
  });

  it('removes audit entries about a rider when that rider deletes their account', async () => {
    await insertReport('d-1', REPORTED, 1_000);
    const store = new ModerationStore();
    const result = await store.resolveReport('d-1', ADMIN, 'dismiss', 'ok');
    assert.equal(result.ok, true);
    assert.equal((await store.listActions(REPORTED)).length, 1);

    await new AccountDeletionStore().deleteRider(REPORTED);

    assert.deepEqual(await store.listActions(REPORTED), []);
    assert.equal(await reportStatus('d-1'), undefined);
  });
});
