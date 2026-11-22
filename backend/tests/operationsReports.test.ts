import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { parseOperationsWindow, reportingBounds } from '../src/operationsReports.ts';

describe('operations reporting window validation', () => {
  it('allows exactly 7 or 30 rolling days', () => {
    assert.equal(parseOperationsWindow(null), 7);
    assert.equal(parseOperationsWindow('7'), 7);
    assert.equal(parseOperationsWindow('30'), 30);
    for (const bad of ['0', '1', '7days', '31', 'all', 'NaN', '']) {
      assert.equal(parseOperationsWindow(bad), null);
    }
    assert.deepEqual(reportingBounds(7, 1_800_000_000_000),
      { from: 1_800_000_000_000 - 7 * 86_400_000, to: 1_800_000_000_000 });
  });
});

const db = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_ops_report_admin', SUPPORT = 'rider_ops_report_support';
const MOD = 'rider_ops_report_mod', ANALYST = 'rider_ops_report_analyst';
const CUSTOMER = 'rider_ops_report_customer';
const identities = [ADMIN, SUPPORT, MOD, ANALYST, CUSTOMER];

describe('audited, complete and role-scoped operations reports', { skip: !db && 'DATABASE_URL is required' }, () => {
  let ctx: TestServer;
  const cleanup = async () => {
    await getPool().query('DELETE FROM company_cases WHERE created_by = ANY($1::text[])', [identities]);
    await getPool().query('DELETE FROM social_posts WHERE author_id = $1', [CUSTOMER]);
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [identities]);
  };
  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });
  beforeEach(async () => {
    await cleanup();
    await getPool().query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin)
       VALUES ($1,'ops_report_admin','opsadmin@example.com','x',now(),true),
         ($2,'ops_report_support','opssupport@example.com','x',now(),false),
         ($3,'ops_report_mod','opsmod@example.com','x',now(),false),
         ($4,'ops_report_analyst','opsanalyst@example.com','x',now(),false),
         ($5,'ops_report_customer','opscustomer@example.com','x',now(),false)`, identities);
    await getPool().query(
      `INSERT INTO staff_roles (rider_id, role, granted_by, granted_at)
       VALUES ($1,'support',$3,0),($2,'moderator',$3,0),($4,'analyst',$3,0)`,
      [SUPPORT, MOD, ADMIN, ANALYST]);
  });
  after(async () => { await ctx.close(); await cleanup(); await resetDbForTests(); });

  it('returns complete DB case history by authorised workstream, never a sampled queue', async () => {
    const support = await postJson(ctx, SUPPORT, '/admin/cases', {
      kind: 'support', title: 'Assistance with sign-in', description: 'Internal case only.',
    });
    assert.equal(support.status, 201);
    const supportId = (await support.json() as { item: { id: string } }).item.id;
    const privacy = await postJson(ctx, ADMIN, '/admin/cases', {
      kind: 'privacy', title: 'Review privacy request', description: 'Verify identity first.',
    });
    assert.equal(privacy.status, 201);
    const privacyId = (await privacy.json() as { item: { id: string } }).item.id;
    assert.equal((await postJson(ctx, SUPPORT, '/admin/cases/' + supportId + '/notes',
      { note: 'Waiting for verified details', expectedVersion: 1 })).status, 200);
    assert.equal((await postJson(ctx, ADMIN, '/admin/cases/' + privacyId + '/status',
      { note: 'Review complete', expectedVersion: 1, status: 'resolved' })).status, 200);

    const supportReportResponse = await authenticatedFetch(ctx, SUPPORT, '/admin/cases/activity?days=7');
    assert.equal(supportReportResponse.status, 200);
    const supportReport = await supportReportResponse.json() as {
      scope: string; completeForRetainedData: boolean; byKind: Array<{ kind: string }>;
      totals: { created: number; internalNotes: number; resolvedTransitions: number };
    };
    assert.equal(supportReport.scope, 'permitted_internal_cases');
    assert.equal(supportReport.completeForRetainedData, true);
    assert.deepEqual(supportReport.byKind.map((row) => row.kind), ['support']);
    assert.equal(supportReport.totals.created, 1);
    assert.equal(supportReport.totals.internalNotes, 1);
    assert.equal(supportReport.totals.resolvedTransitions, 0);

    const modReport = await (await authenticatedFetch(ctx, MOD, '/admin/cases/activity')).json() as {
      byKind: Array<{ kind: string }>; totals: { created: number };
    };
    assert.deepEqual(modReport.byKind.map((row) => row.kind), ['appeal']);
    assert.equal(modReport.totals.created, 0);

    const adminReport = await (await authenticatedFetch(ctx, ADMIN, '/admin/cases/activity?days=30')).json() as {
      totals: { created: number; resolvedTransitions: number }; byKind: Array<{ kind: string }>;
    };
    assert.equal(adminReport.totals.created, 2);
    assert.equal(adminReport.totals.resolvedTransitions, 1);
    assert.equal(adminReport.byKind.length, 4);
    assert.equal((await authenticatedFetch(ctx, ANALYST, '/admin/cases/activity')).status, 403);
    assert.equal((await authenticatedFetch(ctx, CUSTOMER, '/admin/cases/activity')).status, 403);
    assert.equal((await fetch(ctx.baseUrl() + '/admin/cases/activity')).status, 401);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/cases/activity?days=365')).status, 400);
  });

  it('audits internal follow-up targets and prevents stale, cross-team or invalid changes', async () => {
    const created = await postJson(ctx, SUPPORT, '/admin/cases', {
      kind: 'support', title: 'Follow up on account access', description: 'Internal reminder only.',
    });
    assert.equal(created.status, 201);
    const item = (await created.json() as { item: { id: string; version: number } }).item;
    const path = '/admin/cases/' + item.id + '/target';
    const tomorrow = Date.now() + 24 * 86_400_000;
    const invalid = await postJson(ctx, SUPPORT, path, {
      dueAt: Date.now() - 5000, expectedVersion: 1, note: 'Invalid past target',
    });
    assert.equal(invalid.status, 409);
    assert.equal((await postJson(ctx, SUPPORT, path, {
      dueAt: null, expectedVersion: 1, note: 'Nothing to clear yet',
    })).status, 409);
    assert.equal((await postJson(ctx, MOD, path, {
      dueAt: tomorrow, expectedVersion: 1, note: 'Not my workstream',
    })).status, 404);

    const assigned = await postJson(ctx, SUPPORT, '/admin/cases/' + item.id + '/assign', {
      expectedVersion: 1, note: 'Taking ownership of follow-up',
    });
    assert.equal(assigned.status, 200);
    const target = await postJson(ctx, SUPPORT, path, {
      dueAt: tomorrow, expectedVersion: 2, note: 'Review identity evidence tomorrow',
    });
    assert.equal(target.status, 200);
    const changed = (await target.json() as { item: { dueAt: number | null; version: number } }).item;
    assert.equal(changed.dueAt, tomorrow);
    assert.equal(changed.version, 3);
    assert.equal((await postJson(ctx, SUPPORT, path, {
      dueAt: tomorrow + 300_000, expectedVersion: 2, note: 'Conflicting update',
    })).status, 409);
    const after = await (await authenticatedFetch(ctx, SUPPORT, '/admin/cases/' + item.id)).json() as {
      events: Array<{ event: string; note: string; fromValue: string | null; toValue: string | null }>;
    };
    const events = after.events.filter((event) => event.event === 'target');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.note, 'Review identity evidence tomorrow');
    assert.equal(events[0]?.fromValue, null);
    assert.equal(events[0]?.toValue, String(tomorrow));

    const report = await (await authenticatedFetch(ctx, SUPPORT, '/admin/cases/activity?days=7')).json() as {
      totals: { configuredTargets: number; dueSoonTargets: number; overdueTargets: number };
    };
    assert.equal(report.totals.configuredTargets, 1);
    assert.equal(report.totals.dueSoonTargets, 0);
    assert.equal(report.totals.overdueTargets, 0);
    const clear = await postJson(ctx, SUPPORT, path, {
      dueAt: null, expectedVersion: 3, note: 'No further follow-up required',
    });
    assert.equal(clear.status, 200);
    const latest = (await clear.json() as { item: { dueAt: number | null } }).item;
    assert.equal(latest.dueAt, null);
    const cleaned = await (await authenticatedFetch(ctx, SUPPORT, '/admin/cases/activity?days=7')).json() as {
      totals: { configuredTargets: number };
    };
    assert.equal(cleaned.totals.configuredTargets, 0);
  });

  it('limits Social reporting to moderators and administrators, returning aggregates only', async () => {
    const beforeResponse = await authenticatedFetch(ctx, MOD, '/admin/social/activity?days=7');
    assert.equal(beforeResponse.status, 200);
    const baseline = (await beforeResponse.json() as { metrics: { posts: number; reports: number; reportedPosts: number } }).metrics;
    const id = randomUUID();
    const now = Date.now();
    await getPool().query(
      'INSERT INTO social_posts (id, author_id, kind, caption, created_at) VALUES ($1,$2,$3,$4,$5)',
      [id, CUSTOMER, 'photo', 'This caption is private to the report', now]);
    await getPool().query(
      'INSERT INTO social_post_reports (post_id, reporter_id, reason, created_at) VALUES ($1,$2,$3,$4)',
      [id, SUPPORT, 'spam', now]);
    const res = await authenticatedFetch(ctx, MOD, '/admin/social/activity?days=7');
    assert.equal(res.status, 200);
    const body = await res.json() as {
      metrics: { posts: number; reports: number; reportedPosts: number };
      unavailable: string[]; scope: string;
    };
    assert.equal(body.metrics.posts, baseline.posts + 1);
    assert.equal(body.metrics.reports, baseline.reports + 1);
    assert.equal(body.metrics.reportedPosts, baseline.reportedPosts + 1);
    assert.equal(body.scope, 'social_content_safety');
    assert.ok(body.unavailable.includes('social_audience_retention'));
    assert.equal(JSON.stringify(body).includes('This caption is private'), false);
    for (const actor of [SUPPORT, ANALYST, CUSTOMER]) {
      assert.equal((await authenticatedFetch(ctx, actor, '/admin/social/activity')).status, 403);
    }
    assert.equal((await authenticatedFetch(ctx, MOD, '/admin/social/activity?days=14')).status, 400);
    assert.equal((await fetch(ctx.baseUrl() + '/admin/social/activity')).status, 401);
  });
});
