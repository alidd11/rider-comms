import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { createApp } from '../src/server.ts';
import { RideStore } from '../src/rideStore.ts';
import { PresenceStore } from '../src/presenceStore.ts';

interface TestServer {
  baseUrl: () => string;
  close: () => Promise<void>;
  server: http.Server;
  ready: Promise<void>;
}

/** Spins up a fresh server (fresh RideStore/PresenceStore) on an ephemeral
 * port so each describe block below is fully isolated — no shared rate
 * limiter or ride/presence state leaking between test cases. */
function startTestServer(): TestServer {
  const server = createApp(new RideStore(), new PresenceStore());
  let base = '';
  const ready = new Promise<void>((resolve) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      base = `http://localhost:${port}`;
      resolve();
    });
  });
  return {
    baseUrl: () => base,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    server,
    ready,
  };
}

describe('GET /health', () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer();
    await ctx.ready;
  });
  after(() => ctx.close());

  it('returns ok: true', async () => {
    const res = await fetch(`${ctx.baseUrl()}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

describe('POST /rides + /rides/join', () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer();
    await ctx.ready;
  });
  after(() => ctx.close());

  it('creates a ride and returns a 6-character code', async () => {
    const res = await fetch(`${ctx.baseUrl()}/rides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riderId: 'rider-a' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.rideId);
    assert.equal(body.code.length, 6);
    assert.ok(body.expiresAt > Date.now());
  });

  it('allows a second rider to join using the returned code', async () => {
    const createRes = await fetch(`${ctx.baseUrl()}/rides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riderId: 'rider-creator' }),
    });
    const { rideId, code } = await createRes.json();

    const joinRes = await fetch(`${ctx.baseUrl()}/rides/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, riderId: 'rider-joiner' }),
    });
    assert.equal(joinRes.status, 200);
    const joinBody = await joinRes.json();
    assert.equal(joinBody.rideId, rideId);
  });

  it('rejects an unknown code with 404, not a distinguishing error', async () => {
    const res = await fetch(`${ctx.baseUrl()}/rides/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZZZ', riderId: 'someone-guessing' }),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'invalid_or_expired');
  });

  it('rate-limits repeated join attempts from the same rider/IP pair (brute-force resistance, Section 13)', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 8; i++) {
      const res = await fetch(`${ctx.baseUrl()}/rides/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'WRONG1', riderId: 'brute-force-bot' }),
      });
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429);
  });

  it('does not rate-limit a different rider making the same number of attempts', async () => {
    // Uses a distinct riderId, so it must not have been affected by the
    // previous test's rate limiting despite hitting the same endpoint.
    const res = await fetch(`${ctx.baseUrl()}/rides/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'WRONG2', riderId: 'unrelated-rider' }),
    });
    assert.equal(res.status, 404); // invalid code, but NOT rate-limited (429)
  });
});

describe('POST /presence (zone matching end-to-end over real HTTP)', () => {
  let ctx: TestServer;
  before(async () => {
    ctx = startTestServer();
    await ctx.ready;
  });
  after(() => ctx.close());

  const postPresence = (baseUrl: string, riderId: string, lat: number, lon: number, radiusMiles: number) =>
    fetch(`${baseUrl}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riderId, lat, lon, radiusMiles }),
    }).then((r) => r.json());

  it('reports two nearby, mutually-in-range riders as in zone with each other', async () => {
    await postPresence(ctx.baseUrl(), 'near-1', 40.0, -105.0, 5);
    const secondUpdate = await postPresence(ctx.baseUrl(), 'near-2', 40.007, -105.0, 5); // ~0.5mi away

    assert.ok(secondUpdate.inZoneWith.includes('near-1'));
    assert.ok(
      secondUpdate.transitions.some((t: { type: string }) => t.type === 'entered')
    );
  });

  it('does NOT report two riders as in zone when one\'s radius is too small (mutual-radius rule)', async () => {
    await postPresence(ctx.baseUrl(), 'far-free', 41.0, -106.0, 1);
    const update = await postPresence(ctx.baseUrl(), 'far-premium', 41.03, -106.0, 20); // ~2mi away, exceeds the Free rider's 1mi radius

    assert.ok(!update.inZoneWith.includes('far-free'));
  });

  it('rejects a malformed presence update with 400', async () => {
    const res = await fetch(`${ctx.baseUrl()}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riderId: 'incomplete' }),
    });
    assert.equal(res.status, 400);
  });
});
