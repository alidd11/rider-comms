import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, postJson } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { getPool } from '../src/db.ts';

const FAKE_CREDS = { apiKey: 'fake-key', apiSecret: 'fake-secret-at-least-32-bytes-long!!', url: 'wss://example.livekit.cloud' };

// rideStore and presenceStore/profileStore are Postgres-backed (see db.ts)
// — every test below that creates a ride or touches presence needs
// DATABASE_URL pointing at a reachable Postgres instance and is skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);
const needsDb = { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed test' };

describe('POST /voice/token', () => {
  beforeEach(async () => {
    if (hasDatabase) await getPool().query('TRUNCATE presence_zone_pairs, rider_presence');
  });

  it('returns 503 when LiveKit credentials are not configured', async () => {
    const ctx = startTestServer({ liveKitCredentials: null });
    await ctx.ready;
    const res = await postJson(ctx, 'alice', '/voice/token', { target: 'ride', rideId: 'whatever' });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'voice_not_configured' });
    await ctx.close();
  });

  describe('with LiveKit configured', () => {
    let ctx: TestServer;
    before(async () => { ctx = startTestServer({ liveKitCredentials: FAKE_CREDS }); await ctx.ready; });
    after(() => ctx.close());

    it('mints a ride token only for an actual member of that ride', needsDb, async () => {
      const created = await (await postJson(ctx, 'host', '/rides', {})).json() as { rideId: string };

      const memberRes = await postJson(ctx, 'host', '/voice/token', { target: 'ride', rideId: created.rideId });
      assert.equal(memberRes.status, 200);
      const memberBody = await memberRes.json() as { token: string; url: string };
      assert.equal(memberBody.url, FAKE_CREDS.url);
      assert.equal(memberBody.token.split('.').length, 3);

      const strangerRes = await postJson(ctx, 'stranger', '/voice/token', { target: 'ride', rideId: created.rideId });
      assert.equal(strangerRes.status, 403);

      const missingRes = await postJson(ctx, 'host', '/voice/token', { target: 'ride', rideId: 'no-such-ride' });
      assert.equal(missingRes.status, 404);
    });

    it('returns no public voice rooms when the rider has no current proximity pairs', needsDb, async () => {
      const res = await postJson(ctx, 'alice', '/voice/token', { target: 'channel' });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { connections: [], refreshAfterMs: 20_000 });
    });

    it('mints one pair-isolated public room for each current unblocked peer', needsDb, async () => {
      await ctx.profileStore.update('alice', { shareLocation: true });
      await ctx.profileStore.update('bob', { shareLocation: true });
      const now = Date.now();
      assert.equal((await postJson(ctx, 'alice', '/presence', { lat: 51.5, lon: -0.1, accuracyMeters: 5, recordedAt: now })).status, 200);
      assert.equal((await postJson(ctx, 'bob', '/presence', { lat: 51.5001, lon: -0.1, accuracyMeters: 5, recordedAt: now + 1 })).status, 200);

      const res = await postJson(ctx, 'alice', '/voice/token', { target: 'channel' });
      assert.equal(res.status, 200);
      const body = await res.json() as { connections: Array<{ peerId: string; token: string; url: string }> };
      assert.equal(body.connections.length, 1);
      assert.equal(body.connections[0].peerId, 'bob');
      assert.equal(body.connections[0].url, FAKE_CREDS.url);
      const payload = JSON.parse(Buffer.from(body.connections[0].token.split('.')[1], 'base64url').toString('utf8'));
      assert.match(payload.video.room, /^proximity:[a-f0-9]{32}$/);
      assert.equal(payload.video.canSubscribe, true);
      assert.equal(payload.video.canPublish, true);
      assert.deepEqual(payload.video.canPublishSources, ['microphone']);
      assert.equal(payload.video.canPublishData, false);

      assert.equal((await postJson(ctx, 'alice', '/blocks', { riderId: 'bob' })).status, 200);
      const blocked = await postJson(ctx, 'alice', '/voice/token', { target: 'channel' });
      assert.deepEqual(await blocked.json(), { connections: [], refreshAfterMs: 20_000 });
    });

    it('rejects an unknown target', async () => {
      const res = await postJson(ctx, 'bob', '/voice/token', { target: 'bogus' });
      assert.equal(res.status, 400);
    });
  });
});
