import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HazardStore } from '../src/hazardStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

// HazardStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('HazardStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed HazardStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
      await ensureMigrated();
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query('TRUNCATE hazard_reports, hazard_report_votes');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('creates a report and finds it nearby', async () => {
    const store = new HazardStore();
    const report = await store.create('police', 40.0, -74.0, 'rider-1');
    assert.equal(report.type, 'police');
    assert.equal(report.reportedBy, 'rider-1');
    assert.equal(report.confirmations, 0);
    assert.equal(report.denials, 0);
    const found = await store.nearby(40.0, -74.0, report.createdAt);
    assert.equal(found.length, 1);
    assert.equal(found[0].id, report.id);
  });

  it('does not surface reports far outside the geo-bucket neighborhood', async () => {
    const store = new HazardStore();
    await store.create('hazard', 40.0, -74.0, 'rider-1');
    const found = await store.nearby(10.0, 100.0, Date.now());
    assert.equal(found.length, 0);
  });

  it('confirm and deny move the vote counts, ignoring a repeat vote from the same rider', async () => {
    const store = new HazardStore();
    const report = await store.create('accident', 40.0, -74.0, 'rider-1');
    assert.deepEqual(await store.confirm(report.id, 'rider-2'), { ok: true });
    assert.deepEqual(await store.confirm(report.id, 'rider-2'), { ok: true }); // duplicate, no double count
    assert.deepEqual(await store.deny(report.id, 'rider-3'), { ok: true });
    const [current] = await store.nearby(40.0, -74.0, report.createdAt);
    assert.equal(current.confirmations, 1);
    assert.equal(current.denials, 1);
  });

  it('returns not_found when voting on a nonexistent report', async () => {
    const store = new HazardStore();
    assert.deepEqual(await store.confirm('missing', 'rider-1'), { ok: false, reason: 'not_found' });
    assert.deepEqual(await store.deny('missing', 'rider-1'), { ok: false, reason: 'not_found' });
  });

  it('hides a report once net denials cross the threshold, even before its TTL', async () => {
    const store = new HazardStore();
    const report = await store.create('road_closure', 40.0, -74.0, 'rider-1');
    await store.deny(report.id, 'a');
    await store.deny(report.id, 'b');
    await store.deny(report.id, 'c');
    const found = await store.nearby(40.0, -74.0, report.createdAt);
    assert.equal(found.length, 0);
  });

  it('excludes an expired report from nearby results', async () => {
    const store = new HazardStore();
    const report = await store.create('camera', 40.0, -74.0, 'rider-1');
    const found = await store.nearby(40.0, -74.0, report.expiresAt + 1);
    assert.equal(found.length, 0);
  });

  it('lets only the reporter remove their own report', async () => {
    const store = new HazardStore();
    const report = await store.create('hazard', 40.0, -74.0, 'rider-1');
    assert.equal(await store.remove(report.id, 'rider-2'), false);
    assert.equal(await store.remove(report.id, 'rider-1'), true);
    assert.equal(await store.get(report.id), undefined);
  });

  it('removes a rider deleting their account from all their reports', async () => {
    const store = new HazardStore();
    const report = await store.create('hazard', 40.0, -74.0, 'rider-1');
    await store.deleteRider('rider-1');
    assert.equal(await store.get(report.id), undefined);
  });
});
