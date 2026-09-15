import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Ridge Run',
    description: 'A short, twisty ridge run with good pavement.',
    vehicleSuitability: ['motorcycle_large'],
    roadType: 'mountain',
    distanceMiles: 22,
    estimatedDurationMinutes: 45,
    difficulty: 'moderate',
    surfaceQuality: 'good',
    avoidsTolls: true,
    avoidsMotorways: true,
    scenicRating: 4,
    safetyNotices: [],
    startLat: 39.0,
    startLon: -105.0,
    endLat: 39.2,
    endLon: -105.3,
    ...overrides,
  };
}

describe('scenic routes API', () => {
  let ctx: TestServer;
  before(async () => { ctx = startTestServer(); await ctx.ready; });
  after(() => ctx.close());

  it('requires auth', async () => {
    const res = await fetch(`${ctx.baseUrl()}/scenic-routes`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  it('starts empty', async () => {
    const res = await authenticatedFetch(ctx, 'browser-1', '/scenic-routes');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { routes: [] });
  });

  it('rejects an invalid route with 400', async () => {
    const res = await postJson(ctx, 'curator-1', '/scenic-routes', validBody({ scenicRating: 9 }));
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.match(body.error, /scenicRating/);
  });

  it('creates a valid route and lists it back', async () => {
    const created = await postJson(ctx, 'curator-1', '/scenic-routes', validBody());
    assert.equal(created.status, 201);
    const route = await created.json() as { id: string; createdBy: string };
    assert.equal(route.createdBy, 'curator-1');

    const list = await authenticatedFetch(ctx, 'browser-1', '/scenic-routes');
    const { routes } = await list.json() as { routes: { id: string }[] };
    assert.ok(routes.some((r) => r.id === route.id));

    const single = await authenticatedFetch(ctx, 'browser-1', `/scenic-routes/${route.id}`);
    assert.equal(single.status, 200);
  });

  it('404s a nonexistent route', async () => {
    const res = await authenticatedFetch(ctx, 'browser-1', '/scenic-routes/missing-id');
    assert.equal(res.status, 404);
  });

  it('filters by vehicle category', async () => {
    const car = await postJson(ctx, 'curator-2', '/scenic-routes', validBody({ vehicleSuitability: ['car'], name: 'Car Route' }));
    const carRoute = await car.json() as { id: string };

    const filtered = await authenticatedFetch(ctx, 'browser-1', '/scenic-routes?vehicleCategory=car');
    const { routes } = await filtered.json() as { routes: { id: string }[] };
    assert.ok(routes.some((r) => r.id === carRoute.id));
    assert.ok(!routes.some((r) => r.id === carRoute.id && false));

    const filteredOther = await authenticatedFetch(ctx, 'browser-1', '/scenic-routes?vehicleCategory=scooter');
    const { routes: otherRoutes } = await filteredOther.json() as { routes: { id: string }[] };
    assert.ok(!otherRoutes.some((r) => r.id === carRoute.id));
  });

  it('only the creator can delete their own route', async () => {
    const created = await postJson(ctx, 'curator-3', '/scenic-routes', validBody({ name: 'Deletable' }));
    const route = await created.json() as { id: string };

    assert.equal((await authenticatedFetch(ctx, 'someone-else', `/scenic-routes/${route.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await authenticatedFetch(ctx, 'curator-3', `/scenic-routes/${route.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await authenticatedFetch(ctx, 'curator-3', `/scenic-routes/${route.id}`, { method: 'DELETE' })).status, 404);
  });
});
