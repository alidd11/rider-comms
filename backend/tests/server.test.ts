import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { parseAllowedOrigins } from '../src/server.ts';
import type { ApiRequestLog } from '../src/server.ts';

// DELETE /auth/me cascades into every Postgres-backed store's deleteRider()
// (see db.ts); profileStore/rideStore/presenceStore are now Postgres-backed
// too — every test in this block that touches one of them needs
// DATABASE_URL pointing at a reachable Postgres instance and is skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);
const needsDb = { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed test' };

describe('authenticated API', () => {
  let ctx: TestServer; before(async () => { ctx = startTestServer(); await ctx.ready; }); after(() => ctx.close());
  it('keeps health public and protects product endpoints', async () => { assert.equal((await fetch(`${ctx.baseUrl()}/health`)).status, 200); assert.equal((await fetch(`${ctx.baseUrl()}/rides`, { method: 'POST' })).status, 401); });
  it('creates guest identities', needsDb, async () => { const res = await fetch(`${ctx.baseUrl()}/auth/guest`, { method: 'POST' }); assert.equal(res.status, 201); const session = await res.json() as { riderId: string; token: string }; assert.match(session.riderId, /^rider_[a-z2-9]{8}$/); const me = await fetch(`${ctx.baseUrl()}/auth/me`, { headers: { Authorization: `Bearer ${session.token}` } }); assert.deepEqual(await me.json(), { riderId: session.riderId }); });
  it('logs out and revokes the current token', async () => { const session = ctx.authStore.createTestSession('logout-me'); const headers = { Authorization: `Bearer ${session.token}` }; assert.equal((await fetch(`${ctx.baseUrl()}/auth/logout`, { method: 'POST', headers })).status, 204); assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { headers })).status, 401); });
  it('deletes an account and revokes its token', needsDb, async () => { const session = ctx.authStore.createTestSession('delete-me'); const headers = { Authorization: `Bearer ${session.token}` }; assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { method: 'DELETE', headers })).status, 200); assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { headers })).status, 401); assert.equal(await ctx.authStore.hasRider('delete-me'), false); });
  it('supports the private ride lifecycle', needsDb, async () => { const made = await postJson(ctx, 'host', '/rides', {}); const ride = await made.json() as { rideId: string; code: string }; assert.equal((await postJson(ctx, 'member', '/rides/join', { code: ride.code })).status, 200); assert.equal((await authenticatedFetch(ctx, 'member', `/rides/${ride.rideId}/members/host`, { method: 'DELETE' })).status, 403); assert.equal((await authenticatedFetch(ctx, 'host', `/rides/${ride.rideId}`, { method: 'DELETE' })).status, 200); });
  it('shares ride-member locations only after explicit ride consent and only with fellow members', needsDb, async () => {
    const made = await postJson(ctx, 'host', '/rides', {}); const ride = await made.json() as { rideId: string; code: string };
    await postJson(ctx, 'member', '/rides/join', { code: ride.code });
    assert.equal(await ctx.profileStore.getOrCreate('member').then((p) => p.shareLocation), false);
    assert.equal((await postJson(ctx, 'member', `/rides/${ride.rideId}/location`, { lat: 51.5, lon: -0.1 })).status, 403);
    assert.equal((await authenticatedFetch(ctx, 'member', `/rides/${ride.rideId}/location-sharing`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    })).status, 200);
    assert.equal((await postJson(ctx, 'member', `/rides/${ride.rideId}/location`, { lat: 51.5, lon: -0.1 })).status, 200);
    const seenByHost = await authenticatedFetch(ctx, 'host', `/rides/${ride.rideId}/locations`);
    assert.deepEqual((await seenByHost.json() as { locations: Array<{ riderId: string; lat: number; lon: number }> }).locations.map((l) => ({ riderId: l.riderId, lat: l.lat, lon: l.lon })), [{ riderId: 'member', lat: 51.5, lon: -0.1 }]);
    assert.equal((await postJson(ctx, 'outsider', `/rides/${ride.rideId}/location`, { lat: 0, lon: 0 })).status, 403);
    assert.equal((await authenticatedFetch(ctx, 'outsider', `/rides/${ride.rideId}/locations`)).status, 403);
    assert.equal((await authenticatedFetch(ctx, 'member', `/rides/${ride.rideId}/location-sharing`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }),
    })).status, 200);
    const afterWithdrawal = await authenticatedFetch(ctx, 'host', `/rides/${ride.rideId}/locations`);
    assert.deepEqual((await afterWithdrawal.json() as { locations: unknown[] }).locations, []);
  });
  it('uses server profile radius and enforces location privacy', needsDb, async () => { assert.equal((await postJson(ctx, 'private', '/presence', { lat: 51.5, lon: -0.1 })).status, 403); await ctx.profileStore.update('near', { shareLocation: true }); const res = await postJson(ctx, 'near', '/presence', { lat: 51.5, lon: -0.1, radiusMiles: 999 }); assert.equal((await res.json() as { radiusMiles: number }).radiusMiles, 1); });
});

describe('production HTTP boundary', () => {
  const allowedOrigin = 'https://alidd11.github.io';
  const logs: ApiRequestLog[] = [];
  let ctx: TestServer;

  before(async () => {
    ctx = startTestServer({ allowedOrigins: [allowedOrigin], trustProxy: true, logger: (event) => logs.push(event) });
    await ctx.ready;
  });
  after(() => ctx.close());

  it('accepts exact HTTPS and local-development origins only', () => {
    assert.deepEqual(
      parseAllowedOrigins('https://app.example.com,http://localhost:8081,https://app.example.com'),
      ['https://app.example.com', 'http://localhost:8081'],
    );
    assert.throws(() => parseAllowedOrigins('http://app.example.com'), /Invalid CORS origin/);
    assert.throws(() => parseAllowedOrigins('https://app.example.com/path'), /Invalid CORS origin/);
  });

  it('answers preflight requests only for configured origins', async () => {
    const response = await fetch(`${ctx.baseUrl()}/messages`, {
      method: 'OPTIONS',
      headers: {
        Origin: allowedOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.match(response.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.match(response.headers.get('vary') ?? '', /Origin/);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
  });

  it('rejects untrusted browser origins before side effects run', async () => {
    const response = await fetch(`${ctx.baseUrl()}/auth/guest`, {
      method: 'POST',
      headers: { Origin: 'https://malicious.example' },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'origin_not_allowed' });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  it('sets defensive response headers and propagates valid request IDs', async () => {
    const response = await fetch(`${ctx.baseUrl()}/health`, {
      headers: { Origin: allowedOrigin, 'X-Request-ID': 'request-12345' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'request-12345');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  it('does not reflect malformed request IDs and logs a trusted proxy address', async () => {
    const response = await fetch(`${ctx.baseUrl()}/ready`, {
      headers: { 'X-Request-ID': 'bad', 'X-Forwarded-For': '203.0.113.8, 10.0.0.1' },
    });
    const generatedId = response.headers.get('x-request-id') ?? '';
    assert.match(generatedId, /^[0-9a-f-]{36}$/);
    await new Promise((resolve) => setImmediate(resolve));
    const event = logs.find((entry) => entry.requestId === generatedId);
    assert.ok(event);
    assert.equal(event.clientAddress, '203.0.113.8');
    assert.equal(event.path, '/ready');
    assert.equal(event.status, 200);
  });
});
