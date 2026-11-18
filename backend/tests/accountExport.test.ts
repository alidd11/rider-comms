import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { EXPORT_FORMAT_VERSION, exportRiderData } from '../src/accountExport.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const RIDER = 'rider_exportme';
const FRIEND = 'rider_exportfriend';
const ADMIN = 'rider_exportadmin';
const SEEDED = [RIDER, FRIEND, ADMIN];

describe('data export', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const cleanup = async () => {
    const pool = getPool();
    await pool.query('DELETE FROM moderation_actions WHERE target_rider_id = ANY($1::text[])', [SEEDED]);
    await pool.query('DELETE FROM safety_reports WHERE reporter_id = ANY($1::text[])', [SEEDED]);
    await pool.query('DELETE FROM direct_messages WHERE from_rider_id = ANY($1::text[])', [SEEDED]);
    await pool.query('DELETE FROM friendships WHERE rider_id = ANY($1::text[])', [SEEDED]);
    await pool.query('DELETE FROM rider_profiles WHERE rider_id = ANY($1::text[])', [SEEDED]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
  };

  before(async () => {
    await ensureMigrated();
    await cleanup();
    const pool = getPool();
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin) VALUES
         ($1, 'tst_export_me', 'export-me@example.com', 'secret-hash', now(), false),
         ($2, 'tst_export_friend', 'export-friend@example.com', 'secret-hash', now(), false),
         ($3, 'tst_export_admin', 'export-admin@example.com', 'secret-hash', now(), true)`,
      SEEDED,
    );
    await pool.query(
      `INSERT INTO rider_profiles (rider_id, display_name, handle, avatar_id, zone_tier, unit_system, notify_nearby, notify_invites, notify_chat, share_location, instagram_username, instagram_visibility, tiktok_username, tiktok_visibility, updated_at)
       VALUES ($1, 'Exporter', '@exporter', 'ridge', 'free', 'mi', false, false, false, false, '', 'friends', '', 'friends', 0),
              ($2, 'Pal', '@pal', 'ridge', 'free', 'mi', false, false, false, false, '', 'friends', '', 'friends', 0)`,
      [RIDER, FRIEND],
    );
    await pool.query('INSERT INTO friendships (rider_id, friend_id, created_at) VALUES ($1, $2, 1), ($2, $1, 1)', [RIDER, FRIEND]);
    await pool.query(
      `INSERT INTO direct_messages (id, from_rider_id, to_rider_id, text, created_at, conversation_key) VALUES
         ('m-exp-1', $1, $2, 'Hello', 10, 'exp'), ('m-exp-2', $2, $1, 'Hi back', 20, 'exp')`,
      [RIDER, FRIEND],
    );
    await pool.query(
      `INSERT INTO safety_reports (id, reporter_id, reported_rider_id, reason, details, created_at) VALUES ('r-exp-1', $1, $2, 'spam', 'Private words from the reporter', 30)`,
      [FRIEND, RIDER],
    );
    await pool.query(
      `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at) VALUES ('a-exp-1', $1, $2, 'r-exp-1', 'dismiss', 'Internal staff note', 40)`,
      [ADMIN, RIDER],
    );
    ctx = startTestServer();
    await ctx.ready;
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  it('gives a rider everything held about them, but not secrets or other people\'s words', async () => {
    const response = await authenticatedFetch(ctx, RIDER, '/auth/export');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="rider-comms-data-\d{4}-\d{2}-\d{2}\.json"$/);
    type Rows = Array<Record<string, unknown>>;
    const data = await response.json() as { format: string; version: number; account: Record<string, unknown>; profile: Record<string, unknown>; friends: Rows; messages: Rows; safetyReportsAboutYou: Rows; staffActionsAboutYou: Rows };
    assert.equal(data.format, 'rider-comms-data-export');
    assert.equal(data.version, EXPORT_FORMAT_VERSION);
    assert.equal(data.account.email, 'export-me@example.com');
    assert.equal(data.account.staff_role, null);
    assert.equal(typeof data.account.created_at, 'number');
    assert.equal(data.profile.handle, '@exporter');
    assert.deepEqual(data.friends.map((friend) => [friend.rider_id, friend.handle]), [[FRIEND, '@pal']]);
    assert.deepEqual(data.messages.map((message) => [message.direction, message.other_rider_id, message.text]), [['sent', FRIEND, 'Hello'], ['received', FRIEND, 'Hi back']]);
    assert.deepEqual(data.safetyReportsAboutYou, [{ reason: 'spam', status: 'open', created_at: 30, resolved_at: null }]);
    assert.deepEqual(data.staffActionsAboutYou, [{ action: 'dismiss', created_at: 40 }]);
    const text = JSON.stringify(data);
    for (const hidden of ['secret-hash', 'Private words from the reporter', 'Internal staff note', 'reporter_id', 'token_hash']) {
      assert.equal(text.includes(hidden), false, hidden);
    }
  });

  it('has nothing to export for an account that does not exist', async () => {
    assert.equal(await exportRiderData('rider_no_such_export'), null);
    assert.equal((await authenticatedFetch(ctx, 'rider_no_such_export', '/auth/export')).status, 404);
  });

  it('lets an admin export a rider for an access request, with a reason in the audit log', async () => {
    assert.equal((await postJson(ctx, ADMIN, `/admin/riders/${RIDER}/export`, {})).status, 400);
    assert.equal((await postJson(ctx, ADMIN, '/admin/riders/rider_no_such_export/export', { note: 'DSAR' })).status, 404);
    assert.equal((await postJson(ctx, FRIEND, `/admin/riders/${RIDER}/export`, { note: 'DSAR' })).status, 403);
    const response = await postJson(ctx, ADMIN, `/admin/riders/${RIDER}/export`, { note: 'Access request by email, ticket 42' });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { account: { rider_id: string } }).account.rider_id, RIDER);
    const { rows } = await getPool().query('SELECT moderator_id, action, note FROM moderation_actions WHERE target_rider_id = $1 AND action = $2', [RIDER, 'data_export']);
    assert.deepEqual(rows, [{ moderator_id: ADMIN, action: 'data_export', note: 'Access request by email, ticket 42' }]);
    // The rider's own export doesn't list staff exports.
    const again = await (await authenticatedFetch(ctx, RIDER, '/auth/export')).json() as { staffActionsAboutYou: unknown[] };
    assert.equal(again.staffActionsAboutYou.length, 1);
  });
});
