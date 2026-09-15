import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceStore } from '../src/presenceStore.ts';
import type { Rider } from '@rider-comms/shared';

function rider(id: string, lat: number, lon: number, radiusMiles: number, updatedAt: number): Rider {
  return { id, location: { lat, lon }, radiusMiles, updatedAt };
}

// Which of a pair is `a` vs `b` depends on which rider's update triggered
// the recompute, not on any meaningful order — diffZoneTransitions already
// sorts pair keys internally, so callers shouldn't (and here don't) care
// about it either.
function assertHasTransition(transitions: { a: string; b: string; type: string }[], x: string, y: string, type: string) {
  assert.ok(
    transitions.some((t) => t.type === type && ((t.a === x && t.b === y) || (t.a === y && t.b === x))),
    `expected a '${type}' transition between ${x} and ${y}, got ${JSON.stringify(transitions)}`
  );
}

describe('PresenceStore', () => {
  it('reports a mutual in-zone pair as entered, then left when they separate', () => {
    const store = new PresenceStore();
    store.updatePresence(rider('a', 51.5, -0.1, 5, 1000));
    const { transitions, zonePairs } = store.updatePresence(rider('b', 51.501, -0.1, 5, 1001));

    assert.equal(transitions.length, 1);
    assertHasTransition(transitions, 'a', 'b', 'entered');
    assert.deepEqual(store.ridersInZoneWith('a', zonePairs), ['b']);

    // Move b far outside both radii.
    const { transitions: left } = store.updatePresence(rider('b', 52.5, -0.1, 5, 1002));
    assert.equal(left.length, 1);
    assertHasTransition(left, 'a', 'b', 'left');
  });

  it("does not disturb an unrelated pair's zone state when a third rider updates", () => {
    const store = new PresenceStore();
    store.updatePresence(rider('a', 51.5, -0.1, 5, 1000));
    store.updatePresence(rider('b', 51.501, -0.1, 5, 1001));

    // Third rider, far away in a different geo-bucket, pings — should not
    // touch the already-established a/b pair or emit any transition for it.
    const { transitions } = store.updatePresence(rider('c', -10, 100, 5, 1002));
    assert.deepEqual(transitions, []);

    const zonePairs = store.updatePresence(rider('a', 51.5, -0.1, 5, 1003)).zonePairs;
    assert.ok(zonePairs.some((p) => (p.a === 'a' && p.b === 'b') || (p.a === 'b' && p.b === 'a')));
  });

  it('drops a pair when the other rider goes stale via someone else\'s ping', () => {
    const store = new PresenceStore(10); // stale after 10ms
    store.updatePresence(rider('a', 51.5, -0.1, 5, 1000));
    store.updatePresence(rider('b', 51.501, -0.1, 5, 1001));

    // 'a' hasn't updated in >10ms by the time 'b' pings again — 'a' should be
    // pruned as stale, and its pair with 'b' must be dropped with a 'left'
    // transition, even though 'a' isn't the rider making this call.
    const { transitions, zonePairs } = store.updatePresence(rider('b', 51.501, -0.1, 5, 1050));
    assert.equal(transitions.length, 1);
    assertHasTransition(transitions, 'a', 'b', 'left');
    assert.deepEqual(zonePairs, []);
  });

  it('zoneCandidates only returns riders in the same or a neighboring geo-bucket', () => {
    const store = new PresenceStore();
    store.updatePresence(rider('near', 51.501, -0.1, 5, 1000));
    store.updatePresence(rider('far', -10, 100, 5, 1001));

    const candidates = store.zoneCandidates(rider('me', 51.5, -0.1, 5, 1002)).map((r) => r.id);
    assert.deepEqual(candidates, ['near']);
  });
});
