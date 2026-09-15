import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateScenicRouteInput } from '@rider-comms/shared';
import { ScenicRouteStore } from '../src/scenicRouteStore.ts';
import { getPool, resetDbForTests } from '../src/db.ts';

// ScenicRouteStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

function validInput() {
  const result = validateScenicRouteInput({
    name: 'Coastal Bends',
    description: 'Sweeping coastal curves with ocean views.',
    vehicleSuitability: ['motorcycle_small', 'motorcycle_large'],
    roadType: 'coastal',
    distanceMiles: 18,
    estimatedDurationMinutes: 40,
    difficulty: 'easy',
    surfaceQuality: 'excellent',
    avoidsTolls: true,
    avoidsMotorways: false,
    scenicRating: 5,
    safetyNotices: [],
    startLat: 36.1,
    startLon: -121.8,
    endLat: 36.3,
    endLon: -121.9,
  });
  if (!result.ok) throw new Error('expected valid input in test fixture');
  return result.value;
}

describe('ScenicRouteStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed ScenicRouteStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE scenic_routes');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('starts empty', async () => {
    const store = new ScenicRouteStore();
    assert.deepEqual(await store.list(), []);
  });

  it('creates a route and lists it back', async () => {
    const store = new ScenicRouteStore();
    const route = await store.create(validInput(), 'curator-1');
    assert.equal(route.createdBy, 'curator-1');
    assert.ok(route.id);
    assert.ok(route.createdAt);
    assert.deepEqual((await store.list()).map((r) => r.id), [route.id]);
    assert.deepEqual(await store.get(route.id), route);
  });

  it('filters by vehicle category', async () => {
    const store = new ScenicRouteStore();
    const route = await store.create(validInput(), 'curator-1');
    assert.deepEqual((await store.list({ vehicleCategory: 'motorcycle_small' })).map((r) => r.id), [route.id]);
    assert.deepEqual(await store.list({ vehicleCategory: 'car' }), []);
  });

  it('filters by roadType and maxDifficulty', async () => {
    const store = new ScenicRouteStore();
    const route = await store.create(validInput(), 'curator-1');
    assert.deepEqual((await store.list({ roadType: 'coastal' })).map((r) => r.id), [route.id]);
    assert.deepEqual(await store.list({ roadType: 'mountain' }), []);
    assert.deepEqual((await store.list({ maxDifficulty: 'easy' })).map((r) => r.id), [route.id]);
    assert.deepEqual((await store.list({ maxDifficulty: 'moderate' })).map((r) => r.id), [route.id]);
  });

  it('lets only the creator remove their own route', async () => {
    const store = new ScenicRouteStore();
    const route = await store.create(validInput(), 'curator-1');
    assert.equal(await store.remove(route.id, 'someone-else'), false);
    assert.equal(await store.remove(route.id, 'curator-1'), true);
    assert.equal(await store.get(route.id), undefined);
  });
});
