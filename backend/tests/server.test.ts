import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, clearSharedTestState, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { parseAllowedOrigins } from '../src/server.ts';
import type { ApiRequestLog } from '../src/server.ts';
import { DirectionsProviderError } from '../src/directionsProvider.ts';
import { PlacesProviderError } from '../src/placesProvider.ts';
import type { PlaceSearchRequest } from '../src/placesProvider.ts';
import { getPool } from '../src/db.ts';

// DELETE /auth/me deletes the rider's rows in one transaction
// (accountDeletionStore.ts); profileStore/rideStore/presenceStore are now Postgres-backed
// too — every test in this block that touches one of them needs
// DATABASE_URL pointing at a reachable Postgres instance and is skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);
const needsDb = { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed test' };

describe('authenticated API', () => {
  let ctx: TestServer;
  before(async () => {
    await clearSharedTestState();
    ctx = startTestServer();
    await ctx.ready;
  });
  after(() => ctx.close());
  it('keeps health public and protects product endpoints', async () => { assert.equal((await fetch(`${ctx.baseUrl()}/health`)).status, 200); assert.equal((await fetch(`${ctx.baseUrl()}/rides`, { method: 'POST' })).status, 401); });
  it('does not expose disposable guest authentication', async () => {
    const unauthenticated = await fetch(`${ctx.baseUrl()}/auth/guest`, { method: 'POST' });
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), { error: 'unauthorized' });

    const authenticated = await authenticatedFetch(ctx, 'legacy-client', '/auth/guest', { method: 'POST' });
    assert.equal(authenticated.status, 404);
    assert.deepEqual(await authenticated.json(), { error: 'not_found' });
  });
  it('limits login attempts per account, not just per address', needsDb, async () => {
    const username = `lockout_${Math.random().toString(36).slice(2, 10)}`;
    const attempt = () => fetch(`${ctx.baseUrl()}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'wrong-password-123' }),
    });
    for (let i = 0; i < 10; i += 1) assert.equal((await attempt()).status, 401, `attempt ${i + 1} is checked normally`);
    const limited = await attempt();
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'rate_limited' });
    // A different account from the same address is unaffected.
    const other = await fetch(`${ctx.baseUrl()}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `${username}_b`, password: 'wrong-password-123' }),
    });
    assert.equal(other.status, 401);
  });
  it('limits accounts created per address', needsDb, async () => {
    const signup = (suffix: string) => fetch(`${ctx.baseUrl()}/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `farm_${suffix}`, email: `farm_${suffix}@example.com`, password: 'correct-horse-battery', acceptTerms: true }),
    });
    const suffix = Math.random().toString(36).slice(2, 10);
    try {
      assert.equal((await signup(suffix)).status, 201);
      // Fill the rest of this address's hourly window directly: twenty real
      // signups would hit the shared per-minute auth limit first.
      const { rows } = await getPool().query<{ subject_key: string; created_at: string }>(
        `SELECT subject_key, created_at FROM rate_limit_events WHERE action = 'signup_ip'`,
      );
      assert.equal(rows.length, 1);
      await getPool().query(
        `INSERT INTO rate_limit_events (subject_key, action, created_at)
         SELECT $1, 'signup_ip', $2::bigint FROM generate_series(1, 19)`,
        [rows[0].subject_key, rows[0].created_at],
      );
      const limited = await signup(`${suffix}b`);
      assert.equal(limited.status, 429);
      assert.deepEqual(await limited.json(), { error: 'rate_limited' });
      // Signing in from the same address is unaffected.
      const login = await fetch(`${ctx.baseUrl()}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `farm_${suffix}`, password: 'correct-horse-battery' }),
      });
      assert.equal(login.status, 200);
    } finally {
      await getPool().query(`DELETE FROM rate_limit_events WHERE action = 'signup_ip'`);
    }
  });
  it('refuses signup without agreement to the Terms, and filters objectionable usernames', needsDb, async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const post = (body: Record<string, unknown>) => fetch(`${ctx.baseUrl()}/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const base = { username: `terms_${suffix}`, email: `terms_${suffix}@example.com`, password: 'correct-horse-battery' };
    const refused = await post(base);
    assert.equal(refused.status, 400);
    assert.deepEqual(await refused.json(), { error: 'terms_not_accepted' });
    const rude = await post({ ...base, username: `fuck_${suffix.slice(0, 6)}`, acceptTerms: true });
    assert.equal(rude.status, 400);
    assert.deepEqual(await rude.json(), { error: 'objectionable_username' });
    const created = await post({ ...base, acceptTerms: true });
    assert.equal(created.status, 201);
    assert.equal((await created.json() as { termsAccepted: boolean }).termsAccepted, true);
  });
  it('asks existing accounts to agree to the current Terms before posting, but always allows reports', needsDb, async () => {
    const riderId = `terms-legacy-${Math.random().toString(36).slice(2, 8)}`;
    await getPool().query(
      `INSERT INTO users (id, username, password_hash, email_verified_at) VALUES ($1, $2, 'test-only', now())`,
      [riderId, `tst_${riderId.replace(/-/g, '_')}`],
    );
    try {
      const me = await authenticatedFetch(ctx, riderId, '/auth/me');
      const identity = await me.json() as { termsAccepted: boolean; termsVersion: string };
      assert.equal(identity.termsAccepted, false);
      assert.equal((await postJson(ctx, riderId, '/messages', { toRiderId: 'someone', text: 'hi' })).status, 403);
      const blocked = await postJson(ctx, riderId, '/hideouts', { name: 'x', lat: 51.5, lon: -0.1, participantIds: ['someone'] });
      assert.deepEqual(await blocked.json(), { error: 'terms_acceptance_required' });
      assert.notEqual((await postJson(ctx, riderId, '/reports', { riderId: 'someone', reason: 'spam' })).status, 403);

      const stale = await postJson(ctx, riderId, '/auth/accept-terms', { version: '2000-01-01' });
      assert.equal(stale.status, 409);
      assert.equal((await postJson(ctx, riderId, '/auth/accept-terms', { version: identity.termsVersion })).status, 200);
      assert.equal((await (await authenticatedFetch(ctx, riderId, '/auth/me')).json() as { termsAccepted: boolean }).termsAccepted, true);
    } finally {
      await getPool().query('DELETE FROM users WHERE id = $1', [riderId]);
    }
  });
  it('rejects objectionable profile names and slurs in messages', needsDb, async () => {
    const rejectionsToday = async () => Number((await getPool().query(
      "SELECT coalesce(sum(value), 0) AS n FROM daily_metrics WHERE metric = 'filter_rejections' AND day = (now() AT TIME ZONE 'UTC')::date",
    )).rows[0].n);
    const before = await rejectionsToday();
    const profile = await authenticatedFetch(ctx, 'filter-rider', '/riders/filter-rider/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Sh1t Rider' }),
    });
    assert.equal(profile.status, 400);
    assert.deepEqual(await profile.json(), { error: 'objectionable_content' });
    const ok = await authenticatedFetch(ctx, 'filter-rider', '/riders/filter-rider/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Sussex Rider' }),
    });
    assert.equal(ok.status, 200);
    const message = await postJson(ctx, 'filter-rider', '/messages', { toRiderId: 'someone', text: 'you f a g o t' });
    assert.equal(message.status, 400);
    assert.deepEqual(await message.json(), { error: 'objectionable_content' });
    // Both rejections are counted for the staff dashboard (fire-and-forget).
    for (let attempt = 0; attempt < 20 && (await rejectionsToday()) - before < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal((await rejectionsToday()) - before, 2);
  });
  it('requires verified email for abuse-sensitive writes while preserving account access', needsDb, async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const username = `verify_${suffix}`;
    const email = `${username}@example.com`;
    const signup = await fetch(`${ctx.baseUrl()}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password: 'correct-horse-battery', deviceName: 'verification-test', acceptTerms: true }),
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
      ['/hazards', { type: 'accident', lat: 51.5, lon: -0.1 }],
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
      body: JSON.stringify({ type: 'accident', lat: 51.5, lon: -0.1 }),
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
      const response = await postJson(limited, 'rate-limited-rider', '/hazards', { type: 'accident', lat: 51.5, lon: -0.1 });
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

  it('caches directions responses to avoid re-billing near-identical requests', async () => {
    let providerCalls = 0;
    const route = {
      coordinates: [{ lat: 51.5, lon: -0.1 }, { lat: 51.51, lon: -0.11 }],
      steps: [{
        instruction: 'Turn left onto A1',
        distanceMeters: 1200,
        durationSeconds: 300,
        start: { lat: 51.5, lon: -0.1 },
        end: { lat: 51.51, lon: -0.11 },
        coordinates: [{ lat: 51.5, lon: -0.1 }, { lat: 51.51, lon: -0.11 }],
      }],
      distanceMeters: 1200,
      durationSeconds: 300,
    };
    const cached = startTestServer({
      directionsProvider: async () => {
        providerCalls += 1;
        return route;
      },
    });
    await cached.ready;
    try {
      const first = await postJson(cached, 'route-cache-rider', '/directions', {
        origin: { lat: 51.5, lon: -0.1 },
        destination: { lat: 51.51, lon: -0.11 },
      });
      assert.equal(first.status, 200);
      assert.equal(providerCalls, 1);

      // A near-identical repeat (e.g. the ETA preview immediately followed
      // by "Start route" from a slightly different GPS fix) must hit the
      // cache, not the upstream provider again.
      const second = await postJson(cached, 'route-cache-rider', '/directions', {
        origin: { lat: 51.50001, lon: -0.10001 },
        destination: { lat: 51.51, lon: -0.11 },
      });
      assert.equal(second.status, 200);
      assert.deepEqual(await second.json(), route);
      assert.equal(providerCalls, 1);

      // A genuinely different destination must still hit the provider.
      const third = await postJson(cached, 'route-cache-rider', '/directions', {
        origin: { lat: 51.5, lon: -0.1 },
        destination: { lat: 52.0, lon: -0.2 },
      });
      assert.equal(third.status, 200);
      assert.equal(providerCalls, 2);
    } finally {
      await cached.close();
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

  it('proxies authenticated place searches without exposing the provider key', async () => {
    const requested: PlaceSearchRequest[] = [];
    const places = [{ id: 'p1', name: 'Bike Cafe', address: '1 High St', lat: 51.501, lon: -0.101 }];
    const searched = startTestServer({
      placesProvider: async (request) => {
        requested.push(request);
        return places;
      },
    });
    await searched.ready;
    try {
      const unauthenticated = await fetch(`${searched.baseUrl()}/places/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'coffee', near: { lat: 51.5, lon: -0.1 } }),
      });
      assert.equal(unauthenticated.status, 401);

      for (const body of [
        { query: 'c', near: { lat: 51.5, lon: -0.1 } },
        { query: 'coffee', near: { lat: 91, lon: -0.1 } },
        { query: 'coffee' },
      ]) {
        assert.equal((await postJson(searched, 'places-rider', '/places/search', body)).status, 400);
      }
      for (const body of [
        { includedTypes: [], near: { lat: 51.5, lon: -0.1 } },
        { includedTypes: ['Gas Station'], near: { lat: 51.5, lon: -0.1 } },
        { includedTypes: ['gas_station'] },
      ]) {
        assert.equal((await postJson(searched, 'places-rider', '/places/nearby', body)).status, 400);
      }
      assert.equal(requested.length, 0);

      const text = await postJson(searched, 'places-rider', '/places/search', { query: '  coffee ', near: { lat: 51.5, lon: -0.1 } });
      assert.equal(text.status, 200);
      assert.deepEqual(await text.json(), { places });

      const nearby = await postJson(searched, 'places-rider', '/places/nearby', {
        includedTypes: ['cafe', 'coffee_shop'],
        near: { lat: 51.5, lon: -0.1 },
      });
      assert.equal(nearby.status, 200);
      assert.deepEqual(requested, [
        { kind: 'text', query: 'coffee', near: { lat: 51.5, lon: -0.1 } },
        { kind: 'nearby', includedTypes: ['cafe', 'coffee_shop'], near: { lat: 51.5, lon: -0.1 } },
      ]);
    } finally {
      await searched.close();
    }
  });

  it('rate-limits place searches before provider quota is consumed', async () => {
    const actions: string[] = [];
    let providerCalls = 0;
    const limited = startTestServer({
      rateLimitStore: {
        consume: async (_subjectKey, action) => {
          actions.push(action);
          return action === 'places'
            ? { allowed: false, retryAfterSeconds: 58 }
            : { allowed: true, retryAfterSeconds: 0 };
        },
      },
      placesProvider: async () => {
        providerCalls += 1;
        return [];
      },
    });
    await limited.ready;
    try {
      const response = await postJson(limited, 'places-rate-limited', '/places/search', { query: 'coffee', near: { lat: 51.5, lon: -0.1 } });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '58');
      assert.deepEqual(await response.json(), { error: 'rate_limited' });
      assert.deepEqual(actions, ['api', 'places']);
      assert.equal(providerCalls, 0);
    } finally {
      await limited.close();
    }
  });

  it('maps places provider failures to safe backend errors', async () => {
    for (const [code, status] of [
      ['places_not_configured', 503],
      ['places_rate_limited', 429],
      ['places_timeout', 504],
      ['places_unavailable', 502],
      ['places_invalid_response', 502],
    ] as const) {
      const failing = startTestServer({
        placesProvider: async () => { throw new PlacesProviderError(code); },
      });
      await failing.ready;
      try {
        const response = await postJson(failing, `places-${code}`, '/places/nearby', {
          includedTypes: ['parking'],
          near: { lat: 51.5, lon: -0.1 },
        });
        assert.equal(response.status, status, code);
        assert.deepEqual(await response.json(), { error: code });
      } finally {
        await failing.close();
      }
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
  it('limits how many rides one rider can start in a burst', needsDb, async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const made = await postJson(ctx, 'ride-spammer', '/rides', {});
      statuses.push(made.status);
      if (made.status === 201) {
        const { rideId } = await made.json() as { rideId: string };
        await authenticatedFetch(ctx, 'ride-spammer', `/rides/${rideId}`, { method: 'DELETE' });
      }
    }
    assert.deepEqual(statuses, [...Array(10).fill(201), 429]);
  });
  it('rejects a hideout invite list longer than a ride group', needsDb, async () => {
    const participantIds = Array.from({ length: 21 }, (_, i) => `friend-${i}`);
    const response = await postJson(ctx, 'hideout-planner', '/hideouts', { name: 'Too many', lat: 51.5, lon: -0.1, participantIds });
    assert.equal(response.status, 400);
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

  it('rejects an implausible presence jump with 422', needsDb, async () => {
    await ctx.profileStore.update('jumper', { shareLocation: true });
    const recordedAt = Date.now() - 10_000;
    assert.equal((await postJson(ctx, 'jumper', '/presence', { lat: 51.5, lon: -0.1, accuracyMeters: 8, recordedAt })).status, 200);
    // London to Manchester (~260 km) ten seconds later.
    const jump = await postJson(ctx, 'jumper', '/presence', { lat: 53.48, lon: -2.24, accuracyMeters: 8, recordedAt: recordedAt + 10_000 });
    assert.equal(jump.status, 422);
    assert.deepEqual(await jump.json(), { error: 'implausible_location_jump' });
  });

  it('rate-limits presence updates per rider', needsDb, async () => {
    await ctx.profileStore.update('presence-flood', { shareLocation: true });
    const recordedAt = Date.now() - 25_000;
    for (let i = 0; i < 20; i += 1) {
      const ok = await postJson(ctx, 'presence-flood', '/presence', { lat: 51.5, lon: -0.1, accuracyMeters: 8, recordedAt: recordedAt + i });
      assert.equal(ok.status, 200, `update ${i + 1} should be allowed`);
    }
    const limited = await postJson(ctx, 'presence-flood', '/presence', { lat: 51.5, lon: -0.1, accuracyMeters: 8, recordedAt: recordedAt + 20 });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
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
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
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

  it('answers HEAD probes on liveness and readiness', async () => {
    for (const path of ['/health', '/ready']) {
      const response = await fetch(`${ctx.baseUrl()}${path}`, { method: 'HEAD' });
      assert.equal(response.status, 200, `HEAD ${path}`);
      assert.equal(await response.text(), '');
    }
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
