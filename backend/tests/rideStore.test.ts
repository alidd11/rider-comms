import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RideStore } from '../src/rideStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

// RideStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('RideStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed RideStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
      await ensureMigrated();
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE rides, ride_members, ride_codes, ride_locations');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('caps a ride at 20 members and returns ride_full past the cap', async () => {
    const store = new RideStore(1000, 60_000); // high join-attempt limit, this test is about the size cap
    const { ride, codeRecord } = await store.createRide('host');

    for (let i = 0; i < 19; i++) {
      const result = await store.joinRide(codeRecord.code, `rider_${i}`, `1.1.1.${i}`);
      assert.equal(result.ok, true, `rider_${i} should have joined`);
    }
    const afterJoins = await store.getRide(ride.id);
    assert.equal(afterJoins?.memberIds.size, 20); // host + 19 joiners

    const overflow = await store.joinRide(codeRecord.code, 'rider_20', '1.1.1.20');
    assert.deepEqual(overflow, { ok: false, reason: 'ride_full' });
    const stillCapped = await store.getRide(ride.id);
    assert.equal(stillCapped?.memberIds.size, 20);
  });

  it('never exceeds the member cap when join requests race', async () => {
    const store = new RideStore(1000, 60_000);
    const { ride, codeRecord } = await store.createRide('host');
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) => store.joinRide(codeRecord.code, `racer_${index}`, `2.2.2.${index}`)),
    );
    assert.equal(results.filter((result) => result.ok).length, 19);
    assert.equal(results.filter((result) => !result.ok && result.reason === 'ride_full').length, 11);
    assert.equal((await store.getRide(ride.id))?.memberIds.size, 20);
  });

  it('lets an existing member re-join a full ride without being rejected', async () => {
    const store = new RideStore(1000, 60_000);
    const { ride, codeRecord } = await store.createRide('host');
    for (let i = 0; i < 19; i++) await store.joinRide(codeRecord.code, `rider_${i}`, `1.1.1.${i}`);
    const afterJoins = await store.getRide(ride.id);
    assert.equal(afterJoins?.memberIds.size, 20);

    const rejoin = await store.joinRide(codeRecord.code, 'rider_0', '1.1.1.0');
    assert.equal(rejoin.ok, true);
  });

  it('requires explicit per-ride consent before sharing a member location', async () => {
    const store = new RideStore();
    const { ride, codeRecord } = await store.createRide('host');
    await store.joinRide(codeRecord.code, 'guest', '1.1.1.1');

    const denied = await store.updateMemberLocation(ride.id, 'guest', 51.5, -0.1);
    assert.deepEqual(denied, { ok: false, reason: 'location_sharing_disabled' });
    assert.equal((await store.setMemberLocationSharing(ride.id, 'guest', true)).ok, true);
    const update = await store.updateMemberLocation(ride.id, 'guest', 51.5, -0.1);
    assert.equal(update.ok, true);

    const read = await store.getMemberLocations(ride.id, 'host');
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.deepEqual(
        read.locations.map((l) => ({ riderId: l.riderId, lat: l.lat, lon: l.lon })),
        [{ riderId: 'guest', lat: 51.5, lon: -0.1 }]
      );
    }
  });

  it('purges location when consent is withdrawn or membership ends', async () => {
    const store = new RideStore();
    const { ride, codeRecord } = await store.createRide('host');
    await store.joinRide(codeRecord.code, 'guest', '1.1.1.1');
    await store.setMemberLocationSharing(ride.id, 'guest', true);
    await store.updateMemberLocation(ride.id, 'guest', 51.5, -0.1);

    await store.setMemberLocationSharing(ride.id, 'guest', false);
    const afterWithdrawal = await store.getMemberLocations(ride.id, 'host');
    assert.equal(afterWithdrawal.ok, true);
    if (afterWithdrawal.ok) assert.deepEqual(afterWithdrawal.locations, []);

    await store.setMemberLocationSharing(ride.id, 'guest', true);
    await store.updateMemberLocation(ride.id, 'guest', 51.5, -0.1);
    await store.leaveRide(ride.id, 'guest');
    const count = await getPool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM ride_locations WHERE ride_id = $1 AND rider_id = $2',
      [ride.id, 'guest']
    );
    assert.equal(count.rows[0]?.count, '0');
  });

  it('does not return or retain stale ride locations', async () => {
    const store = new RideStore();
    const { ride, codeRecord } = await store.createRide('host');
    await store.joinRide(codeRecord.code, 'guest', '1.1.1.1');
    await store.setMemberLocationSharing(ride.id, 'guest', true);
    await store.updateMemberLocation(ride.id, 'guest', 51.5, -0.1);
    await getPool().query(
      'UPDATE ride_locations SET updated_at = $3 WHERE ride_id = $1 AND rider_id = $2',
      [ride.id, 'guest', Date.now() - 60_000]
    );

    const read = await store.getMemberLocations(ride.id, 'host');
    assert.equal(read.ok, true);
    if (read.ok) assert.deepEqual(read.locations, []);
    const count = await getPool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM ride_locations WHERE ride_id = $1 AND rider_id = $2',
      [ride.id, 'guest']
    );
    assert.equal(count.rows[0]?.count, '0');
  });

  it('rejects updating or reading ride locations for a non-member', async () => {
    const store = new RideStore();
    const { ride } = await store.createRide('host');

    const update = await store.updateMemberLocation(ride.id, 'stranger', 51.5, -0.1);
    assert.deepEqual(update, { ok: false, reason: 'not_member' });

    const read = await store.getMemberLocations(ride.id, 'stranger');
    assert.deepEqual(read, { ok: false, reason: 'not_member' });
  });
});
