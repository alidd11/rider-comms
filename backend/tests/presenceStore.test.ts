import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceStore } from '../src/presenceStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import type { Rider } from '@rider-comms/shared';

// PresenceStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

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

describe('PresenceStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed PresenceStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
      await ensureMigrated();
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE presence_zone_pairs, rider_presence');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('reports a mutual in-zone pair as entered, then left when they separate', async () => {
    const store = new PresenceStore();
    await store.updatePresence(rider('a', 51.5, -0.1, 5, 1000));
    const { transitions, zonePairs } = await store.updatePresence(rider('b', 51.501, -0.1, 5, 1001));

    assert.equal(transitions.length, 1);
    assertHasTransition(transitions, 'a', 'b', 'entered');
    assert.deepEqual(store.ridersInZoneWith('a', zonePairs), ['b']);

    // Move b far outside both radii.
    const { transitions: left } = await store.updatePresence(rider('b', 52.5, -0.1, 5, 1002));
    assert.equal(left.length, 1);
    assertHasTransition(left, 'a', 'b', 'left');
  });

  it("does not disturb an unrelated pair's zone state when a third rider updates", async () => {
    const store = new PresenceStore();
    await store.updatePresence(rider('a', 51.5, -0.1, 5, 1000));
    await store.updatePresence(rider('b', 51.501, -0.1, 5, 1001));

    // Third rider, far away in a different geo-bucket, pings — should not
    // touch the already-established a/b pair or emit any transition for it.
    const { transitions } = await store.updatePresence(rider('c', -10, 100, 5, 1002));
    assert.deepEqual(transitions, []);

    const zonePairs = (await store.updatePresence(rider('a', 51.5, -0.1, 5, 1003))).zonePairs;
    assert.ok(zonePairs.some((p) => (p.a === 'a' && p.b === 'b') || (p.a === 'b' && p.b === 'a')));
  });

  it('drops a pair when the other rider goes stale via someone else\'s ping', async () => {
    const store = new PresenceStore(10); // stale after 10ms
    await store.updatePresence(rider('a', 51.5, -0.1, 5, 1000));
    await store.updatePresence(rider('b', 51.501, -0.1, 5, 1001));

    // 'a' hasn't updated in >10ms by the time 'b' pings again — 'a' should be
    // pruned as stale, and its pair with 'b' must be dropped with a 'left'
    // transition, even though 'a' isn't the rider making this call.
    const { transitions, zonePairs } = await store.updatePresence(rider('b', 51.501, -0.1, 5, 1050));
    assert.equal(transitions.length, 1);
    assertHasTransition(transitions, 'a', 'b', 'left');
    assert.deepEqual(zonePairs, []);
  });

  it('zoneCandidates returns only fresh riders in the indexed geographic window', async () => {
    const store = new PresenceStore();
    await store.updatePresence(rider('near', 51.501, -0.1, 5, 1000));
    await store.updatePresence(rider('far', -10, 100, 5, 1001));

    const candidates = (await store.zoneCandidates(rider('me', 51.5, -0.1, 5, 1002))).map((r) => r.id);
    assert.deepEqual(candidates, ['near']);
  });

  it('persists pair state across store instances without emitting duplicate enters', async () => {
    const first = new PresenceStore();
    await first.updatePresence(rider('a', 51.5, -0.1, 5, 1000));
    const entered = await first.updatePresence(rider('b', 51.501, -0.1, 5, 1001));
    assertHasTransition(entered.transitions, 'a', 'b', 'entered');

    const afterRestart = new PresenceStore();
    const repeated = await afterRestart.updatePresence(rider('a', 51.5, -0.1, 5, 1002));
    assert.deepEqual(repeated.transitions, []);
    assert.deepEqual(afterRestart.ridersInZoneWith('a', repeated.zonePairs), ['b']);
  });

  it('rejects an out-of-order fix instead of moving a rider backwards', async () => {
    const store = new PresenceStore();
    await store.updatePresence(rider('a', 51.5, -0.1, 5, 2000));
    await assert.rejects(() => store.updatePresence(rider('a', 52, -0.1, 5, 1999)), /older than/);
    assert.equal((await store.getRider('a'))?.location.lat, 51.5);
  });
});
