import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorFields, log, logLine } from '../src/log.ts';
import { LATENCY_BUCKETS_MS, MAX_TRACKED_ROUTES, RequestMetrics, percentile, routeKey } from '../src/requestMetrics.ts';
import { SLOW_REQUEST_MS, requestLogLevel } from '../src/server.ts';
import { authenticatedFetch, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('log', () => {
  it('writes one JSON line with the time, service, commit and replica', () => {
    const original = { commit: process.env.RAILWAY_GIT_COMMIT_SHA, replica: process.env.RAILWAY_REPLICA_ID };
    process.env.RAILWAY_GIT_COMMIT_SHA = 'abcdef1234567890';
    process.env.RAILWAY_REPLICA_ID = 'replica-1';
    try {
      assert.deepEqual(JSON.parse(logLine('info', 'thing_done', { count: 2 }, new Date(0))), {
        ts: '1970-01-01T00:00:00.000Z', level: 'info', event: 'thing_done', service: 'rider-comms-backend', commit: 'abcdef123456', replica: 'replica-1', count: 2,
      });
    } finally {
      if (original.commit === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA; else process.env.RAILWAY_GIT_COMMIT_SHA = original.commit;
      if (original.replica === undefined) delete process.env.RAILWAY_REPLICA_ID; else process.env.RAILWAY_REPLICA_ID = original.replica;
    }
  });

  it('sends each level to the matching console stream', (t) => {
    const seen: string[] = [];
    t.mock.method(console, 'log', () => seen.push('log'));
    t.mock.method(console, 'warn', () => seen.push('warn'));
    t.mock.method(console, 'error', () => seen.push('error'));
    for (const level of ['debug', 'info', 'warn', 'error', 'fatal'] as const) log(level, 'x');
    assert.deepEqual(seen, ['log', 'log', 'warn', 'error', 'error']);
  });

  it('describes errors and anything else thrown', () => {
    const fields = errorFields(new Error('boom'));
    assert.equal(fields.message, 'boom');
    assert.match(fields.stack ?? '', /boom/);
    assert.deepEqual(errorFields('plain'), { message: 'plain' });
  });

  it('logs failures as errors and slow requests as warnings', () => {
    assert.equal(requestLogLevel({ status: 200, durationMs: 10 }), 'info');
    assert.equal(requestLogLevel({ status: 404, durationMs: SLOW_REQUEST_MS + 1 }), 'warn');
    assert.equal(requestLogLevel({ status: 503, durationMs: 1 }), 'error');
  });
});

describe('request metrics', () => {
  it('groups paths by route without keeping IDs', () => {
    assert.equal(routeKey('get', '/riders/rider_ab12cd34/profile'), 'GET /riders/:rider/profile');
    assert.equal(routeKey('POST', '/moderation/social-posts/11111111-1111-4111-8111-111111111111/remove'), 'POST /moderation/social-posts/:id/remove');
    assert.equal(routeKey('GET', '/rides/42'), 'GET /rides/:n');
    assert.equal(routeKey('GET', '/rides/RIDE7X2Q/members'), 'GET /rides/:id/members');
    assert.equal(routeKey('GET', '/social/handles/@maya'), 'GET /social/handles/:id');
    assert.equal(routeKey('GET', `/x/${'a'.repeat(41)}`), 'GET /x/:id');
    assert.equal(routeKey('GET', '/health'), 'GET /health');
    assert.equal(routeKey('GET', '/'), 'GET /');
  });

  it('reads percentiles from the response-time buckets', () => {
    const histogram = new Array(LATENCY_BUCKETS_MS.length + 1).fill(0);
    assert.equal(percentile(histogram, 0.95), 0);
    histogram[0] = 90; // ≤5 ms
    histogram[5] = 9; // ≤250 ms
    histogram[LATENCY_BUCKETS_MS.length] = 1; // over 10 s
    assert.equal(percentile(histogram, 0.5), 5);
    assert.equal(percentile(histogram, 0.95), 250);
    assert.equal(percentile(histogram, 1), 20000);
  });

  it('summarises the last hour per route, busiest and slowest first', () => {
    let now = Date.UTC(2026, 10, 18, 12, 0, 0);
    const metrics = new RequestMetrics(() => now, { watchEventLoop: false });
    for (let i = 0; i < 8; i += 1) metrics.record('GET', `/riders/rider_${i}a/profile`, 200, 12);
    metrics.record('GET', '/riders/rider_xa/profile', 500, 30);
    for (let i = 0; i < 5; i += 1) metrics.record('POST', '/rides', i === 0 ? 400 : 201, 900);
    now += 61_000;
    metrics.record('GET', '/health', 200, 1);

    const snapshot = metrics.snapshot({ totalCount: 4, idleCount: 3, waitingCount: 0, options: { max: 20 } });
    assert.equal(snapshot.windowMinutes, 60);
    assert.equal(snapshot.uptimeSeconds, 61);
    assert.equal(snapshot.totals.count, 15);
    assert.equal(snapshot.routes[0]!.route, 'GET /riders/:rider/profile');
    assert.equal(snapshot.routes[0]!.count, 9);
    assert.equal(snapshot.routes[0]!.errorRate, 0.1111);
    assert.equal(snapshot.slowest[0]!.route, 'POST /rides');
    assert.equal(snapshot.slowest[0]!.p95Ms, 1000);
    assert.equal(snapshot.slowest[0]!.clientErrorRate, 0.2);
    assert.deepEqual(snapshot.perMinute.map((entry) => [entry.count, entry.serverErrors]), [[14, 1], [1, 0]]);
    assert.deepEqual(snapshot.database, { total: 4, idle: 3, waiting: 0, max: 20 });
    assert.equal(snapshot.process.eventLoopDelayP99Ms, null);
    assert.equal(metrics.snapshot().database, null);

    // A provider refusing or a feature switched off (502/503) is counted
    // apart from our own failures.
    metrics.record('POST', '/social/media', 503, 600);
    metrics.record('GET', '/places/search', 502, 200);
    metrics.record('GET', '/places/search', 504, 200);
    const split = metrics.snapshot();
    assert.equal(split.totals.count, 18);
    assert.equal(split.totals.unavailableRate, 0.1111);
    assert.equal(split.totals.errorRate, 0.1111);

    // An hour later the old minutes have aged out.
    now += 60 * 60_000;
    metrics.record('GET', '/health', 200, 1);
    assert.equal(metrics.snapshot().totals.count, 1);
  });

  it('counts routes beyond the limit together', () => {
    const metrics = new RequestMetrics(() => 0, { watchEventLoop: false });
    for (let i = 0; i <= MAX_TRACKED_ROUTES; i += 1) metrics.record('GET', `/route${'x'.repeat(i % 30)}/${'y'.repeat(Math.floor(i / 30))}`, 200, 1);
    const routes = metrics.snapshot().routes;
    assert.ok(metrics.snapshot().totals.count === MAX_TRACKED_ROUTES + 1);
    assert.ok(routes.length <= 15);
  });

  it('reports event-loop delay when watching it', async () => {
    const metrics = new RequestMetrics();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const delay = metrics.snapshot().process.eventLoopDelayP99Ms;
    metrics.stop();
    assert.ok(delay === null || delay >= 0);
  });
});

describe('GET /admin/metrics', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const ADMIN = 'rider_metricsadmin';
  before(async () => {
    await ensureMigrated();
    await getPool().query('DELETE FROM users WHERE id = $1', [ADMIN]);
    await getPool().query(`INSERT INTO users (id, username, email, password_hash, is_admin) VALUES ($1, 'tst_metrics_admin', 'metrics-admin@example.com', 'test-only', true)`, [ADMIN]);
    ctx = startTestServer();
    await ctx.ready;
  });
  after(async () => {
    await ctx.close();
    await getPool().query('DELETE FROM users WHERE id = $1', [ADMIN]);
    await resetDbForTests();
  });

  it('shows staff the request figures for this replica', async () => {
    await fetch(`${ctx.baseUrl()}/health`);
    const response = await authenticatedFetch(ctx, ADMIN, '/admin/metrics');
    assert.equal(response.status, 200);
    const body = await response.json() as { totals: { count: number }; routes: { route: string }[]; database: { max: number } | null };
    assert.ok(body.totals.count >= 1);
    assert.ok(body.routes.some((route) => route.route === 'GET /health'));
    assert.ok(body.database && body.database.max > 0);
    assert.equal((await authenticatedFetch(ctx, 'rider_not_staff', '/admin/metrics')).status, 403);
  });
});
