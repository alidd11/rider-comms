import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { parseCaseCursor, caseKindsForRole, canAccessCaseKind } from '../src/companyCaseStore.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_caseadmin';
const SUPPORT = 'rider_casesupport';
const MOD = 'rider_casemod';
const ANALYST = 'rider_caseanalyst';
const CUSTOMER = 'rider_casecustomer';
const SEEDED = [ADMIN, SUPPORT, MOD, ANALYST, CUSTOMER];
const caseUrl = (id: string) => '/admin/cases/' + id;

describe('company case domain helpers', () => {
  it('restricts different case categories to their operational teams', () => {
    assert.deepEqual(caseKindsForRole('analyst'), []);
    assert.deepEqual(caseKindsForRole('support'), ['support']);
    assert.deepEqual(caseKindsForRole('moderator'), ['appeal']);
    assert.deepEqual(caseKindsForRole('admin'), ['support', 'appeal', 'privacy', 'incident']);
    assert.equal(canAccessCaseKind('support', 'privacy'), false);
    assert.equal(canAccessCaseKind('moderator', 'incident'), false);
    assert.equal(parseCaseCursor(null), null);
    assert.equal(parseCaseCursor('oops'), undefined);
    assert.equal(parseCaseCursor('0:11111111-1111-4111-8111-111111111111'), undefined);
    assert.deepEqual(parseCaseCursor('1234:11111111-1111-4111-8111-111111111111'),
      { at: 1234, id: '11111111-1111-4111-8111-111111111111' });
  });
});

describe('company case API and audit', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const cleanup = async () => {
    const pool = getPool();
    await pool.query('DELETE FROM company_cases WHERE created_by = ANY($1::text[])', [SEEDED]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
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
       VALUES ($1,'company_case_admin','caseadmin@example.com','x',now(),true),
        ($2,'company_case_support','casesupport@example.com','x',now(),false),
        ($3,'company_case_mod','casemod@example.com','x',now(),false),
        ($4,'company_case_analyst','caseanalyst@example.com','x',now(),false),
        ($5,'company_case_rider','caserider@example.com','x',now(),false)`, SEEDED,
    );
    await getPool().query(
      `INSERT INTO staff_roles (rider_id, role, granted_by, granted_at)
       VALUES ($1,'support',$3,0),($2,'moderator',$3,0),($4,'analyst',$3,0)`,
      [SUPPORT, MOD, ADMIN, ANALYST],
    );
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  const list = (actor: string, query = '') => authenticatedFetch(ctx, actor, '/admin/cases' + query);
  const create = (actor: string, kind: string, title = 'Rider unable to sign in') =>
    postJson(ctx, actor, '/admin/cases', {
      kind, title, description: 'Internal case. No rider message sent.', priority: 'normal',
      subjectRiderId: CUSTOMER,
    });

  it('denies ordinary riders and analysts, segregates teams and validates input', async () => {
    assert.equal((await fetch(ctx.baseUrl() + '/admin/cases')).status, 401);
    assert.equal((await list(CUSTOMER)).status, 403);
    assert.equal((await list(ANALYST)).status, 403);
    assert.equal((await create(MOD, 'support')).status, 403);
    assert.equal((await create(SUPPORT, 'privacy')).status, 403);
    assert.equal((await list(SUPPORT, '?kind=privacy')).status, 403);
    assert.equal((await list(MOD, '?kind=support')).status, 403);
    assert.equal((await list(ADMIN, '?kind=bad')).status, 400);
    assert.equal((await list(ADMIN, '?status=bad')).status, 400);
    assert.equal((await list(ADMIN, '?limit=51')).status, 400);
    assert.equal((await list(ADMIN, '?limit=0')).status, 400);
    assert.equal((await list(ADMIN, '?before=broken')).status, 400);
    assert.equal((await create(SUPPORT, 'support', 'x')).status, 400);
    assert.equal((await create(SUPPORT, 'support', '<img src=x onerror=1>')).status, 201);
    assert.equal((await postJson(ctx, ADMIN, '/admin/cases', {
      kind: 'support', title: 'Invalid rider reference', description: '', subjectRiderId: 'rider_missing_customer',
    })).status, 404);
  });

  it('persists a support case, locks ownership and keeps an append-only event history', async () => {
    const created = await create(SUPPORT, 'support');
    assert.equal(created.status, 201);
    const item = (await created.json() as { item: { id: string; version: number; status: string; kind: string } }).item;
    assert.equal(item.version, 1);
    assert.equal(item.kind, 'support');
    assert.equal(item.status, 'open');
    assert.equal((await authenticatedFetch(ctx, MOD, caseUrl(item.id))).status, 404);
    assert.equal((await authenticatedFetch(ctx, ANALYST, caseUrl(item.id))).status, 403);
    const assign = await postJson(ctx, SUPPORT, caseUrl(item.id) + '/assign', { note: 'Taking case', expectedVersion: 1 });
    assert.equal(assign.status, 200);
    const assigned = (await assign.json() as { item: { assignedTo: string; version: number } }).item;
    assert.equal(assigned.assignedTo, SUPPORT);
    assert.equal(assigned.version, 2);
    assert.equal((await postJson(ctx, SUPPORT, caseUrl(item.id) + '/status', {
      note: 'Investigating account access', status: 'in_progress', expectedVersion: 1,
    })).status, 409, 'stale mutation cannot silently overwrite the new owner');

    const note = await postJson(ctx, SUPPORT, caseUrl(item.id) + '/notes', {
      expectedVersion: 2, note: 'Check device history with user consent; do not expose passwords.',
    });
    assert.equal(note.status, 200);
    const status = await postJson(ctx, SUPPORT, caseUrl(item.id) + '/status', {
      expectedVersion: 3, note: 'Waiting on verified account owner', status: 'waiting',
    });
    assert.equal(status.status, 200);
    const priority = await postJson(ctx, SUPPORT, caseUrl(item.id) + '/priority', {
      expectedVersion: 4, note: 'Repeated login failures', priority: 'high',
    });
    assert.equal(priority.status, 200);
    assert.equal((await postJson(ctx, SUPPORT, caseUrl(item.id) + '/status', {
      expectedVersion: 5, note: 'Cannot close directly', status: 'closed',
    })).status, 409);
    assert.equal((await postJson(ctx, SUPPORT, caseUrl(item.id) + '/notes', {
      expectedVersion: 5, note: '',
    })).status, 400);

    const detail = await authenticatedFetch(ctx, SUPPORT, caseUrl(item.id));
    assert.equal(detail.status, 200);
    const record = await detail.json() as { item: { version: number; priority: string; status: string }; events: { event: string; actorId: string }[] };
    assert.equal(record.item.version, 5);
    assert.equal(record.item.priority, 'high');
    assert.equal(record.item.status, 'waiting');
    assert.deepEqual(record.events.map((e) => e.event), ['created', 'assigned', 'note', 'status', 'priority']);
    assert.ok(record.events.every((e) => e.actorId === SUPPORT));
    const adminOverride = await postJson(ctx, ADMIN, caseUrl(item.id) + '/assign', {
      expectedVersion: 5, note: 'Handover to administrator', assigneeId: ADMIN,
    });
    assert.equal(adminOverride.status, 200);
    assert.equal((await postJson(ctx, SUPPORT, caseUrl(item.id) + '/assign', {
      expectedVersion: 6, note: 'Attempt to take back', assigneeId: SUPPORT,
    })).status, 409);

    // On account deletion the subject field loses its direct rider ID.
    await getPool().query('DELETE FROM users WHERE id = $1', [CUSTOMER]);
    const updated = await authenticatedFetch(ctx, ADMIN, caseUrl(item.id));
    assert.equal((await updated.json() as { item: { subjectRiderId: string | null } }).item.subjectRiderId, null);
  });

  it('limits ordered results and refuses privacy/incident visibility to support and moderation', async () => {
    const privacy = await create(ADMIN, 'privacy', 'Data access request awaiting verification');
    const incident = await create(ADMIN, 'incident', 'Provider degraded for group rides');
    const appeal = await create(MOD, 'appeal', 'Suspension appeal pending review');
    const support = await create(SUPPORT, 'support');
    for (const res of [privacy, incident, appeal, support]) assert.equal(res.status, 201);
    const p = (await privacy.json() as { item: { id: string } }).item.id;
    const i = (await incident.json() as { item: { id: string } }).item.id;
    assert.equal((await authenticatedFetch(ctx, SUPPORT, caseUrl(p))).status, 404);
    assert.equal((await authenticatedFetch(ctx, MOD, caseUrl(i))).status, 404);
    const s = await (await list(SUPPORT)).json() as { items: { kind: string }[] };
    assert.deepEqual(s.items.map((v) => v.kind), ['support']);
    const m = await (await list(MOD)).json() as { items: { kind: string }[] };
    assert.deepEqual(m.items.map((v) => v.kind), ['appeal']);
    const first = await (await list(ADMIN, '?limit=2')).json() as {
      items: { id: string }[]; hasMore: boolean; nextCursor: string;
    };
    assert.equal(first.items.length, 2);
    assert.equal(first.hasMore, true);
    const second = await (await list(ADMIN, '?limit=2&before=' + encodeURIComponent(first.nextCursor))).json() as { items: { id: string }[] };
    assert.equal(second.items.length, 2);
    assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 4);
  });
});
