import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { ModerationStore, REPORT_CLAIM_TTL_MS, SYSTEM_ACTOR, suspensionNote } from '../src/moderationStore.ts';
import { suspensionEnd } from '../src/routes/moderation.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_tooladmin';
const MOD = 'rider_toolmod';
const MOD2 = 'rider_toolmod2';
const SUPPORT = 'rider_toolsupport';
const ANALYST = 'rider_toolanalyst';
const TARGET = 'rider_tooltarget';
const SEEDED = [ADMIN, MOD, MOD2, SUPPORT, ANALYST, TARGET];
const DAY = 24 * 60 * 60 * 1000;

describe('suspension helpers', () => {
  it('turns days into an end time, or none', () => {
    assert.equal(suspensionEnd(undefined, 0), null);
    assert.equal(suspensionEnd(null, 0), null);
    assert.equal(suspensionEnd(7, 0), 7 * DAY);
    for (const bad of [0, 366, 1.5, '7']) assert.equal(suspensionEnd(bad, 0), undefined);
    assert.equal(suspensionNote('Spam', null), 'Spam');
    assert.equal(suspensionNote('Spam', Date.UTC(2026, 10, 25, 9, 30)), 'Until 2026-11-25 09:30 UTC: Spam');
  });
});

describe('staff tools', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const store = new ModerationStore();
  const cleanup = async () => {
    const pool = getPool();
    await pool.query('DELETE FROM moderation_actions WHERE target_rider_id = ANY($1::text[]) OR moderator_id = ANY($1::text[])', [SEEDED]);
    await pool.query('DELETE FROM safety_reports WHERE reported_rider_id = ANY($1::text[]) OR reporter_id = ANY($1::text[])', [SEEDED]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
  };
  const report = (id: string, createdAt = 1) => getPool().query(
    `INSERT INTO safety_reports (id, reporter_id, reported_rider_id, reason, details, created_at) VALUES ($1, $2, $3, 'spam', 'x', $4)`,
    [id, SUPPORT, TARGET, createdAt],
  );
  const suspendedState = async () => (await getPool().query('SELECT suspended_at, suspended_until FROM users WHERE id = $1', [TARGET])).rows[0] as { suspended_at: string | null; suspended_until: string | null };

  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });
  beforeEach(async () => {
    await cleanup();
    await getPool().query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin) VALUES
         ($1, 'tst_tool_admin', 'tool-admin@example.com', 'x', now(), true),
         ($2, 'tst_tool_mod', 'tool-mod@example.com', 'x', now(), false),
         ($3, 'tst_tool_mod2', 'tool-mod2@example.com', 'x', now(), false),
         ($4, 'tst_tool_support', 'tool-support@example.com', 'x', now(), false),
         ($5, 'tst_tool_analyst', 'tool-analyst@example.com', 'x', now(), false),
         ($6, 'tst_tool_target', 'tool-target@example.com', 'x', now(), false)`,
      SEEDED,
    );
    await getPool().query(
      `INSERT INTO staff_roles (rider_id, role, granted_by, granted_at) VALUES ($1, 'moderator', $5, 0), ($2, 'moderator', $5, 0), ($3, 'support', $5, 0), ($4, 'analyst', $5, 0)`,
      [MOD, MOD2, SUPPORT, ANALYST, ADMIN],
    );
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  it('lets a moderator suspend a rider directly, for some days, closing open reports', async () => {
    await report('rep-tool-1');
    await getPool().query(`INSERT INTO account_sessions (id, token_hash, user_id, expires_at, device_name) VALUES ('sess-tool', 'hash-tool', $1, now() + interval '1 day', 'Phone')`, [TARGET]);
    assert.equal((await postJson(ctx, MOD, `/moderation/riders/${TARGET}/suspend`, { note: 'Abuse in chat', days: 0 })).status, 400);
    assert.equal((await postJson(ctx, MOD, `/moderation/riders/${TARGET}/suspend`, { days: 7 })).status, 400);
    const response = await postJson(ctx, MOD, `/moderation/riders/${TARGET}/suspend`, { note: 'Abuse in chat', days: 7 });
    assert.equal(response.status, 200);
    const body = await response.json() as { resolvedReportIds: string[]; action: { note: string } };
    assert.deepEqual(body.resolvedReportIds, ['rep-tool-1']);
    assert.match(body.action.note, /^Until \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC: Abuse in chat$/);
    const state = await suspendedState();
    assert.ok(state.suspended_at !== null);
    assert.ok(Math.abs(Number(state.suspended_until) - (Date.now() + 7 * DAY)) < 60_000);
    assert.equal((await getPool().query('SELECT 1 FROM account_sessions WHERE user_id = $1', [TARGET])).rowCount, 0);

    assert.deepEqual(await (await postJson(ctx, MOD, `/moderation/riders/${TARGET}/suspend`, { note: 'again' })).json(), { error: 'already_suspended' });
    assert.equal((await postJson(ctx, MOD, `/moderation/riders/${ADMIN}/suspend`, { note: 'n' })).status, 403);
    assert.equal((await postJson(ctx, MOD, `/moderation/riders/${MOD}/suspend`, { note: 'n' })).status, 403);
    assert.equal((await postJson(ctx, MOD, '/moderation/riders/rider_nobody_tool/suspend', { note: 'n' })).status, 404);
    assert.equal((await postJson(ctx, SUPPORT, `/moderation/riders/${TARGET}/suspend`, { note: 'n' })).status, 403);

    // Unsuspending clears the end time too.
    assert.equal((await postJson(ctx, MOD, `/moderation/riders/${TARGET}/unsuspend`, { note: 'Appeal accepted' })).status, 200);
    assert.deepEqual(await suspendedState(), { suspended_at: null, suspended_until: null });
  });

  it('suspends from a report with an end date, and timed suspensions end on their own', async () => {
    await report('rep-tool-2');
    assert.equal((await postJson(ctx, MOD, '/moderation/reports/rep-tool-2/resolve', { resolution: 'suspend', note: 'n', days: 400 })).status, 400);
    assert.equal((await postJson(ctx, MOD, '/moderation/reports/rep-tool-2/resolve', { resolution: 'suspend', note: 'Spam run', days: 1 })).status, 200);
    assert.ok((await suspendedState()).suspended_until !== null);

    assert.deepEqual(await store.liftExpiredSuspensions(Date.now()), []);
    assert.deepEqual(await store.liftExpiredSuspensions(Date.now() + 2 * DAY), [TARGET]);
    assert.deepEqual(await suspendedState(), { suspended_at: null, suspended_until: null });
    const [lifted] = await store.listActions(TARGET, 1);
    assert.equal(lifted!.moderatorId, SYSTEM_ACTOR);
    assert.equal(lifted!.action, 'unsuspend');
  });

  it('lets a rider whose timed suspension has run out sign in before the sweep lifts it', async () => {
    const username = `tool_${Math.random().toString(36).slice(2, 9)}`;
    const signed = await ctx.authStore.signUp(username, `${username}@example.com`, 'correct-horse-battery');
    assert.ok('riderId' in signed);
    try {
      await getPool().query('UPDATE users SET suspended_at = 1, suspended_until = $2 WHERE id = $1', [signed.riderId, Date.now() + DAY]);
      assert.deepEqual(await ctx.authStore.logIn(username, 'correct-horse-battery'), { error: 'account_suspended' });
      await getPool().query('UPDATE users SET suspended_until = $2 WHERE id = $1', [signed.riderId, Date.now() - 1000]);
      assert.ok('token' in await ctx.authStore.logIn(username, 'correct-horse-battery'));
      await getPool().query('UPDATE users SET suspended_until = NULL WHERE id = $1', [signed.riderId]);
      assert.deepEqual(await ctx.authStore.logIn(username, 'correct-horse-battery'), { error: 'account_suspended' });
    } finally {
      await getPool().query('DELETE FROM users WHERE id = $1', [signed.riderId]);
    }
  });

  it('lets moderators claim reports so two don’t work the same one', async () => {
    await report('rep-tool-3');
    const claim = (riderId: string, body: unknown = {}) => postJson(ctx, riderId, '/moderation/reports/rep-tool-3/claim', body);
    const claimed = await (await claim(MOD)).json() as { claimedBy: string };
    assert.equal(claimed.claimedBy, MOD);
    assert.deepEqual(await (await claim(MOD2)).json(), { error: 'claimed_by_other', claimedBy: MOD });
    const queue = await (await authenticatedFetch(ctx, MOD2, '/moderation/reports')).json() as { reports: { id: string; claimedBy: string | null }[] };
    assert.equal(queue.reports.find((entry) => entry.id === 'rep-tool-3')!.claimedBy, MOD);
    assert.deepEqual(await (await claim(MOD, { release: true })).json(), { ok: true, claimedBy: null, claimedAt: null });
    assert.equal((await claim(MOD2)).status, 200);

    // A lapsed claim can be taken.
    await getPool().query('UPDATE safety_reports SET claimed_at = $2 WHERE id = $1', ['rep-tool-3', Date.now() - REPORT_CLAIM_TTL_MS - 1000]);
    assert.equal((await claim(MOD)).status, 200);
    assert.equal((await postJson(ctx, MOD, '/moderation/reports/rep-nope/claim', {})).status, 404);
    await postJson(ctx, MOD, '/moderation/reports/rep-tool-3/resolve', { resolution: 'dismiss', note: 'n' });
    assert.deepEqual(await (await claim(MOD)).json(), { error: 'already_resolved' });
    assert.equal((await postJson(ctx, SUPPORT, '/moderation/reports/rep-tool-3/claim', {})).status, 403);
  });

  it('lets support sign a rider out everywhere and send a password reset, each recorded', async () => {
    await getPool().query(`INSERT INTO account_sessions (id, token_hash, user_id, expires_at, device_name) VALUES ('sess-tool-2', 'hash-tool-2', $1, now() + interval '1 day', 'Phone')`, [TARGET]);
    assert.equal((await postJson(ctx, MOD, `/moderation/riders/${TARGET}/sign-out`, { note: 'n' })).status, 403);
    const out = await postJson(ctx, SUPPORT, `/moderation/riders/${TARGET}/sign-out`, { note: 'Lost phone' });
    assert.equal(((await out.json()) as { sessions: number }).sessions, 1);
    assert.equal((await postJson(ctx, SUPPORT, '/moderation/riders/rider_nobody_tool/sign-out', { note: 'n' })).status, 404);

    const reset = await postJson(ctx, SUPPORT, `/moderation/riders/${TARGET}/password-reset`, { note: 'Forgot password, confirmed by phone' });
    assert.equal(reset.status, 200);
    assert.equal(typeof ((await reset.json()) as { emailDelivery: { configured: boolean } }).emailDelivery.configured, 'boolean');
    assert.equal((await getPool().query('SELECT 1 FROM password_resets WHERE user_id = $1', [TARGET])).rowCount, 1);
    assert.equal((await postJson(ctx, SUPPORT, '/moderation/riders/rider_nobody_tool/password-reset', { note: 'n' })).status, 404);
    const actions = (await store.listActions(TARGET)).map((action) => action.action);
    assert.deepEqual(actions.sort(), ['password_reset_sent', 'sign_out_everywhere']);
  });


  it('persists report ownership independently of expiring claims and audits every transition', async () => {
    await report('rep-owner-1');
    const url = '/moderation/reports/rep-owner-1';
    const assign = (actorId: string, assigneeId: string | null, note = 'Review allocation') =>
      postJson(ctx, actorId, url + '/assign', { assigneeId, note });
    const details = async () => (await (await authenticatedFetch(ctx, MOD, url)).json() as
      { report: { assignedTo: string | null; assignedAt: number | null; claimedBy: string | null } }).report;
    assert.equal((await details()).assignedTo, null);
    assert.equal((await fetch(ctx.baseUrl() + url + '/assignment-history')).status, 401);
    assert.equal((await authenticatedFetch(ctx, SUPPORT, url + '/assignment-history')).status, 403);
    assert.equal((await authenticatedFetch(ctx, ANALYST, url + '/assignment-history')).status, 403);
    assert.equal((await authenticatedFetch(ctx, MOD, url + '/assignment-history?limit=0')).status, 400);
    assert.equal((await authenticatedFetch(ctx, MOD, '/moderation/reports/not-found/assignment-history')).status, 404);
    assert.equal((await assign(SUPPORT, MOD)).status, 403);
    assert.equal((await postJson(ctx, MOD, url + '/assign', { assigneeId: MOD })).status, 400);
    assert.equal((await postJson(ctx, MOD, url + '/assign', { assigneeId: 'bad id', note: 'x' })).status, 400);
    assert.equal((await assign(MOD, MOD2)).status, 409, 'a moderator may not assign a different owner');
    assert.equal((await assign(ADMIN, SUPPORT)).status, 403, 'support cannot become case owner');
    assert.equal((await assign(MOD, MOD)).status, 200);
    assert.equal((await details()).assignedTo, MOD);
    assert.ok((await details()).assignedAt !== null);
    assert.equal((await assign(MOD, MOD)).status, 409, 'duplicate assignment is not audited twice');
    assert.equal((await assign(MOD2, MOD2)).status, 409, 'cannot steal another moderator ownership');
    // Quick claim may lapse, but the permanent owner remains assigned.
    await getPool().query('UPDATE safety_reports SET claimed_by = $2, claimed_at = $3 WHERE id = $1',
      ['rep-owner-1', MOD2, Date.now() - REPORT_CLAIM_TTL_MS - 1000]);
    assert.equal((await details()).claimedBy, null);
    assert.equal((await details()).assignedTo, MOD);
    assert.equal((await assign(ADMIN, MOD2, 'Supervisor reassigned')).status, 200);
    assert.equal((await details()).assignedTo, MOD2);
    assert.equal((await assign(MOD, null)).status, 409);
    assert.equal((await assign(MOD2, null, 'Handover complete')).status, 200);
    assert.equal((await details()).assignedTo, null);
    const historyResponse = await authenticatedFetch(ctx, MOD, url + '/assignment-history');
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json() as { events: Array<{
      actorId: string; previousAssignee: string | null; assigneeId: string | null; event: string; note: string;
    }> };
    assert.equal(history.events.length, 3);
    assert.deepEqual(history.events.map((e) => e.event).sort(), ['assigned', 'released', 'transferred']);
    assert.ok(history.events.some((e) => e.event === 'transferred' && e.actorId === ADMIN
      && e.previousAssignee === MOD && e.assigneeId === MOD2 && e.note === 'Supervisor reassigned'));
  });


  it('releases active case ownership with an audit event on staff revocation or downgrade', async () => {
    await report('rep-owner-revoke');
    await report('rep-owner-downgrade');
    assert.equal((await postJson(ctx, MOD, '/moderation/reports/rep-owner-revoke/assign',
      { note: 'Owned for investigation' })).status, 200);
    assert.equal((await postJson(ctx, MOD2, '/moderation/reports/rep-owner-downgrade/assign',
      { note: 'Owned for investigation' })).status, 200);

    const revoked = await store.removeStaffRole(MOD, ADMIN, 'Access revoked by administrator');
    assert.equal(revoked.ok, true);
    const downgraded = await store.setStaffRole(MOD2, 'support', ADMIN, 'New support role');
    assert.equal(downgraded.ok, true);
    assert.equal((await store.reportById('rep-owner-revoke'))?.assignedTo, null);
    assert.equal((await store.reportById('rep-owner-downgrade'))?.assignedTo, null);
    assert.equal((await authenticatedFetch(ctx, MOD, '/moderation/reports/rep-owner-revoke')).status, 403);
    assert.equal((await authenticatedFetch(ctx, MOD2, '/moderation/reports/rep-owner-downgrade')).status, 403);

    for (const id of ['rep-owner-revoke', 'rep-owner-downgrade']) {
      const events = await store.assignmentHistory(id);
      assert.equal(events?.length, 2);
      assert.equal(events?.[0]?.event, 'released');
      assert.equal(events?.[0]?.actorId, ADMIN);
      assert.match(events?.[0]?.note ?? '', /Staff access changed/);
      assert.equal(events?.[0]?.assigneeId, null);
    }
    assert.equal((await postJson(ctx, ADMIN, '/moderation/reports/rep-owner-revoke/assign',
      { assigneeId: MOD, note: 'Attempt to reassign revoked moderator' })).status, 403);
  });

  it('serialises competing case assignments and refuses changes after resolution', async () => {
    await report('rep-owner-race');
    const endpoint = '/moderation/reports/rep-owner-race/assign';
    const requests = await Promise.all([
      postJson(ctx, MOD, endpoint, { note: 'Taking initial ownership' }),
      postJson(ctx, MOD2, endpoint, { note: 'Taking initial ownership' }),
    ]);
    assert.deepEqual(requests.map((r) => r.status).sort(), [200, 409]);
    const events = await (await authenticatedFetch(ctx, ADMIN, '/moderation/reports/rep-owner-race/assignment-history')).json() as
      { events: Array<{ event: string }> };
    assert.equal(events.events.length, 1, 'only the winner has an audit event');
    const closed = await postJson(ctx, MOD, '/moderation/reports/rep-owner-race/resolve',
      { note: 'Evidence reviewed', resolution: 'dismiss' });
    assert.equal(closed.status, 200);
    assert.equal((await postJson(ctx, ADMIN, endpoint, { assigneeId: MOD2, note: 'Too late' })).status, 409);
    const reportState = await (await authenticatedFetch(ctx, ADMIN, '/moderation/reports/rep-owner-race')).json() as
      { report: { status: string; assignedTo: string | null } };
    assert.equal(reportState.report.status, 'dismissed');
    assert.ok([MOD, MOD2].includes(reportState.report.assignedTo ?? ''));
  });

  it('serves a role-gated action inbox backed by the live moderation queue', async () => {
    await report('rep-tool-inbox', 1_000);
    assert.equal((await fetch(`${ctx.baseUrl()}/admin/action-inbox`)).status, 401);
    assert.equal((await authenticatedFetch(ctx, SUPPORT, '/admin/action-inbox')).status, 403);
    assert.equal((await authenticatedFetch(ctx, ANALYST, '/admin/action-inbox')).status, 403);
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/action-inbox?limit=0')).status, 400);
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/action-inbox?limit=51')).status, 400);
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/action-inbox?type=unapproved')).status, 400);

    const response = await authenticatedFetch(ctx, MOD, '/admin/action-inbox?type=rider_report&limit=5');
    assert.equal(response.status, 200);
    const body = await response.json() as {
      items: Array<{ type: string; id: string; reportId: string; riderId: string; claimedBy: string | null }>;
      filter: string; mayHaveMore: boolean; generatedAt: number;
    };
    assert.equal(body.filter, 'rider_report');
    assert.deepEqual(body.items.map((item) => item.id), ['rider_report:rep-tool-inbox']);
    assert.equal(body.items[0]?.riderId, TARGET);
    assert.equal(body.items[0]?.claimedBy, null);
    assert.equal(typeof body.generatedAt, 'number');
    assert.equal(body.mayHaveMore, false);

    assert.equal((await postJson(ctx, MOD, '/moderation/reports/rep-tool-inbox/claim', {})).status, 200);
    const claimed = await (await authenticatedFetch(ctx, MOD2, '/admin/action-inbox?type=rider_report')).json() as
      { items: Array<{ claimedBy: string | null }> };
    assert.equal(claimed.items[0]?.claimedBy, MOD);

    assert.equal((await postJson(ctx, MOD, '/moderation/reports/rep-tool-inbox/resolve',
      { resolution: 'dismiss', note: 'Investigated evidence' })).status, 200);
    const cleared = await (await authenticatedFetch(ctx, MOD, '/admin/action-inbox?type=rider_report')).json() as
      { items: unknown[] };
    assert.deepEqual(cleared.items, []);
  });


  it('opens an exact report beyond the first 100, preserves claims, and handles concurrent resolution', async () => {
    // Hidden linked Social reports occupy the first 100 slots in the general
    // moderation list but must not hide the valid independent inbox record.
    const postId = '44444444-4444-4444-8444-444444444444';
    await getPool().query(
      `INSERT INTO social_posts (id, author_id, kind, caption, created_at, hidden_at)
       VALUES ($1, $2, 'photo', '', 1, 2)`, [postId, TARGET]);
    try {
      await getPool().query(
        `INSERT INTO social_post_reports (post_id, reporter_id, reason, created_at)
         VALUES ($1,$2,'spam',1), ($1,$3,'spam',1), ($1,$4,'spam',1)`,
        [postId, MOD, MOD2, SUPPORT]);
      await getPool().query(
        `INSERT INTO safety_reports
          (id, reporter_id, reported_rider_id, reason, details, created_at, source_post_id)
         SELECT 'rep-hidden-' || n::text, $2, $3, 'spam', 'Linked Social report', n, $1
         FROM generate_series(1, 130) AS n`,
        [postId, SUPPORT, TARGET]);
      await report('rep-direct-late', 200);

      const queue = await (await authenticatedFetch(ctx, MOD, '/moderation/reports?status=open&limit=100')).json() as
        { reports: Array<{ id: string }> };
      assert.equal(queue.reports.length, 100);
      assert.ok(!queue.reports.some((row) => row.id === 'rep-direct-late'));

      const inbox = await (await authenticatedFetch(ctx, MOD, '/admin/action-inbox?type=rider_report')).json() as
        { items: Array<{ reportId: string }> };
      assert.deepEqual(inbox.items.map((item) => item.reportId), ['rep-direct-late']);

      const exactPath = '/moderation/reports/rep-direct-late';
      assert.equal((await fetch(ctx.baseUrl() + exactPath)).status, 401);
      assert.equal((await authenticatedFetch(ctx, SUPPORT, exactPath)).status, 403);
      assert.equal((await authenticatedFetch(ctx, ANALYST, exactPath)).status, 403);
      assert.equal((await authenticatedFetch(ctx, MOD, '/moderation/reports/no-such-record')).status, 404);
      const read = async () => {
        const response = await authenticatedFetch(ctx, MOD2, exactPath);
        assert.equal(response.status, 200);
        return (await response.json() as { report: { id: string; status: string; claimedBy: string | null; resolvedBy: string | null } }).report;
      };
      assert.deepEqual((await read()).id, 'rep-direct-late');
      assert.equal((await read()).claimedBy, null);
      assert.equal((await postJson(ctx, MOD, '/moderation/reports/rep-direct-late/claim', {})).status, 200);
      assert.equal((await read()).claimedBy, MOD, 'exact lookup rechecks active claims');

      // A stale inbox snapshot must reflect a concurrent moderation decision,
      // not incorrectly say that a bounded queue caused the item to disappear.
      const results = await Promise.all([
        postJson(ctx, MOD, '/moderation/reports/rep-direct-late/resolve', { resolution: 'dismiss', note: 'Reviewed case' }),
        postJson(ctx, MOD2, '/moderation/reports/rep-direct-late/resolve', { resolution: 'dismiss', note: 'Concurrent review' }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await read()).status, 'dismissed');
      assert.ok([MOD, MOD2].includes((await read()).resolvedBy ?? ''));
    } finally {
      await getPool().query('DELETE FROM social_posts WHERE id = $1', [postId]);
    }
  });

  it('shows each role the parts of a rider’s record it needs', async () => {
    await report('rep-tool-4');
    const detail = async (riderId: string) => authenticatedFetch(ctx, riderId, `/admin/riders/${TARGET}`);
    const asAdmin = await (await detail(ADMIN)).json() as Record<string, unknown> & { rider: { riderId: string; suspendedUntil: number | null } };
    assert.equal(asAdmin.rider.riderId, TARGET);
    assert.equal(asAdmin.rider.suspendedUntil, null);
    for (const key of ['reportsAgainst', 'reportsFiled', 'actions', 'devices', 'securityEvents']) assert.ok(Array.isArray(asAdmin[key]), key);

    const asMod = await (await detail(MOD)).json() as Record<string, unknown>;
    assert.ok(Array.isArray(asMod.reportsAgainst));
    assert.equal(asMod.devices, null);
    assert.equal(asMod.securityEvents, null);

    const asSupport = await (await detail(SUPPORT)).json() as Record<string, unknown>;
    assert.equal(asSupport.reportsAgainst, null);
    assert.ok(Array.isArray(asSupport.devices));

    assert.equal((await detail(ANALYST)).status, 403);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/riders/rider_nobody_tool')).status, 404);
  });
});
