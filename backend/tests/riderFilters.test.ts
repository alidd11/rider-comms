import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ADMIN = 'rider_filteradmin';
const SUSPENDED = 'rider_filtersusp';
const UNVERIFIED = 'rider_filterunver';
const REPORTED = 'rider_filterrep';
const OLD = 'rider_filterold';
const SEEDED = [ADMIN, SUSPENDED, UNVERIFIED, REPORTED, OLD];

describe('staff rider filters and paging', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const cleanup = async () => {
    await getPool().query('DELETE FROM safety_reports WHERE reported_rider_id = ANY($1::text[])', [SEEDED]);
    await getPool().query('DELETE FROM users WHERE id = ANY($1::text[])', [SEEDED]);
  };
  before(async () => {
    await ensureMigrated();
    ctx = startTestServer();
    await ctx.ready;
  });
  beforeEach(async () => {
    await cleanup();
    const pool = getPool();
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, email_verified_at, is_admin, suspended_at, created_at)
       VALUES ($1,'filter_admin','fadmin@example.org','x',now(),true,NULL,now()),
        ($2,'filter_susp','fsusp@example.org','x',now(),false,(extract(epoch from now()) * 1000)::bigint,now()),
        ($3,'filter_unver','funver@example.org','x',NULL,false,NULL,now()),
        ($4,'filter_rep','frep@example.org','x',now(),false,NULL,now()),
        ($5,'filter_old','fold@example.org','x',now(),false,NULL,now() - interval '30 days')`, SEEDED,
    );
    await pool.query(
      `INSERT INTO safety_reports (id, reporter_id, reported_rider_id, reason, details, created_at, status)
       VALUES ('filter-report-1', $1, $2, 'spam', 'Filter test', $3, 'open')`, [OLD, REPORTED, Date.now()],
    );
  });
  after(async () => {
    await ctx.close();
    await cleanup();
    await resetDbForTests();
  });

  const ids = async (query: string) => {
    const response = await authenticatedFetch(ctx, ADMIN, '/admin/riders?' + query);
    assert.equal(response.status, 200);
    const body = await response.json() as { riders: { riderId: string }[]; nextOffset: number | null };
    return { ids: body.riders.map((rider) => rider.riderId).filter((id) => SEEDED.includes(id)), nextOffset: body.nextOffset };
  };

  it('filters by status and age, and pages', async () => {
    assert.deepEqual((await ids('q=filter_&filter=suspended')).ids, [SUSPENDED]);
    assert.deepEqual((await ids('q=filter_&filter=unverified')).ids, [UNVERIFIED]);
    assert.deepEqual((await ids('q=filter_&filter=staff')).ids, [ADMIN]);
    assert.deepEqual((await ids('q=filter_&filter=reported')).ids, [REPORTED]);
    assert.ok(!(await ids('q=filter_&filter=new')).ids.includes(OLD));
    assert.equal((await ids('q=filter_&filter=all')).ids.length, 5);
    const first = await ids('q=filter_&limit=2');
    assert.equal(first.ids.length, 2);
    assert.equal(first.nextOffset, 2);
    const rest = await ids('q=filter_&limit=2&offset=4');
    assert.equal(rest.ids.length, 1);
    assert.equal(rest.nextOffset, null);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/riders?filter=bad')).status, 400);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/riders?offset=-1')).status, 400);
    assert.equal((await authenticatedFetch(ctx, ADMIN, '/admin/riders?offset=99999')).status, 400);
  });
});
