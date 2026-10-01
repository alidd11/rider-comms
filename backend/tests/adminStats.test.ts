import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { AdminStatsStore, FUNNEL_COHORT_MAX_AGE_DAYS, SERIES_DAYS } from '../src/adminStatsStore.ts';
import type { AdminOverview } from '../src/adminStatsStore.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

const ADMIN = 'stats-admin';
const RIDER_A = 'stats-rider-a';
const RIDER_B = 'stats-rider-b';
const FUNNEL = ['stats-f1', 'stats-f2', 'stats-f3', 'stats-f4', 'stats-f5'];
const SEEDED = [ADMIN, RIDER_A, RIDER_B, ...FUNNEL];
const DAY = 24 * 60 * 60 * 1000;

async function seedUsers(): Promise<void> {
  await getPool().query(`DELETE FROM users WHERE id = ANY($1::text[])`, [SEEDED]);
  await getPool().query(
    `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin, suspended_at) VALUES
       ($1, 'tst_stats_admin', 'stats-admin@example.com', 'test-only', now(), true, NULL),
       ($2, 'tst_stats_alpha', 'Alpha_Rider@example.com', 'test-only', now(), false, NULL),
       ($3, 'tst_stats_beta', 'beta@example.com', 'test-only', NULL, false, 123)`,
    [ADMIN, RIDER_A, RIDER_B],
  );
}

async function cleanup(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM direct_messages WHERE from_rider_id = ANY($1::text[])', [SEEDED]);
  await pool.query('DELETE FROM rider_activity WHERE rider_id = ANY($1::text[])', [SEEDED]);
  await pool.query('DELETE FROM rider_profiles WHERE rider_id = ANY($1::text[])', [SEEDED]);
  await pool.query('DELETE FROM friendships WHERE rider_id = ANY($1::text[])', [SEEDED]);
  await pool.query('DELETE FROM safety_reports WHERE reporter_id = ANY($1::text[])', [SEEDED]);
  await pool.query('DELETE FROM rides WHERE created_by = ANY($1::text[])', [SEEDED]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
  await pool.query('TRUNCATE daily_metrics');
}

function delta(after: AdminOverview, before: AdminOverview, pick: (o: AdminOverview) => number): number {
  return pick(after) - pick(before);
}

describe('AdminStatsStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed admin stats tests' }, () => {
  const store = new AdminStatsStore();

  before(async () => {
    await getPool().query('SELECT 1');
    await ensureMigrated();
  });

  beforeEach(cleanup);

  after(async () => {
    await cleanup();
    await resetDbForTests();
  });

  it('counts riders, activity, messages, friendships and reports', async () => {
    const now = Date.now();
    const baseline = await store.overview(now);
    await seedUsers();
    const pool = getPool();
    await pool.query(
      'INSERT INTO rider_activity (rider_id, last_seen_at) VALUES ($1, $2), ($3, $4), ($5, $6)',
      [ADMIN, now - 60_000, RIDER_A, now - 3 * DAY, RIDER_B, now - 20 * DAY],
    );
    await pool.query(
      `INSERT INTO direct_messages (id, from_rider_id, to_rider_id, text, created_at, conversation_key) VALUES
         ('stats-m1', $1, $2, 'hi', $3, 'k'), ('stats-m2', $2, $1, 'hey', $4, 'k')`,
      [RIDER_A, RIDER_B, now - 60_000, now - 10 * DAY],
    );
    await pool.query('INSERT INTO friendships (rider_id, friend_id, created_at) VALUES ($1, $2, 0), ($2, $1, 0)', [RIDER_A, RIDER_B]);
    await pool.query(
      `INSERT INTO safety_reports (id, reporter_id, reported_rider_id, reason, details, created_at) VALUES ('stats-r1', $1, $2, 'spam', '', $3)`,
      [RIDER_A, RIDER_B, now - DAY],
    );
    const result = await store.overview(now);

    assert.equal(delta(result, baseline, (o) => o.riders.total), 3);
    assert.equal(delta(result, baseline, (o) => o.riders.verified), 2);
    assert.equal(delta(result, baseline, (o) => o.riders.suspended), 1);
    assert.equal(delta(result, baseline, (o) => o.riders.admins), 1);
    assert.equal(delta(result, baseline, (o) => o.riders.newToday), 3);
    assert.equal(delta(result, baseline, (o) => o.activity.active24h), 1);
    assert.equal(delta(result, baseline, (o) => o.activity.active7d), 2);
    assert.equal(delta(result, baseline, (o) => o.activity.active30d), 3);
    assert.equal(delta(result, baseline, (o) => o.social.messages24h), 1);
    assert.equal(delta(result, baseline, (o) => o.social.messages30d), 2);
    assert.equal(delta(result, baseline, (o) => o.social.friendships), 1, 'a friendship is two rows but one relationship');
    assert.equal(delta(result, baseline, (o) => o.safety.openReports), 1);
    assert.equal(delta(result, baseline, (o) => o.safety.reports7d), 1);
    assert.equal(delta(result, baseline, (o) => o.previous.messages7d), 1, 'the 10-day-old message is in the previous week');
    assert.equal(delta(result, baseline, (o) => o.previous.messages30d), 0);

    assert.equal(result.series.days.length, SERIES_DAYS);
    assert.equal(result.series.days.at(-1), new Date(now).toISOString().slice(0, 10));
    assert.equal(result.series.signups.at(-1)! - baseline.series.signups.at(-1)!, 3);
    assert.equal(result.series.messages[SERIES_DAYS - 11]! - baseline.series.messages[SERIES_DAYS - 11]!, 1);
  });

  it('keeps the highest active-rider snapshot of the day and counts rides started', async () => {
    const now = Date.now();
    await seedUsers();
    await getPool().query('INSERT INTO rider_activity (rider_id, last_seen_at) VALUES ($1, $2)', [RIDER_A, now]);
    const first = await store.recordActiveRiders(now);
    await getPool().query('DELETE FROM rider_activity WHERE rider_id = $1', [RIDER_A]);
    const second = await store.recordActiveRiders(now);
    assert.equal(second, first - 1);

    await store.increment('rides_started', now);
    await store.increment('rides_started', now);
    const { series } = await store.overview(now);
    assert.equal(series.activeRiders.at(-1), first, 'a lower later reading never lowers the day');
    assert.equal(series.ridesStarted.at(-1), 2);
    assert.equal(series.activeRiders[0], null, 'days before tracking started are missing, not zero');
  });

  it('fills untracked days with zero rides once tracking has started', async () => {
    const now = Date.now();
    await store.increment('rides_started', now - 5 * DAY);
    const { series } = await store.overview(now);
    assert.equal(series.ridesStarted[SERIES_DAYS - 6], 1);
    assert.equal(series.ridesStarted[SERIES_DAYS - 7], null);
    assert.deepEqual(series.ridesStarted.slice(SERIES_DAYS - 5), [0, 0, 0, 0, 0]);
  });

  it('builds the growth funnel from riders who signed up 7 to 30 days ago', async () => {
    const pool = getPool();
    const now = Date.now();
    const before = (await store.overview(now)).funnel;
    const at = (daysAgo: number) => new Date(now - daysAgo * DAY);
    // f1: verified, rode, came back after a week. f2: verified, went live on
    // Nearby, last seen on day 3. f3: unverified, nothing else.
    // f4 signed up too recently and f5 too long ago to be in the cohort.
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, created_at, email_verified_at, first_ride_at, first_nearby_at) VALUES
         ($1, 'tst_stats_f1', 'f1@example.com', 'test-only', $6, $6, $6, NULL),
         ($2, 'tst_stats_f2', 'f2@example.com', 'test-only', $6, $6, NULL, $6),
         ($3, 'tst_stats_f3', 'f3@example.com', 'test-only', $6, NULL, NULL, NULL),
         ($4, 'tst_stats_f4', 'f4@example.com', 'test-only', $7, $7, $7, NULL),
         ($5, 'tst_stats_f5', 'f5@example.com', 'test-only', $8, $8, $8, NULL)`,
      [...FUNNEL, at(20), at(2), at(FUNNEL_COHORT_MAX_AGE_DAYS + 5)],
    );
    await pool.query(
      'INSERT INTO rider_activity (rider_id, last_seen_at) VALUES ($1, $2), ($3, $4), ($5, $6)',
      [FUNNEL[0], now - 5 * DAY, FUNNEL[1], now - 17 * DAY, FUNNEL[3], now],
    );
    const after = (await store.overview(now)).funnel;
    assert.deepEqual(
      {
        signedUp: after.signedUp - before.signedUp,
        verified: after.verified - before.verified,
        firstRide: after.firstRide - before.firstRide,
        returned: after.returned - before.returned,
      },
      { signedUp: 3, verified: 2, firstRide: 2, returned: 1 },
    );
    assert.equal(after.cohortEnd - after.cohortStart, (FUNNEL_COHORT_MAX_AGE_DAYS - 7) * DAY);
    assert.ok(after.rideTrackingSince && after.rideTrackingSince <= now);
  });

  it('records each rider milestone once, keeping the first time', async () => {
    await seedUsers();
    const first = Date.now() - DAY;
    await new AdminStatsStore().recordMilestone(RIDER_A, 'ride', first);
    await new AdminStatsStore().recordMilestone(RIDER_A, 'ride', Date.now());
    const { rows } = await getPool().query<{ first_ride_at: Date; first_nearby_at: Date | null }>(
      'SELECT first_ride_at, first_nearby_at FROM users WHERE id = $1',
      [RIDER_A],
    );
    assert.equal(Math.round(rows[0].first_ride_at.getTime() / 1000), Math.round(first / 1000));
    assert.equal(rows[0].first_nearby_at, null);
  });

  it('searches riders by username, email, handle or ID and escapes wildcards', async () => {
    await seedUsers();
    await getPool().query(
      `INSERT INTO rider_profiles (rider_id, display_name, handle, avatar_id, zone_tier, unit_system, notify_nearby, notify_invites, notify_chat, share_location, instagram_username, instagram_visibility, tiktok_username, tiktok_visibility, updated_at)
       VALUES ($1, 'Alpha', '@alpha_moto', 'ridge', 'free', 'mi', false, false, false, false, '', 'friends', '', 'friends', 0)`,
      [RIDER_A],
    );
    const byEmail = await store.searchRiders('alpha_rider@EXAMPLE');
    assert.deepEqual(byEmail.map((rider) => rider.riderId), [RIDER_A]);
    assert.equal(byEmail[0]!.handle, '@alpha_moto');
    assert.equal(byEmail[0]!.emailVerified, true);

    assert.deepEqual((await store.searchRiders('@alpha_mo')).map((r) => r.riderId), [RIDER_A]);
    assert.deepEqual((await store.searchRiders(RIDER_B)).map((r) => r.riderId), [RIDER_B]);
    const beta = (await store.searchRiders('tst_stats_beta'))[0]!;
    assert.equal(beta.suspended, true);
    assert.equal(beta.emailVerified, false);
    // "_" and "%" are literal characters, not wildcards.
    assert.deepEqual(await store.searchRiders('tst%stats'), []);
    assert.equal((await store.searchRiders('', 2)).length, 2);
  });
});

describe('admin dashboard API', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed admin API tests' }, () => {
  let ctx: TestServer;

  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });

  beforeEach(async () => {
    await cleanup();
    await seedUsers();
  });

  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  it('refuses non-admins', async () => {
    assert.equal((await authenticatedFetch(ctx, RIDER_A, '/admin/overview')).status, 403);
    assert.equal((await authenticatedFetch(ctx, RIDER_A, '/admin/riders?q=x')).status, 403);
  });

  it('serves the overview and rider search to admins, with validated parameters', async () => {
    const overview = await authenticatedFetch(ctx, ADMIN, '/admin/overview');
    assert.equal(overview.status, 200);
    const body = await overview.json() as AdminOverview;
    assert.equal(body.series.days.length, SERIES_DAYS);
    assert.ok(body.riders.total >= 3);

    const search = await authenticatedFetch(ctx, ADMIN, '/admin/riders?q=tst_stats_alpha');
    assert.equal(search.status, 200);
    assert.deepEqual(((await search.json()) as { riders: { riderId: string }[] }).riders.map((r) => r.riderId), [RIDER_A]);

    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/riders?limit=0')).status, 400);
    assert.equal((await authenticatedFetch(ctx, ADMIN, `/admin/riders?q=${'x'.repeat(101)}`)).status, 400);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/nope')).status, 404);
  });

  it('counts a started ride for the dashboard', async () => {
    const created = await postJson(ctx, RIDER_A, '/rides', {});
    assert.equal(created.status, 201);
    const today = new Date().toISOString().slice(0, 10);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { rows } = await getPool().query<{ value: number }>(
        `SELECT value FROM daily_metrics WHERE day = $1::date AND metric = 'rides_started'`,
        [today],
      );
      if (rows[0]?.value === 1) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail('rides_started was not incremented');
  });

  it('records a rider\'s first ride for the growth funnel', async () => {
    assert.equal((await postJson(ctx, RIDER_B, '/rides', {})).status, 201);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { rows } = await getPool().query('SELECT first_ride_at FROM users WHERE id = $1', [RIDER_B]);
      if (rows[0]?.first_ride_at) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail('first_ride_at was not recorded');
  });
});
