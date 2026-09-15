import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

describe('authenticated API', () => {
  let ctx: TestServer; before(async () => { ctx = startTestServer(); await ctx.ready; }); after(() => ctx.close());
  it('keeps health public and protects product endpoints', async () => { assert.equal((await fetch(`${ctx.baseUrl()}/health`)).status, 200); assert.equal((await fetch(`${ctx.baseUrl()}/rides`, { method: 'POST' })).status, 401); });
  it('creates guest identities', async () => { const res = await fetch(`${ctx.baseUrl()}/auth/guest`, { method: 'POST' }); assert.equal(res.status, 201); const session = await res.json() as { riderId: string; token: string }; assert.match(session.riderId, /^rider_[a-z2-9]{8}$/); const me = await fetch(`${ctx.baseUrl()}/auth/me`, { headers: { Authorization: `Bearer ${session.token}` } }); assert.deepEqual(await me.json(), { riderId: session.riderId }); });
  it('deletes an account and revokes its token', async () => { const session = ctx.authStore.createTestSession('delete-me'); const headers = { Authorization: `Bearer ${session.token}` }; assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { method: 'DELETE', headers })).status, 200); assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { headers })).status, 401); assert.equal(ctx.authStore.hasRider('delete-me'), false); });
  it('supports the private ride lifecycle', async () => { const made = await postJson(ctx, 'host', '/rides', {}); const ride = await made.json() as { rideId: string; code: string }; assert.equal((await postJson(ctx, 'member', '/rides/join', { code: ride.code })).status, 200); assert.equal((await authenticatedFetch(ctx, 'member', `/rides/${ride.rideId}/members/host`, { method: 'DELETE' })).status, 403); assert.equal((await authenticatedFetch(ctx, 'host', `/rides/${ride.rideId}`, { method: 'DELETE' })).status, 200); });
  it('uses server profile radius and enforces location privacy', async () => { assert.equal((await postJson(ctx, 'private', '/presence', { lat: 51.5, lon: -0.1 })).status, 403); ctx.profileStore.update('near', { shareLocation: true }); const res = await postJson(ctx, 'near', '/presence', { lat: 51.5, lon: -0.1, radiusMiles: 999 }); assert.equal((await res.json() as { radiusMiles: number }).radiusMiles, 1); });
});
