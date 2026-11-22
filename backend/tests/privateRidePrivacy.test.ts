import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RideStore } from '../src/rideStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { authenticatedFetch, clearSharedTestState, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Real HTTP boundary tests using synthetic identities and isolated CI Postgres. */
describe('private ride HTTP authorization and location privacy', {
  skip: !hasDatabase && 'DATABASE_URL not set; requires isolated PostgreSQL',
}, () => {
  let ctx: TestServer;
  before(async () => {
    await ensureMigrated();
    await clearSharedTestState();
    ctx = startTestServer({ liveKitCredentials: null });
    await ctx.ready;
  });
  after(async () => {
    await ctx?.close();
    await resetDbForTests();
  });

  it('gates coordinates by membership, opt-in, blocks and immediate revocation', async () => {
    const host = 'security-ride-host';
    const member = 'security-ride-member';
    const outsider = 'security-ride-outsider';
    for (const rider of [host, member, outsider]) ctx.authStore.createTestSession(rider);

    const rideStore = new RideStore();
    const { ride, codeRecord } = await rideStore.createRide(host);
    const path = '/rides/' + encodeURIComponent(ride.id);
    assert.equal((await rideStore.joinRide(codeRecord.code, member)).ok, true);

    const locations = async (riderId: string) => {
      const res = await authenticatedFetch(ctx, riderId, path + '/locations');
      const body = await res.json() as { locations?: Array<{ riderId: string; lat: number; lon: number }> };
      return { status: res.status, body };
    };
    const listed = async (riderId: string) => (await locations(riderId)).body.locations ?? [];
    const publish = (riderId: string, lat: number, extra: object = {}) =>
      postJson(ctx, riderId, path + '/location', { lat, lon: -0.1, ...extra });
    const opt = (riderId: string, enabled: boolean) =>
      authenticatedFetch(ctx, riderId, path + '/location-sharing', {
        method: 'PUT', body: JSON.stringify({ enabled }),
      });

    assert.deepEqual(await listed(host), []);
    assert.equal((await publish(member, 51.5)).status, 403, 'sharing is off by default');
    assert.equal((await locations(outsider)).status, 403, 'nonmember cannot read locations');
    assert.equal((await publish(outsider, 51.6, { riderId: member })).status, 403,
      'forged riderId cannot publish into another member location');
    assert.equal((await opt(outsider, true)).status, 403);
    assert.deepEqual(await listed(host), []);

    assert.equal((await opt(member, true)).status, 200);
    assert.equal((await publish(member, 51.5)).status, 200);
    assert.deepEqual((await listed(host)).map((r) => r.riderId), [member]);

    assert.equal((await opt(host, true)).status, 200);
    assert.equal((await publish(host, 51.7, { riderId: member })).status, 200);
    const beforeBlock = await listed(member);
    assert.deepEqual(beforeBlock.map((r) => r.riderId).sort(), [host, member].sort());
    assert.equal(beforeBlock.find((r) => r.riderId === member)?.lat, 51.5,
      'member coordinates cannot be overwritten by another request body');
    assert.equal(beforeBlock.find((r) => r.riderId === host)?.lat, 51.7);

    assert.equal((await postJson(ctx, host, '/blocks', { riderId: member })).status, 200);
    assert.deepEqual((await listed(host)).map((r) => r.riderId), [host],
      'blocker cannot read blocked member coordinates');
    assert.deepEqual((await listed(member)).map((r) => r.riderId), [member],
      'blocked member cannot read blocker coordinates');
    const afterBlockUpload = await publish(member, 51.6);
    assert.equal(afterBlockUpload.status, 200);
    const postBody = await afterBlockUpload.json() as { locations: Array<{ riderId: string }> };
    assert.deepEqual(postBody.locations.map((r) => r.riderId), [member],
      'location POST response must enforce the same block filter');

    assert.equal((await authenticatedFetch(ctx, host, path + '/members/' + member, {
      method: 'DELETE',
    })).status, 200);
    assert.equal((await locations(member)).status, 403, 'removed rider loses location read access');
    assert.equal((await publish(member, 51.8)).status, 403, 'removed rider cannot publish');
    const deleted = await getPool().query(
      'SELECT 1 FROM ride_locations WHERE ride_id = $1 AND rider_id = $2', [ride.id, member],
    );
    assert.equal(deleted.rowCount, 0, 'removed member location must be purged');

    assert.equal((await opt(host, false)).status, 200);
    assert.deepEqual(await listed(host), [], 'withdrawing consent hides prior coordinates');
    assert.equal((await publish(host, 51.9)).status, 403);
    assert.equal((await authenticatedFetch(ctx, host, path, { method: 'DELETE' })).status, 200);
    assert.equal((await locations(host)).status, 404, 'ended ride cannot disclose coordinates');
  });
});
