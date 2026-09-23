import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { parseAllowedOrigins } from '../src/server.ts';
import type { ApiRequestLog } from '../src/server.ts';
import { DirectionsProviderError } from '../src/directionsProvider.ts';
import { getPool } from '../src/db.ts';

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
  it('does not expose disposable guest authentication', async () => {
    const unauthenticated = await fetch(`${ctx.baseUrl()}/auth/guest`, { method: 'POST' });
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), { error: 'unauthorized' });

    const authenticated = await authenticatedFetch(ctx, 'legacy-client', '/auth/guest', { method: 'POST' });
    assert.equal(authenticated.status, 404);
    assert.deepEqual(await authenticated.json(), { error: 'not_found' });
  });
  it('requires verified email for abuse-sensitive writes while preserving account access', needsDb, async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const username = `verify_${suffix}`;
    const email = `${username}@example.com`;
    const signup = await fetch(`${ctx.baseUrl()}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password: 'correct-horse-battery', deviceName: 'verification-test' }),
    });
    assert.equal(signup.status, 201);
    const session = await signup.json() as { riderId: string; token: string; emailVerified: boolean };
    assert.equal(session.emailVerified, false);
    const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

    const me = await fetch(`${ctx.baseUrl()}/auth/me`, { headers });
    assert.equal(me.status, 200);
    assert.equal((await me.json() as { emailVerified: boolean }).emailVerified, false);

    for (const [path, body] of [
      ['/friends/requests', { toRiderId: 'someone' }],
      ['/messages', { toRiderId: 'someone', text: 'hello' }],
      ['/reports', { riderId: 'someone', reason: 'spam' }],
      ['/hideouts', { name: 'Test', lat: 51.5, lon: -0.1, participantIds: ['someone'] }],
      ['/hazards', { type: 'hazard', lat: 51.5, lon: -0.1 }],
      ['/scenic-routes', {}],
      ['/presence', { lat: 51.5, lon: -0.1, accuracyMeters: 5, recordedAt: Date.now() }],
      ['/voice/token', { target: 'channel' }],
    ] as const) {
      const response = await fetch(`${ctx.baseUrl()}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(response.status, 403, path);
      assert.deepEqual(await response.json(), { error: 'email_verification_required' });
    }

    await getPool().query('UPDATE users SET email_verified_at = now() WHERE id = $1', [session.riderId]);
    const afterVerification = await fetch(`${ctx.baseUrl()}/hazards`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'hazard', lat: 51.5, lon: -0.1 }),
    });
    assert.equal(afterVerification.status, 201);

    const deletion = await fetch(`${ctx.baseUrl()}/auth/me`, { method: 'DELETE', headers });
    assert.equal(deletion.status, 200);
  });
  it('logs out and revokes the current token', async () => { const session = ctx.authStore.createTestSession('logout-me'); const headers = { Authorization: `Bearer ${session.token}` }; assert.equal((await fetch(`${ctx.baseUrl()}/auth/logout`, { method: 'POST', headers })).status, 204); assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { headers })).status, 401); });
  it('returns the durable limiter retry delay instead of a fixed Retry-After value', async () => {
    const limited = startTestServer({
      rateLimitStore: {
        consume: async (_subjectKey, action) => action === 'hazard_create'
          ? { allowed: false, retryAfterSeconds: 437 }
          : { allowed: true, retryAfterSeconds: 0 },
      },
    });
    await limited.ready;
    try {
      const response = await postJson(limited, 'rate-limited-rider', '/hazards', { type: 'hazard', lat: 51.5, lon: -0.1 });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '437');
      assert.deepEqual(await response.json(), { error: 'rate_limited' });
    } finally {
      await limited.close();
    }
  });

  it('proxies driving directions through the authenticated backend', async () => {
    const requested: Array<{ origin: { lat: number; lon: number }; destination: { lat: number; lon: number } }> = [];
    const route = {
      coordinates: [{ lat: 51.5, lon: -0.1 }, { lat: 51.51, lon: -0.11 }],
      steps: [{
        instruction: 'Turn left onto A1',
        maneuver: 'turn-left',
        distanceMeters: 1200,
        durationSeconds: 300,
        start: { lat: 51.5, lon: -0.1 },
        end: { lat: 51.51, lon: -0.11 },
        coordinates: [{ lat: 51.5, lon: -0.1 }, { lat: 51.51, lon: -0.11 }],
      }],
      distanceMeters: 1200,
      durationSeconds: 300,
    };
    const routed = startTestServer({
      directionsProvider: async (origin, destination) => {
        requested.push({ origin, destination });
        return route;
      },
    });
    await routed.ready;
    try {
      const unauthenticated = await fetch(`${routed.baseUrl()}/directions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: { lat: 51.5, lon: -0.1 }, destination: { lat: 51.51, lon: -0.11 } }),
      });
      assert.equal(unauthenticated.status, 401);

      const invalid = await postJson(routed, 'route-rider', '/directions', {
        origin: { lat: 91, lon: -0.1 },
        destination: { lat: 51.51, lon: -0.11 },
      });
      assert.equal(invalid.status, 400);
      assert.equal(requested.length, 0);

      const response = await postJson(routed, 'route-rider', '/directions', {
        origin: { lat: 51.5, lon: -0.1 },
        destination: { lat: 51.51, lon: -0.11 },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), route);
      assert.deepEqual(requested, [{
        origin: { lat: 51.5, lon: -0.1 },
        destination: { lat: 51.51, lon: -0.11 },
      }]);
    } finally {
      await routed.close();
    }
  });

  it('rate-limits directions separately before provider quota is consumed', async () => {
    const actions: string[] = [];
    let providerCalls = 0;
    const limited = startTestServer({
      rateLimitStore: {
        consume: async (_subjectKey, action) => {
          actions.push(action);
          return action === 'directions'
            ? { allowed: false, retryAfterSeconds: 73 }
            : { allowed: true, retryAfterSeconds: 0 };
        },
      },
      directionsProvider: async () => {
        providerCalls += 1;
        throw new Error('provider should not be called');
      },
    });
    await limited.ready;
    try {
      const response = await postJson(limited, 'route-rate-limited', '/directions', {
        origin: { lat: 51.5, lon: -0.1 },
        destination: { lat: 51.51, lon: -0.11 },
      });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '73');
      assert.deepEqual(await response.json(), { error: 'rate_limited' });
      assert.deepEqual(actions, ['api', 'directions']);
      assert.equal(providerCalls, 0);
    } finally {
      await limited.close();
    }
  });

  it('maps directions provider failures to safe backend errors', async () => {
    const unavailable = startTestServer({
      directionsProvider: async () => {
        throw new DirectionsProviderError('directions_timeout');
      },
    });
    await unavailable.ready;
    try {
      const response = await postJson(unavailable, 'route-timeout', '/directions', {
        origin: { lat: 51.5, lon: -0.1 },
        destination: { lat: 51.51, lon: -0.11 },
      });
      assert.equal(response.status, 504);
      assert.deepEqual(await response.json(), { error: 'directions_timeout' });
    } finally {
      await unavailable.close();
    }
  });

  it('rate-limits private ride code guessing durably by rider and client address', async () => {
    const actions: string[] = [];
    const limited = startTestServer({
      rateLimitStore: {
        consume: async (_subjectKey, action) => {
          actions.push(action);
          return action === 'ride_join_ip'
            ? { allowed: false, retryAfterSeconds: 41 }
            : { allowed: true, retryAfterSeconds: 0 };
        },
      },
    });
    await limited.ready;
    try {
      const response = await postJson(limited, 'ride-code-guesser', '/rides/join', { code: 'ABCDEF' });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '41');
      assert.deepEqual(await response.json(), { error: 'rate_limited' });
      assert.deepEqual(actions, ['api', 'ride_join_rider', 'ride_join_ip']);
    } finally {
      await limited.close();
    }
  });
  it('deletes an account and revokes its token', needsDb, async () => { const session = ctx.authStore.createTestSession('delete-me'); const headers = { Authorization: `Bearer ${session.token}` }; assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { method: 'DELETE', headers })).status, 200); assert.equal((await fetch(`${ctx.baseUrl()}/auth/me`, { headers })).status, 401); assert.equal(await ctx.authStore.hasRider('delete-me'), false); });
  it('keeps the session usable when atomic account deletion fails', async () => {
    const failed = startTestServer({ accountDeletionStore: { deleteRider: async () => { throw new Error('database unavailable'); } } });
    await failed.ready;
    try {
      const session = failed.authStore.createTestSession('retry-delete');
      const headers = { Authorization: `Bearer ${session.token}` };
      assert.equal((await fetch(`${failed.baseUrl()}/auth/me`, { method: 'DELETE', headers })).status, 500);
      assert.equal((await fetch(`${failed.baseUrl()}/auth/me`, { headers })).status, 200);
    } finally {
      await failed.close();
    }
  });
  it('supports the private ride lifecycle', needsDb, async () => { const made = await postJson(ctx, 'host', '/rides', {}); const ride = await made.json() as { rideId: string; code: string }; assert.equal((await postJson(ctx, 'member', '/rides/join', { code: ride.code })).status, 200); assert.equal((await authenticatedFetch(ctx, 'member', `/rides/${ride.rideId}/members/host`, { method: 'DELETE' })).status, 403); assert.equal((await authenticatedFetch(ctx, 'host', `/rides/${ride.rideId}`, { method: 'DELETE' })).status, 200); });
  it('reconciles current ride membership and consent after a client restart', needsDb, async () => {
    assert.equal((await authenticatedFetch(ctx, 'member', '/rides/current')).status, 200);
    const made = await postJson(ctx, 'host', '/rides', {});
    const { rideId, code } = await made.json() as { rideId: string; code: string };
    await postJson(ctx, 'member', '/rides/join', { code });
    const enabled = await authenticatedFetch(ctx, 'member', `/rides/${rideId}/location-sharing`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    assert.equal(enabled.status, 200);
    const member = await authenticatedFetch(ctx, 'member', '/rides/current');
    const snapshot = await member.json() as { ride: { rideId: string; shareRideLocation: boolean; code: string } };
    assert.equal(snapshot.ride.rideId, rideId);
    assert.equal(snapshot.ride.code, code);
    assert.equal(snapshot.ride.shareRideLocation, true);
    const host = await authenticatedFetch(ctx, 'host', '/rides/current');
    assert.equal((await host.json() as { ride: { shareRideLocation: boolean } }).ride.shareRideLocation, false);
    assert.equal((await authenticatedFetch(ctx, 'outsider', `/rides/${rideId}`)).status, 404);
    await authenticatedFetch(ctx, 'host', `/rides/${rideId}/members/member`, { method: 'DELETE' });
    assert.deepEqual(await (await authenticatedFetch(ctx, 'member', '/rides/current')).json(), { ride: null });
  });
  it('shares ride-member locations only after explicit ride consent and only with fellow members', needsDb, async () => {
    const made = await postJson(ctx, 'host', '/rides', {}); const ride = await made.json() as { rideId: string; code: string };
    await postJson(ctx, 'member', '/rides/join', { code: ride.code });
    assert.equal(await ctx.profileStore.getOrCreate('member').then((p) => p.shareLocation), false);
    assert.equal((await postJson(ctx, 'member', `/rides/${ride.rideId}/location`, { lat: 51.5, lon: -0.1 })).status, 403);
    assert.equal((await authenticatedFetch(ctx, 'member', `/rides/${ride.rideId}/location-sharing`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    })).status, 200);
    const memberUpload = await postJson(ctx, 'member', `/rides/${ride.rideId}/location`, { lat: 51.5, lon: -0.1 });
    assert.equal(memberUpload.status, 200);
    assert.deepEqual(
      (await memberUpload.json() as { locations: Array<{ riderId: string; lat: number; lon: number }> }).locations
        .map((l) => ({ riderId: l.riderId, lat: l.lat, lon: l.lon })),
      [{ riderId: 'member', lat: 51.5, lon: -0.1 }],
    );
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
  it('hides private ride locations between blocked members in both directions', needsDb, async () => {
    const made = await postJson(ctx, 'block-location-host', '/rides', {});
    const ride = await made.json() as { rideId: string; code: string };
    assert.equal((await postJson(ctx, 'block-location-member', '/rides/join', { code: ride.code })).status, 200);

    for (const riderId of ['block-location-host', 'block-location-member']) {
      assert.equal((await authenticatedFetch(ctx, riderId, `/rides/${ride.rideId}/location-sharing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })).status, 200);
    }
    assert.equal((await postJson(ctx, 'block-location-host', `/rides/${ride.rideId}/location`, { lat: 51.50, lon: -0.10 })).status, 200);
    assert.equal((await postJson(ctx, 'block-location-member', `/rides/${ride.rideId}/location`, { lat: 51.51, lon: -0.11 })).status, 200);

    const beforeBlock = await authenticatedFetch(ctx, 'block-location-host', `/rides/${ride.rideId}/locations`);
    assert.deepEqual(
      (await beforeBlock.json() as { locations: Array<{ riderId: string }> }).locations.map((location) => location.riderId).sort(),
      ['block-location-host', 'block-location-member'],
    );

    assert.equal((await postJson(ctx, 'block-location-host', '/blocks', { riderId: 'block-location-member' })).status, 200);

    const uploadAfterBlock = await postJson(ctx, 'block-location-host', `/rides/${ride.rideId}/location`, { lat: 51.50, lon: -0.10 });
    assert.equal(uploadAfterBlock.status, 200);
    assert.deepEqual(
      (await uploadAfterBlock.json() as { locations: Array<{ riderId: string }> }).locations.map((location) => location.riderId),
      ['block-location-host'],
    );

    const seenByHost = await authenticatedFetch(ctx, 'block-location-host', `/rides/${ride.rideId}/locations`);
    assert.deepEqual(
      (await seenByHost.json() as { locations: Array<{ riderId: string }> }).locations.map((location) => location.riderId),
      ['block-location-host'],
    );

    const seenByMember = await authenticatedFetch(ctx, 'block-location-member', `/rides/${ride.rideId}/locations`);
    assert.deepEqual(
      (await seenByMember.json() as { locations: Array<{ riderId: string }> }).locations.map((location) => location.riderId),
      ['block-location-member'],
    );
  });

  it('blocks client paid-tier elevation but allows returning an existing paid test tier to Free', needsDb, async () => {
    await ctx.profileStore.update('billing-rider', { zoneTier: 'premium' });

    const elevate = await authenticatedFetch(ctx, 'billing-rider', '/riders/billing-rider/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneTier: 'premium_plus' }),
    });
    assert.equal(elevate.status, 403);
    assert.deepEqual(await elevate.json(), { error: 'zone_tier_managed_by_billing' });
    assert.equal((await ctx.profileStore.getOrCreate('billing-rider')).zoneTier, 'premium');

    const downgrade = await authenticatedFetch(ctx, 'billing-rider', '/riders/billing-rider/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneTier: 'free' }),
    });
    assert.equal(downgrade.status, 200);
    assert.equal((await downgrade.json() as { zoneTier: string }).zoneTier, 'free');
    assert.equal((await ctx.profileStore.getOrCreate('billing-rider')).zoneTier, 'free');
  });

  it('uses server profile radius and enforces location privacy', needsDb, async () => {
    const fix = { lat: 51.5, lon: -0.1, accuracyMeters: 8, recordedAt: Date.now() };
    assert.equal((await postJson(ctx, 'private', '/presence', fix)).status, 403);
    await ctx.profileStore.update('near', { shareLocation: true });
    const res = await postJson(ctx, 'near', '/presence', { ...fix, radiusMiles: 999, recordedAt: Date.now() });
    assert.equal((await res.json() as { radiusMiles: number }).radiusMiles, 1);
  });
});

describe('production HTTP boundary', () => {
  const allowedOrigin = 'https://alidd11.github.io';
  const logs: ApiRequestLog[] = [];
  let ctx: TestServer;

  before(async () => {
    ctx = startTestServer({ allowedOrigins: [allowedOrigin], trustProxy: true, logger: (event) => logs.push(event), readinessCheck: async () => undefined });
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
    const response = await fetch(`${ctx.baseUrl()}/auth/signup`, {
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

  it('keeps liveness healthy but fails readiness when PostgreSQL is unavailable', async () => {
    const unavailable = startTestServer({ readinessCheck: async () => { throw new Error('database unavailable'); } });
    await unavailable.ready;
    try {
      assert.equal((await fetch(`${unavailable.baseUrl()}/health`)).status, 200);
      const response = await fetch(`${unavailable.baseUrl()}/ready`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, error: 'not_ready' });
    } finally {
      await unavailable.close();
    }
  });
});
