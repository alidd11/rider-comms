import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, clearSharedTestState, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { resetDbForTests } from '../src/db.ts';

// Account, recovery and housekeeping endpoints plus the server's own failure
// handling: LiveKit revocation errors and a throwing request logger.

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('route edge cases', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  let ctx: TestServer;
  const logged: unknown[] = [];
  let failLogger = false;
  const previousRtdnToken = process.env.GOOGLE_RTDN_TOKEN;

  before(async () => {
    await clearSharedTestState();
    process.env.GOOGLE_RTDN_TOKEN = 'rtdn-edge';
    ctx = startTestServer({
      liveKitCredentials: null,
      liveKitRoomAdmin: {
        revokeRideParticipant: async () => { throw new Error('livekit unreachable'); },
        revokeProximityParticipant: async () => { throw 'livekit timeout'; },
      },
      billingStore: {
        status: async () => { throw new Error('unused'); },
        verifyPurchase: async () => { throw new Error('unused'); },
        refresh: async () => { throw new Error('store api down'); },
      },
      logger: (entry) => {
        if (failLogger) throw new Error('log sink full');
        logged.push(entry);
      },
    });
    await ctx.ready;
  });

  after(async () => {
    if (previousRtdnToken === undefined) delete process.env.GOOGLE_RTDN_TOKEN;
    else process.env.GOOGLE_RTDN_TOKEN = previousRtdnToken;
    await ctx.close();
    await resetDbForTests();
  });

  const post = (path: string, body: unknown) => fetch(`${ctx.baseUrl()}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  it('serves the public client config', async () => {
    const res = await fetch(`${ctx.baseUrl()}/config`);
    assert.equal(res.status, 200);
    assert.equal(typeof (await res.json() as { googleMapsApiKey: unknown }).googleMapsApiKey, 'string');
  });

  it('rejects unknown email-verification and password-reset tokens', async () => {
    const verify = await post('/auth/verify-email', { token: 'not-a-real-token' });
    assert.equal(verify.status, 400);
    assert.deepEqual(await verify.json(), { error: 'invalid_token' });

    const request = await post('/auth/password-reset/request', { email: 'nobody@example.com' });
    assert.equal(request.status, 202);
    assert.deepEqual(await request.json(), { accepted: true });

    const confirm = await post('/auth/password-reset/confirm', { token: 'not-a-real-token', password: 'new-password-123' });
    assert.equal(confirm.status, 400);
    assert.deepEqual(await confirm.json(), { error: 'invalid_token' });
  });

  it('lists sessions, refuses to revoke an unknown one and resends verification only for real accounts', async () => {
    const sessions = await authenticatedFetch(ctx, 'edge-rider', '/auth/sessions');
    assert.equal(sessions.status, 200);
    assert.ok(Array.isArray((await sessions.json() as { sessions: unknown[] }).sessions));

    const revoke = await authenticatedFetch(ctx, 'edge-rider', '/auth/sessions/missing-session', { method: 'DELETE' });
    assert.equal(revoke.status, 404);
    assert.deepEqual(await revoke.json(), { error: 'session_not_found' });

    const resend = await postJson(ctx, 'edge-rider', '/auth/resend-verification', {});
    assert.equal(resend.status, 404);
  });

  it('clears presence and refuses to delete a hideout that does not exist', async () => {
    const presence = await authenticatedFetch(ctx, 'edge-rider', '/presence', { method: 'DELETE' });
    assert.equal(presence.status, 200);
    const hideout = await authenticatedFetch(ctx, 'edge-rider', '/hideouts/missing-hideout', { method: 'DELETE' });
    assert.equal(hideout.status, 404);
  });

  it('asks Google to retry a notification when the store lookup fails, and ignores unknown stores', async (t) => {
    const errors = mock.method(console, 'error', () => undefined);
    t.after(() => errors.mock.restore());
    const data = Buffer.from(JSON.stringify({ subscriptionNotification: { purchaseToken: 'edge-token' } })).toString('base64');
    const res = await post('/billing/google/notifications?token=rtdn-edge', { message: { data } });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'retry' });
    assert.ok(errors.mock.calls.some((call) => String(call.arguments[0]).includes('billing_notification_failed')));

    // Not a store this server knows: it falls through to the authenticated routes.
    assert.equal((await post('/billing/other/notifications', {})).status, 401);
  });

  it('logs LiveKit revocation failures without failing the block', async (t) => {
    const errors = mock.method(console, 'error', () => undefined);
    t.after(() => errors.mock.restore());
    const ride = await (await postJson(ctx, 'edge-host', '/rides', {})).json() as { rideId: string; code: string };
    assert.equal((await postJson(ctx, 'edge-member', '/rides/join', { code: ride.code })).status, 200);

    assert.equal((await postJson(ctx, 'edge-host', '/blocks', { riderId: 'edge-member' })).status, 200);

    const events = errors.mock.calls.map((call) => JSON.parse(String(call.arguments[0])) as { event: string; message: string });
    assert.ok(events.some((entry) => entry.event === 'ride_voice_revocation_failed' && entry.message === 'livekit unreachable'));
    assert.ok(events.some((entry) => entry.event === 'proximity_voice_revocation_failed' && entry.message === 'livekit timeout'));
  });

  it('still answers when the request logger throws', async (t) => {
    const errors = mock.method(console, 'error', () => undefined);
    t.after(() => { errors.mock.restore(); failLogger = false; });
    failLogger = true;
    assert.equal((await fetch(`${ctx.baseUrl()}/config`)).status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(errors.mock.calls.some((call) => call.arguments[0] === 'request logger failed'));
  });
});
