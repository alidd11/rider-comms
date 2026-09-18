import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileStore } from '../src/profileStore.ts';
import { FriendStore } from '../src/friendStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

// FriendStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('FriendStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed FriendStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
      await ensureMigrated();
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    const pool = getPool();
    await pool.query('TRUNCATE social_events, friend_requests, friendships, rider_profiles RESTART IDENTITY');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('creates a pending friend request', async () => {
    const store = new FriendStore(new ProfileStore());
    const result = await store.createRequest('a', 'b');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.request.fromRiderId, 'a');
      assert.equal(result.request.toRiderId, 'b');
      assert.equal(result.request.status, 'pending');
      assert.ok(result.request.id);
    }
  });

  it('rejects a duplicate pending request in either direction', async () => {
    const store = new FriendStore(new ProfileStore());
    await store.createRequest('a', 'b');
    const dup1 = await store.createRequest('a', 'b');
    const dup2 = await store.createRequest('b', 'a');
    assert.equal(dup1.ok, false);
    if (!dup1.ok) assert.equal(dup1.error, 'request_exists');
    assert.equal(dup2.ok, false);
    if (!dup2.ok) assert.equal(dup2.error, 'request_exists');
  });

  it('creates only one pending request when opposite-direction requests race', async () => {
    const store = new FriendStore(new ProfileStore());
    const results = await Promise.all([
      store.createRequest('a', 'b'),
      store.createRequest('b', 'a'),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok && result.error === 'request_exists').length, 1);
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM friend_requests
       WHERE status = 'pending' AND ((from_rider_id = 'a' AND to_rider_id = 'b') OR (from_rider_id = 'b' AND to_rider_id = 'a'))`,
    );
    assert.equal(Number(rows[0]?.count), 1);
  });

  it('rejects a request between already-friends riders', async () => {
    const store = new FriendStore(new ProfileStore());
    const req = await store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (req.ok) await store.accept(req.request.id);
    const result = await store.createRequest('a', 'b');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'already_friends');
  });

  it('splits incoming/outgoing requests correctly', async () => {
    const store = new FriendStore(new ProfileStore());
    await store.createRequest('a', 'b');
    await store.createRequest('c', 'a');
    const { incoming, outgoing } = await store.getRequestsFor('a');
    assert.equal(incoming.length, 1);
    assert.equal(incoming[0].fromRiderId, 'c');
    assert.equal(outgoing.length, 1);
    assert.equal(outgoing[0].toRiderId, 'b');
  });

  it('accept() creates a bidirectional friendship and returns the requester summary', async () => {
    const profiles = new ProfileStore();
    await profiles.update('a', { displayName: 'Alice', handle: '@alice', avatarId: 'ridge' });
    const store = new FriendStore(profiles);
    const req = await store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (!req.ok) return;
    const result = await store.accept(req.request.id);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.friend, {
        riderId: 'a',
        displayName: 'Alice',
        handle: '@alice',
        avatarId: 'ridge',
      });
    }
    assert.deepEqual(
      (await store.getFriends('b')).map((f) => f.riderId),
      ['a']
    );
    assert.deepEqual(
      (await store.getFriends('a')).map((f) => f.riderId),
      ['b']
    );
  });

  it('accept() 404s on an unknown or non-pending request', async () => {
    const store = new FriendStore(new ProfileStore());
    const result = await store.accept('nonexistent');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'not_found');
  });

  it('decline() marks the request declined and does not create a friendship', async () => {
    const store = new FriendStore(new ProfileStore());
    const req = await store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (!req.ok) return;
    const result = await store.decline(req.request.id);
    assert.equal(result.ok, true);
    assert.equal((await store.getFriends('a')).length, 0);
    assert.equal((await store.getFriends('b')).length, 0);
  });

  it('friend summaries reflect live profile data, not a snapshot', async () => {
    const profiles = new ProfileStore();
    const store = new FriendStore(profiles);
    const req = await store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (!req.ok) return;
    await store.accept(req.request.id);
    await profiles.update('a', { displayName: 'Renamed' });
    const friends = await store.getFriends('b');
    assert.equal(friends[0].displayName, 'Renamed');
  });

  it('returns joined profile summaries in bounded cursor pages', async () => {
    const profiles = new ProfileStore();
    const store = new FriendStore(profiles);
    for (const [id, name] of [['a', 'Alice'], ['b', 'Bob'], ['c', 'Charlie']] as const) {
      const updated = await profiles.update(id, { displayName: name, handle: `@friend_${id}` });
      assert.equal(updated.ok, true);
      const request = await store.createRequest(id, 'me');
      assert.equal(request.ok, true);
      if (request.ok) await store.accept(request.request.id);
    }

    const first = await store.getFriendPage('me', 2);
    assert.equal(first.friends.length, 2);
    assert.ok(first.nextCursor);
    const second = await store.getFriendPage('me', 2, first.nextCursor ?? undefined);
    assert.equal(second.friends.length, 1);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(new Set([...first.friends, ...second.friends].map((friend) => friend.displayName)), new Set(['Alice', 'Bob', 'Charlie']));
  });

  it('joins request profile summaries without per-rider lookups', async () => {
    const profiles = new ProfileStore();
    await profiles.update('requester', { displayName: 'Requester', handle: '@requester' });
    const store = new FriendStore(profiles);
    await store.createRequest('requester', 'me');
    const page = await store.getRequestsFor('me', 10);
    assert.equal(page.incoming.length, 1);
    assert.deepEqual(page.profiles.requester, {
      riderId: 'requester', displayName: 'Requester', handle: '@requester', avatarId: 'ember',
    });
    assert.equal(page.nextCursor, null);
  });

  it('removeFriend is idempotent and removes both directions', async () => {
    const store = new FriendStore(new ProfileStore());
    const req = await store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (!req.ok) return;
    await store.accept(req.request.id);
    await store.removeFriend('a', 'b');
    assert.equal((await store.getFriends('a')).length, 0);
    assert.equal((await store.getFriends('b')).length, 0);
    // calling again on non-friends should not throw or emit another event
    await store.removeFriend('a', 'b');
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM social_events
       WHERE rider_id = 'b' AND event_type = 'friend_removed'`,
    );
    assert.equal(Number(rows[0]?.count), 1);
  });

  it('removeFriend also clears pending requests in either direction', async () => {
    const store = new FriendStore(new ProfileStore());
    const request = await store.createRequest('pending-a', 'pending-b');
    assert.equal(request.ok, true);

    await store.removeFriend('pending-b', 'pending-a');

    const pageA = await store.getRequestsFor('pending-a');
    const pageB = await store.getRequestsFor('pending-b');
    assert.deepEqual({ incoming: pageA.incoming, outgoing: pageA.outgoing }, { incoming: [], outgoing: [] });
    assert.deepEqual({ incoming: pageB.incoming, outgoing: pageB.outgoing }, { incoming: [], outgoing: [] });
  });
});
