import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { parsePartnerApplication } from '../src/partnerStore.ts';
import { permissionsFor, roleCan } from '../src/staffRoles.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_partneradmin';
const PARTNERS = 'rider_partnerreviewer';
const PARTNERS_TWO = 'rider_partnerreviewer2';
const MOD = 'rider_partnermod';
const RIDER = 'rider_partnerrider';
const SEEDED = [ADMIN, PARTNERS, PARTNERS_TWO, MOD, RIDER];

const application = (overrides: Record<string, unknown> = {}) => ({
  kind: 'seller', businessName: 'Twisties Moto Gear', contactName: 'Sam Rider',
  contactEmail: 'Sam@Example.com', website: 'twisties.example', country: 'gb',
  category: 'Riding gear', description: 'Independent shop selling helmets, gloves and jackets.',
  acceptTerms: true, ...overrides,
});

describe('partner application validation and roles', () => {
  it('cleans valid input and names the first invalid field', () => {
    const ok = parsePartnerApplication(application());
    assert.ok(!('error' in ok));
    assert.equal(ok.contactEmail, 'sam@example.com');
    assert.equal(ok.country, 'GB');
    assert.equal(ok.website, 'https://twisties.example/');
    assert.deepEqual(parsePartnerApplication(application({ kind: 'reseller' })), { error: 'invalid_kind' });
    assert.deepEqual(parsePartnerApplication(application({ businessName: 'x' })), { error: 'invalid_business_name' });
    assert.deepEqual(parsePartnerApplication(application({ contactName: '' })), { error: 'invalid_contact_name' });
    assert.deepEqual(parsePartnerApplication(application({ contactEmail: 'nope' })), { error: 'invalid_email' });
    assert.deepEqual(parsePartnerApplication(application({ website: 'javascript:alert(1)' })), { error: 'invalid_website' });
    assert.deepEqual(parsePartnerApplication(application({ website: 'localhost' })), { error: 'invalid_website' });
    assert.deepEqual(parsePartnerApplication(application({ country: 'GBR' })), { error: 'invalid_country' });
    assert.deepEqual(parsePartnerApplication(application({ category: 'x' })), { error: 'invalid_category' });
    assert.deepEqual(parsePartnerApplication(application({ description: 'too short' })), { error: 'invalid_description' });
    assert.ok(!('error' in parsePartnerApplication(application({ website: '' }))));
  });

  it('gives the partnerships role applications only', () => {
    assert.deepEqual(permissionsFor('partnerships'), ['view_overview', 'view_system', 'review_partners']);
    assert.equal(roleCan('partnerships', 'view_riders'), false);
    assert.equal(roleCan('partnerships', 'moderate'), false);
    assert.equal(roleCan('moderator', 'review_partners'), false);
    assert.equal(roleCan('admin', 'review_partners'), true);
  });
});

describe('partner onboarding API', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const cleanup = async () => {
    const pool = getPool();
    await pool.query("DELETE FROM partner_applications WHERE contact_email LIKE '%@example.com'");
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
    await pool.query("DELETE FROM rate_limit_events WHERE action = 'partner_apply'");
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
       VALUES ($1,'partner_admin','padmin@example.org','x',now(),true),
        ($2,'partner_reviewer','previewer@example.org','x',now(),false),
        ($3,'partner_reviewer_two','previewer2@example.org','x',now(),false),
        ($4,'partner_mod','pmod@example.org','x',now(),false),
        ($5,'partner_rider','prider@example.org','x',now(),false)`, SEEDED,
    );
    await getPool().query(
      `INSERT INTO staff_roles (rider_id, role, granted_by, granted_at)
       VALUES ($1,'partnerships',$3,0),($2,'partnerships',$3,0),($4,'moderator',$3,0)`,
      [PARTNERS, PARTNERS_TWO, ADMIN, MOD],
    );
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  const apply = (body: unknown) => fetch(ctx.baseUrl() + '/partners/apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const submit = async () => {
    const response = await apply(application());
    assert.equal(response.status, 201);
    const { reference } = await response.json() as { reference: string };
    assert.match(reference, /^RC-[2-9A-HJ-NP-Z]{6}$/);
    const { items } = await (await authenticatedFetch(ctx, ADMIN, '/admin/partners')).json() as { items: { id: string; reference: string }[] };
    const item = items.find((value) => value.reference === reference)!;
    return item.id;
  };

  it('accepts a public application, refuses bad ones and drops bot submissions', async () => {
    assert.equal((await apply(application({ acceptTerms: false }))).status, 400);
    const bad = await apply(application({ contactEmail: 'x' }));
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'invalid_email' });
    const bot = await apply(application({ company: 'filled by a bot' }));
    assert.equal(bot.status, 202);
    const { items } = await (await authenticatedFetch(ctx, ADMIN, '/admin/partners')).json() as { items: unknown[] };
    assert.equal(items.length, 0);
    await submit();
  });

  it('limits public applications per address', async () => {
    for (let i = 0; i < 4; i += 1) assert.equal((await apply(application({ acceptTerms: false }))).status, 400);
    assert.equal((await apply(application())).status, 201);
    assert.equal((await apply(application())).status, 429);
  });

  it('keeps applications away from riders and other staff roles', async () => {
    assert.equal((await fetch(ctx.baseUrl() + '/admin/partners')).status, 401);
    assert.equal((await authenticatedFetch(ctx, RIDER, '/admin/partners')).status, 403);
    const denied = await authenticatedFetch(ctx, MOD, '/admin/partners');
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'permission_required', permission: 'review_partners' });
    assert.equal((await authenticatedFetch(ctx, PARTNERS, '/admin/partners')).status, 200);
    assert.equal((await authenticatedFetch(ctx, PARTNERS, '/admin/partners?status=bad')).status, 400);
    assert.equal((await authenticatedFetch(ctx, PARTNERS, '/admin/partners?kind=bad')).status, 400);
    assert.equal((await authenticatedFetch(ctx, PARTNERS, '/admin/partners?limit=99')).status, 400);
    assert.equal((await authenticatedFetch(ctx, PARTNERS, '/admin/partners/not-a-uuid')).status, 404);
    assert.equal((await authenticatedFetch(ctx, PARTNERS, '/admin/partners/11111111-1111-4111-8111-111111111111')).status, 404);
    // Riders cannot read partner data through the rider export either.
    assert.equal((await authenticatedFetch(ctx, RIDER, '/admin/partners/summary')).status, 403);
  });

  it('reviews, checks and approves with notes, versions and an append-only history', async () => {
    const id = await submit();
    const url = '/admin/partners/' + id;
    const step = (actor: string, action: string, body: Record<string, unknown>) =>
      postJson(ctx, actor, url + '/' + action, body);

    assert.equal((await step(PARTNERS, 'status', { status: 'in_review', expectedVersion: 1 })).status, 400);
    assert.equal((await step(PARTNERS, 'status', { status: 'in_review', note: 'x', expectedVersion: 9 })).status, 409);
    assert.equal((await step(PARTNERS, 'status', { status: 'nope', note: 'x', expectedVersion: 1 })).status, 400);
    assert.equal((await step(PARTNERS, 'checklist', { check: 'tax', done: true, note: 'x', expectedVersion: 1 })).status, 400);
    assert.equal((await step(PARTNERS, 'assign', { assigneeId: 'bad id!', note: 'x', expectedVersion: 1 })).status, 400);
    assert.equal((await step(PARTNERS, 'other', { note: 'x', expectedVersion: 1 })).status, 404);

    const take = await step(PARTNERS, 'assign', { note: 'Taking this one', expectedVersion: 1 });
    assert.equal(take.status, 200);
    // Another reviewer can comment but not act on someone else's application.
    assert.equal((await step(PARTNERS_TWO, 'status', { status: 'in_review', note: 'Mine now', expectedVersion: 2 })).status, 409);
    assert.equal((await step(PARTNERS_TWO, 'assign', { assigneeId: PARTNERS_TWO, note: 'Swap', expectedVersion: 2 })).status, 409);
    assert.equal((await step(PARTNERS_TWO, 'notes', { note: 'Known brand at shows', expectedVersion: 2 })).status, 200);
    assert.equal((await step(ADMIN, 'assign', { assigneeId: MOD, note: 'Wrong team', expectedVersion: 3 })).status, 400);

    assert.equal((await step(PARTNERS, 'status', { status: 'approved', note: 'Too early', expectedVersion: 3 })).status, 409);
    assert.equal((await step(PARTNERS, 'status', { status: 'in_review', note: 'Starting checks', expectedVersion: 3 })).status, 200);
    assert.equal((await step(PARTNERS, 'status', { status: 'in_review', note: 'Again', expectedVersion: 4 })).status, 409);
    const blocked = await step(PARTNERS, 'status', { status: 'approved', note: 'Approve', expectedVersion: 4 });
    assert.equal(blocked.status, 409);
    assert.deepEqual(await blocked.json(), { error: 'checklist_incomplete' });
    let version = 4;
    for (const check of ['identity', 'business', 'website', 'policies']) {
      const done = await step(PARTNERS, 'checklist', { check, done: true, note: `Checked ${check}`, expectedVersion: version });
      assert.equal(done.status, 200);
      version += 1;
    }
    assert.equal((await step(PARTNERS, 'checklist', { check: 'identity', done: true, note: 'Again', expectedVersion: version })).status, 409);
    const approved = await step(PARTNERS, 'status', { status: 'approved', note: 'All checks passed', expectedVersion: version });
    assert.equal(approved.status, 200);
    const item = (await approved.json() as { item: { status: string; checklist: Record<string, boolean> } }).item;
    assert.equal(item.status, 'approved');
    assert.ok(Object.values(item.checklist).every(Boolean));
    // Approval is final.
    assert.equal((await step(PARTNERS, 'status', { status: 'rejected', note: 'Changed mind', expectedVersion: version + 1 })).status, 409);
    assert.equal((await step(PARTNERS, 'checklist', { check: 'identity', done: false, note: 'Undo', expectedVersion: version + 1 })).status, 409);

    const detail = await (await authenticatedFetch(ctx, PARTNERS, url)).json() as { events: { event: string; actorId: string | null; note: string }[] };
    assert.equal(detail.events.at(-1)!.event, 'submitted');
    assert.equal(detail.events.at(-1)!.actorId, null);
    assert.equal(detail.events[0]!.note, 'All checks passed');
    assert.equal(detail.events.filter((e) => e.event === 'checklist').length, 4);

    const summary = await (await authenticatedFetch(ctx, PARTNERS, '/admin/partners/summary')).json();
    assert.deepEqual(summary, { awaitingReview: 0, infoRequested: 0, approvedSellers: 1, approvedAdvertisers: 0 });
    const filtered = await (await authenticatedFetch(ctx, ADMIN, '/admin/partners?status=approved&kind=seller&limit=5')).json() as { items: unknown[] };
    assert.equal(filtered.items.length, 1);
    const open = await (await authenticatedFetch(ctx, ADMIN, '/admin/partners?status=open')).json() as { items: unknown[] };
    assert.equal(open.items.length, 0);
  });

  it('lets a rejection be reopened, and admins release or reassign', async () => {
    const id = await submit();
    const url = '/admin/partners/' + id;
    const step = (actor: string, action: string, body: Record<string, unknown>) => postJson(ctx, actor, url + '/' + action, body);
    assert.equal((await step(PARTNERS, 'status', { status: 'info_requested', note: 'Need company number', expectedVersion: 1 })).status, 200);
    assert.equal((await step(PARTNERS, 'status', { status: 'rejected', note: 'No reply', expectedVersion: 2 })).status, 200);
    assert.equal((await step(PARTNERS, 'status', { status: 'in_review', note: 'They replied', expectedVersion: 3 })).status, 200);
    assert.equal((await step(ADMIN, 'assign', { assigneeId: PARTNERS_TWO, note: 'Over to you', expectedVersion: 4 })).status, 200);
    assert.equal((await step(ADMIN, 'assign', { assigneeId: PARTNERS_TWO, note: 'Same', expectedVersion: 5 })).status, 409);
    assert.equal((await step(ADMIN, 'assign', { assigneeId: null, note: 'Back to the queue', expectedVersion: 5 })).status, 200);
    const summary = await (await authenticatedFetch(ctx, ADMIN, '/admin/partners/summary')).json() as { awaitingReview: number };
    assert.equal(summary.awaitingReview, 1);
  });
});
