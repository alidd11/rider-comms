import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PoolClient } from 'pg';
import { createLiveKitRoomAdmin } from '../src/liveKitToken.ts';
import { checkDatabaseReady, ensureMigrated, getPool, resetDbForTests, runMigrations } from '../src/db.ts';
import { MIGRATIONS } from '../src/migrations.ts';
import { DirectionsProviderError, fetchGoogleDrivingRoute } from '../src/directionsProvider.ts';
import { sendPasswordResetEmail, sendVerificationEmail } from '../src/email.ts';
import { validateProfileUpdate } from '../src/profileStore.ts';
import { SocialActivityStore } from '../src/socialActivityStore.ts';
import { SocialEventStore } from '../src/socialEventStore.ts';
import { AuthStore } from '../src/authStore.ts';

// How the backend behaves when something it depends on misbehaves: LiveKit,
// Google, Resend, a half-applied migration, a dropped LISTEN connection.

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ORIGIN = { lat: 51.5, lon: -0.12 };
const DESTINATION = { lat: 51.51, lon: -0.1 };

describe('LiveKit room admin', () => {
  let server: http.Server;
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let url = '';

  before(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        calls.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') as Record<string, unknown> });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('removes a rider from ride and pair rooms with a token revocation time', async () => {
    const admin = createLiveKitRoomAdmin({ url, apiKey: 'key', apiSecret: 'secret-secret-secret-secret-secret' });
    await admin.revokeRideParticipant('ride-1', 'rider-a', 1_700_000_000_500);
    await admin.revokeProximityParticipant('rider-a', 'rider-b', 'rider-b');

    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.path.endsWith('/livekit.RoomService/RemoveParticipant')));
    assert.equal(calls[0].body.identity, 'rider-a');
    assert.match(String(calls[0].body.room), /ride/);
    assert.equal(calls[1].body.identity, 'rider-b');
    assert.match(String(calls[1].body.room), /^proximity:/);
  });

  it('treats a rider who is not in the call as already hung up', async () => {
    const missing = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'not_found', msg: 'participant not found' }));
      });
    });
    await new Promise<void>((resolve) => missing.listen(0, '127.0.0.1', resolve));
    try {
      const admin = createLiveKitRoomAdmin({ url: `ws://127.0.0.1:${(missing.address() as AddressInfo).port}`, apiKey: 'key', apiSecret: 'secret-secret-secret-secret-secret' });
      await admin.revokeProximityParticipant('rider-a', 'rider-b', 'rider-a');
      await admin.revokeRideParticipant('ride-1', 'rider-a');
    } finally {
      await new Promise<void>((resolve) => missing.close(() => resolve()));
    }
  });

  it('still reports other LiveKit failures', async () => {
    const broken = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'internal', msg: 'boom' }));
      });
    });
    await new Promise<void>((resolve) => broken.listen(0, '127.0.0.1', resolve));
    try {
      const admin = createLiveKitRoomAdmin({ url: `ws://127.0.0.1:${(broken.address() as AddressInfo).port}`, apiKey: 'key', apiSecret: 'secret-secret-secret-secret-secret' });
      await assert.rejects(admin.revokeRideParticipant('ride-1', 'rider-a'));
    } finally {
      await new Promise<void>((resolve) => broken.close(() => resolve()));
    }
  });
});

describe('migrations', () => {
  function fakeClient(failOn?: string) {
    const statements: string[] = [];
    const client = {
      query: async (sql: string) => {
        statements.push(sql.trim());
        if (failOn && sql === failOn) throw new Error('migration failed');
        return { rows: [] };
      },
    } as unknown as PoolClient;
    return { client, statements };
  }

  it('applies every pending migration in its own transaction', async () => {
    const { client, statements } = fakeClient();
    await runMigrations(client);
    assert.equal(statements.filter((sql) => sql.startsWith('INSERT INTO schema_migrations')).length, MIGRATIONS.length);
    assert.equal(statements.filter((sql) => sql === 'COMMIT').length, MIGRATIONS.length);
    assert.ok(statements.at(-1)?.startsWith('SELECT pg_advisory_unlock'));
  });

  it('rolls back a failing migration and still releases the migration lock', async () => {
    const { client, statements } = fakeClient(MIGRATIONS[0].sql);
    await assert.rejects(runMigrations(client), /migration failed/);
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(statements.filter((sql) => sql.startsWith('INSERT INTO schema_migrations')).length, 0);
    assert.ok(statements.at(-1)?.startsWith('SELECT pg_advisory_unlock'));
  });

  it('reports ready once migrated and reachable', { skip: !hasDatabase && 'DATABASE_URL not set' }, async () => {
    await checkDatabaseReady();
  });
});

describe('Google directions failures', () => {
  const route = (fetchImpl: typeof fetch) => fetchGoogleDrivingRoute(ORIGIN, DESTINATION, { apiKey: 'key', fetchImpl });
  const failsWith = async (promise: Promise<unknown>, code: string) => {
    await assert.rejects(promise, (error: unknown) => error instanceof DirectionsProviderError && error.message === code);
  };

  it('rejects coordinates outside the world', async () => {
    await failsWith(fetchGoogleDrivingRoute({ lat: 91, lon: 0 }, DESTINATION, { apiKey: 'key' }), 'directions_invalid_request');
  });

  it('maps network errors, unreadable bodies and empty routes to provider errors', async () => {
    await failsWith(route(async () => { throw new TypeError('fetch failed'); }), 'directions_unavailable');
    await failsWith(route(async () => new Response('not json', { status: 200 })), 'directions_invalid_response');
    await failsWith(route(async () => Response.json({ status: 'OK', routes: [] })), 'directions_invalid_response');
  });
});

describe('email links and Resend errors', () => {
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL, url: process.env.PUBLIC_APP_URL };
  after(() => {
    for (const [name, value] of [['RESEND_API_KEY', saved.key], ['RESEND_FROM_EMAIL', saved.from], ['PUBLIC_APP_URL', saved.url]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  it('skips sending when the app URL is not HTTPS', async (t) => {
    const errors = mock.method(console, 'error', () => undefined);
    t.after(() => errors.mock.restore());
    process.env.RESEND_API_KEY = 're_test';
    process.env.PUBLIC_APP_URL = 'http://insecure.example';
    const fetchImpl = mock.fn(async () => Response.json({ id: 'x' }));
    assert.equal(await sendVerificationEmail('rider@example.com', 'token', { fetchImpl: fetchImpl as unknown as typeof fetch }), false);
    assert.equal(await sendPasswordResetEmail('rider@example.com', 'token', { fetchImpl: fetchImpl as unknown as typeof fetch }), false);
    assert.equal(fetchImpl.mock.callCount(), 0);
  });

  it('still reports a Resend refusal whose body is not JSON', async (t) => {
    const errors = mock.method(console, 'error', () => undefined);
    t.after(() => errors.mock.restore());
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM_EMAIL = 'Rider Comms <hello@example.com>';
    process.env.PUBLIC_APP_URL = 'https://app.example/';
    const fetchImpl = async () => new Response('<html>bad gateway</html>', { status: 502 });
    assert.equal(await sendVerificationEmail('rider@example.com', 'token', { fetchImpl }), false);
    assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes('Resend returned HTTP 502')));
  });
});

describe('profile validation', () => {
  it('limits display names and enforces the handle format', () => {
    assert.equal(validateProfileUpdate({ displayName: 'x'.repeat(51) }), 'displayName must be at most 50 characters');
    assert.equal(validateProfileUpdate({ handle: '@a' }), 'handle must start with @ and contain 3-24 letters, numbers, or underscores');
  });
});

describe('Postgres-backed failure modes', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  before(async () => { await ensureMigrated(); });
  after(async () => { await resetDbForTests(); });

  it('coalesces a second activity write that arrives while the first is in flight', async () => {
    const store = new SocialActivityStore();
    await Promise.all([store.touch('coalesce-rider', 500_000), store.touch('coalesce-rider', 500_000)]);
    const { rows } = await getPool().query('SELECT last_seen_at FROM rider_activity WHERE rider_id = $1', ['coalesce-rider']);
    assert.equal(Number(rows[0].last_seen_at), 500_000);
  });

  it('wakes every waiting long-poll when the LISTEN connection drops', async () => {
    const store = new SocialEventStore();
    const { cursor } = await store.waitForEvents('drop-rider', undefined);
    const waiting = store.waitForEvents('drop-rider', cursor, 10, 10_000);
    // Let the waiter register on the listener first.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const listener = (store as unknown as { listenerClient?: PoolClient }).listenerClient;
    assert.ok(listener, 'listener started');
    const startedAt = Date.now();
    listener.emit('error', new Error('connection reset'));
    const page = await waiting;
    assert.ok(Date.now() - startedAt < 5_000, 'woken by the drop, not the timeout');
    assert.deepEqual(page.events, []);
    await store.close();
  });

  it('returns events that land between the first read and the wait', async () => {
    const store = new SocialEventStore();
    const internals = store as unknown as { listAfter: (...args: unknown[]) => Promise<{ events: unknown[]; cursor: string; hasMore: boolean }> };
    const original = internals.listAfter.bind(store);
    const { cursor } = await store.waitForEvents('race-rider', undefined);
    let reads = 0;
    internals.listAfter = async (...args: unknown[]) => {
      reads += 1;
      const page = await original(...args);
      return reads === 2 ? { ...page, hasMore: true } : page;
    };
    const page = await store.waitForEvents('race-rider', cursor, 10, 10_000);
    assert.equal(page.hasMore, true);
    assert.equal(reads, 2);
    await store.close();
  });

  it('gives up cleanly when LISTEN itself fails', async (t) => {
    const store = new SocialEventStore();
    const { cursor } = await store.waitForEvents('listen-rider', undefined);
    const release = mock.fn();
    // pool.query() checks clients out with a callback: leave those alone and
    // fail only the listener's own checkout.
    const pool = getPool();
    const realConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
    const connect = t.mock.method(pool, 'connect', (...args: unknown[]) => (typeof args[0] === 'function'
      ? realConnect(...args)
      : Promise.resolve({ query: async () => { throw new Error('LISTEN refused'); }, release })));
    await assert.rejects(store.waitForEvents('listen-rider', cursor, 10, 1_000), /LISTEN refused/);
    connect.mock.restore();
    assert.equal(release.mock.callCount(), 1);
    await store.close();
  });

  it('refuses unknown password algorithms and malformed stored hashes', async () => {
    const auth = new AuthStore(async () => true, async () => true);
    await getPool().query(`DELETE FROM users WHERE username = 'hash_edge'`);
    const signUp = await auth.signUp('hash_edge', 'hash_edge@example.com', 'correct-horse-battery');
    assert.ok('riderId' in signUp);
    await getPool().query(`UPDATE users SET password_algorithm = 'mystery-v9' WHERE username = 'hash_edge'`);
    assert.deepEqual(await auth.logIn('hash_edge', 'correct-horse-battery'), { error: 'invalid_credentials' });
    // Non-hex characters of the right length decode to nothing; that must never match.
    await getPool().query(`UPDATE users SET password_algorithm = 'scrypt-v2', password_hash = $1 WHERE username = 'hash_edge'`, [`${'zz'.repeat(16)}:${'zz'.repeat(64)}`]);
    assert.deepEqual(await auth.logIn('hash_edge', 'anything-at-all'), { error: 'invalid_credentials' });
  });
});
