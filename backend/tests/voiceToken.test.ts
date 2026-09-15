import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, postJson } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

const FAKE_CREDS = { apiKey: 'fake-key', apiSecret: 'fake-secret-at-least-32-bytes-long!!', url: 'wss://example.livekit.cloud' };

describe('POST /voice/token', () => {
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

    it('mints a ride token only for an actual member of that ride', async () => {
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

    it("mints a channel token from the rider's own presence, and refuses without one", async () => {
      const noPresenceRes = await postJson(ctx, 'alice', '/voice/token', { target: 'channel' });
      assert.equal(noPresenceRes.status, 403);
      assert.deepEqual(await noPresenceRes.json(), { error: 'location_sharing_disabled' });

      ctx.profileStore.update('alice', { shareLocation: true });
      await postJson(ctx, 'alice', '/presence', { lat: 51.5, lon: -0.1 });
      const res = await postJson(ctx, 'alice', '/voice/token', { target: 'channel' });
      assert.equal(res.status, 200);
      const body = await res.json() as { token: string };
      assert.equal(body.token.split('.').length, 3);
    });

    it('rejects an unknown target', async () => {
      const res = await postJson(ctx, 'bob', '/voice/token', { target: 'bogus' });
      assert.equal(res.status, 400);
    });
  });
});
