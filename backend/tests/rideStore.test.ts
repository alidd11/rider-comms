import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RideStore } from '../src/rideStore.ts';

describe('RideStore', () => {
  it('caps a ride at 20 members and returns ride_full past the cap', () => {
    const store = new RideStore(1000, 60_000); // high join-attempt limit, this test is about the size cap
    const { ride, codeRecord } = store.createRide('host');

    for (let i = 0; i < 19; i++) {
      const result = store.joinRide(codeRecord.code, `rider_${i}`, `1.1.1.${i}`);
      assert.equal(result.ok, true, `rider_${i} should have joined`);
    }
    assert.equal(ride.memberIds.size, 20); // host + 19 joiners

    const overflow = store.joinRide(codeRecord.code, 'rider_20', '1.1.1.20');
    assert.deepEqual(overflow, { ok: false, reason: 'ride_full' });
    assert.equal(ride.memberIds.size, 20);
  });

  it('lets an existing member re-join a full ride without being rejected', () => {
    const store = new RideStore(1000, 60_000);
    const { ride, codeRecord } = store.createRide('host');
    for (let i = 0; i < 19; i++) store.joinRide(codeRecord.code, `rider_${i}`, `1.1.1.${i}`);
    assert.equal(ride.memberIds.size, 20);

    const rejoin = store.joinRide(codeRecord.code, 'rider_0', '1.1.1.0');
    assert.equal(rejoin.ok, true);
  });
});
