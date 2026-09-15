import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HideoutStore } from '../src/hideoutStore.ts';
import { getPool, resetDbForTests } from '../src/db.ts';

// HideoutStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('HideoutStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed HideoutStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query('TRUNCATE hideouts, hideout_participants');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('creates a hideout with a generated id and timestamp', async () => {
    const store = new HideoutStore();
    const hideout = await store.create({
      name: 'Base Camp',
      lat: 40,
      lon: -105,
      createdBy: 'a',
      participantIds: ['b', 'c'],
    });
    assert.ok(hideout.id);
    assert.equal(hideout.name, 'Base Camp');
    assert.ok(hideout.createdAt > 0);
  });

  it('getForRider returns hideouts where rider is creator or participant', async () => {
    const store = new HideoutStore();
    const h1 = await store.create({ name: 'H1', lat: 0, lon: 0, createdBy: 'a', participantIds: [] });
    const h2 = await store.create({ name: 'H2', lat: 0, lon: 0, createdBy: 'x', participantIds: ['a'] });
    await store.create({ name: 'H3', lat: 0, lon: 0, createdBy: 'x', participantIds: ['y'] });

    const results = await store.getForRider('a');
    const ids = results.map((h) => h.id).sort();
    assert.deepEqual(ids, [h1.id, h2.id].sort());
  });

  it('delete() succeeds only for the creator', async () => {
    const store = new HideoutStore();
    const hideout = await store.create({
      name: 'H',
      lat: 0,
      lon: 0,
      createdBy: 'a',
      participantIds: ['b'],
    });

    const forbidden = await store.delete(hideout.id, 'b');
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) assert.equal(forbidden.error, 'forbidden');

    const ok = await store.delete(hideout.id, 'a');
    assert.equal(ok.ok, true);
  });

  it('delete() 404s on an unknown hideout', async () => {
    const store = new HideoutStore();
    const result = await store.delete('nonexistent', 'a');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'not_found');
  });
});
