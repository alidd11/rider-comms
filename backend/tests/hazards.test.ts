import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

describe('hazard reports API', () => {
  let ctx: TestServer;
  before(async () => { ctx = startTestServer(); await ctx.ready; });
  after(() => ctx.close());

  it('requires auth', async () => {
    const res = await fetch(`${ctx.baseUrl()}/hazards`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  it('rejects an invalid hazard type', async () => {
    const res = await postJson(ctx, 'reporter-bad', '/hazards', { type: 'nonsense', lat: 40, lon: -74 });
    assert.equal(res.status, 400);
  });

  it('rejects out-of-range coordinates', async () => {
    const res = await postJson(ctx, 'reporter-bad2', '/hazards', { type: 'police', lat: 999, lon: -74 });
    assert.equal(res.status, 400);
  });

  it('creates a report and returns it from nearby', async () => {
    const created = await postJson(ctx, 'reporter-1', '/hazards', { type: 'police', lat: 40.0, lon: -74.0 });
    assert.equal(created.status, 201);
    const report = await created.json() as { id: string; type: string };
    assert.equal(report.type, 'police');

    const nearby = await authenticatedFetch(ctx, 'reporter-1', '/hazards/nearby?lat=40.0&lon=-74.0');
    assert.equal(nearby.status, 200);
    const { hazards } = await nearby.json() as { hazards: { id: string }[] };
    assert.ok(hazards.some((h) => h.id === report.id));
  });

  it('confirm and deny move the vote counts', async () => {
    const created = await postJson(ctx, 'reporter-2', '/hazards', { type: 'accident', lat: 41.0, lon: -75.0 });
    const report = await created.json() as { id: string };

    assert.equal((await authenticatedFetch(ctx, 'voter-1', `/hazards/${report.id}/confirm`, { method: 'POST' })).status, 200);
    assert.equal((await authenticatedFetch(ctx, 'voter-2', `/hazards/${report.id}/deny`, { method: 'POST' })).status, 200);

    const nearby = await authenticatedFetch(ctx, 'reporter-2', '/hazards/nearby?lat=41.0&lon=-75.0');
    const { hazards } = await nearby.json() as { hazards: { id: string; confirmations: number; denials: number }[] };
    const found = hazards.find((h) => h.id === report.id);
    assert.ok(found);
    assert.equal(found?.confirmations, 1);
    assert.equal(found?.denials, 1);
  });

  it('404s confirming/denying a nonexistent report', async () => {
    assert.equal((await authenticatedFetch(ctx, 'voter-3', '/hazards/missing-id/confirm', { method: 'POST' })).status, 404);
  });

  it('hides a report from nearby once enough denials come in, even before expiry', async () => {
    const created = await postJson(ctx, 'reporter-3', '/hazards', { type: 'road_closure', lat: 42.0, lon: -76.0 });
    const report = await created.json() as { id: string };

    for (const voter of ['v1', 'v2', 'v3']) {
      await authenticatedFetch(ctx, voter, `/hazards/${report.id}/deny`, { method: 'POST' });
    }

    const nearby = await authenticatedFetch(ctx, 'reporter-3', '/hazards/nearby?lat=42.0&lon=-76.0');
    const { hazards } = await nearby.json() as { hazards: { id: string }[] };
    assert.ok(!hazards.some((h) => h.id === report.id));
  });

  it('only the reporter can delete their own report', async () => {
    const created = await postJson(ctx, 'reporter-4', '/hazards', { type: 'hazard', lat: 43.0, lon: -77.0 });
    const report = await created.json() as { id: string };

    assert.equal((await authenticatedFetch(ctx, 'someone-else', `/hazards/${report.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await authenticatedFetch(ctx, 'reporter-4', `/hazards/${report.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await authenticatedFetch(ctx, 'reporter-4', `/hazards/${report.id}`, { method: 'DELETE' })).status, 404);
  });

  it('rate-limits report creation after enough requests', async () => {
    const rider = 'rate-limited-reporter';
    let sawRateLimit = false;
    for (let i = 0; i < 12; i++) {
      const res = await postJson(ctx, rider, '/hazards', { type: 'hazard', lat: 44.0, lon: -78.0 });
      if (res.status === 429) { sawRateLimit = true; break; }
      assert.equal(res.status, 201);
    }
    assert.ok(sawRateLimit, 'expected rate limiting to kick in within 12 requests');
  });
});
