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
