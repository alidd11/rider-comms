import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateScenicRouteInput } from '@rider-comms/shared';
import { ScenicRouteStore } from '../src/scenicRouteStore.ts';

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

describe('ScenicRouteStore', () => {
  it('starts empty', () => {
    const store = new ScenicRouteStore();
    assert.deepEqual(store.list(), []);
  });

  it('creates a route and lists it back', () => {
    const store = new ScenicRouteStore();
    const route = store.create(validInput(), 'curator-1');
    assert.equal(route.createdBy, 'curator-1');
    assert.ok(route.id);
    assert.ok(route.createdAt);
    assert.deepEqual(store.list().map((r) => r.id), [route.id]);
    assert.deepEqual(store.get(route.id), route);
  });

  it('filters by vehicle category', () => {
    const store = new ScenicRouteStore();
    const route = store.create(validInput(), 'curator-1');
    assert.deepEqual(store.list({ vehicleCategory: 'motorcycle_small' }).map((r) => r.id), [route.id]);
    assert.deepEqual(store.list({ vehicleCategory: 'car' }), []);
  });

  it('filters by roadType and maxDifficulty', () => {
    const store = new ScenicRouteStore();
    const route = store.create(validInput(), 'curator-1');
    assert.deepEqual(store.list({ roadType: 'coastal' }).map((r) => r.id), [route.id]);
    assert.deepEqual(store.list({ roadType: 'mountain' }), []);
    assert.deepEqual(store.list({ maxDifficulty: 'easy' }).map((r) => r.id), [route.id]);
    assert.deepEqual(store.list({ maxDifficulty: 'moderate' }).map((r) => r.id), [route.id]);
  });

  it('lets only the creator remove their own route', () => {
    const store = new ScenicRouteStore();
    const route = store.create(validInput(), 'curator-1');
    assert.equal(store.remove(route.id, 'someone-else'), false);
    assert.equal(store.remove(route.id, 'curator-1'), true);
    assert.equal(store.get(route.id), undefined);
  });
});
