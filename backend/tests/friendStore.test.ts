import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileStore } from '../src/profileStore.ts';
import { FriendStore } from '../src/friendStore.ts';

describe('FriendStore', () => {
  it('creates a pending friend request', () => {
    const store = new FriendStore(new ProfileStore());
    const result = store.createRequest('a', 'b');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.request.fromRiderId, 'a');
      assert.equal(result.request.toRiderId, 'b');
      assert.equal(result.request.status, 'pending');
      assert.ok(result.request.id);
    }
  });

  it('rejects a duplicate pending request in either direction', () => {
    const store = new FriendStore(new ProfileStore());
    store.createRequest('a', 'b');
    const dup1 = store.createRequest('a', 'b');
    const dup2 = store.createRequest('b', 'a');
    assert.equal(dup1.ok, false);
    if (!dup1.ok) assert.equal(dup1.error, 'request_exists');
    assert.equal(dup2.ok, false);
    if (!dup2.ok) assert.equal(dup2.error, 'request_exists');
  });

  it('rejects a request between already-friends riders', () => {
    const store = new FriendStore(new ProfileStore());
    const req = store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (req.ok) store.accept(req.request.id);
    const result = store.createRequest('a', 'b');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'already_friends');
  });

  it('splits incoming/outgoing requests correctly', () => {
    const store = new FriendStore(new ProfileStore());
    store.createRequest('a', 'b');
    store.createRequest('c', 'a');
    const { incoming, outgoing } = store.getRequestsFor('a');
    assert.equal(incoming.length, 1);
    assert.equal(incoming[0].fromRiderId, 'c');
    assert.equal(outgoing.length, 1);
    assert.equal(outgoing[0].toRiderId, 'b');
  });

  it('accept() creates a bidirectional friendship and returns the requester summary', () => {
    const profiles = new ProfileStore();
    profiles.update('a', { displayName: 'Alice', handle: '@alice', avatarId: 'fox' });
    const store = new FriendStore(profiles);
    const req = store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (!req.ok) return;
    const result = store.accept(req.request.id);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.friend, {
        riderId: 'a',
        displayName: 'Alice',
        handle: '@alice',
        avatarId: 'fox',
      });
    }
    assert.deepEqual(
      store.getFriends('b').map((f) => f.riderId),
      ['a']
    );
    assert.deepEqual(
      store.getFriends('a').map((f) => f.riderId),
      ['b']
    );
  });

  it('accept() 404s on an unknown or non-pending request', () => {
    const store = new FriendStore(new ProfileStore());
    const result = store.accept('nonexistent');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'not_found');
  });

  it('decline() marks the request declined and does not create a friendship', () => {
    const store = new FriendStore(new ProfileStore());
    const req = store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (!req.ok) return;
    const result = store.decline(req.request.id);
    assert.equal(result.ok, true);
    assert.equal(store.getFriends('a').length, 0);
    assert.equal(store.getFriends('b').length, 0);
  });

  it('friend summaries reflect live profile data, not a snapshot', () => {
    const profiles = new ProfileStore();
    const store = new FriendStore(profiles);
    const req = store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (!req.ok) return;
    store.accept(req.request.id);
    profiles.update('a', { displayName: 'Renamed' });
    const friends = store.getFriends('b');
    assert.equal(friends[0].displayName, 'Renamed');
  });

  it('removeFriend is idempotent and removes both directions', () => {
    const store = new FriendStore(new ProfileStore());
    const req = store.createRequest('a', 'b');
    assert.equal(req.ok, true);
    if (!req.ok) return;
    store.accept(req.request.id);
    store.removeFriend('a', 'b');
    assert.equal(store.getFriends('a').length, 0);
    assert.equal(store.getFriends('b').length, 0);
    // calling again on non-friends should not throw
    store.removeFriend('a', 'b');
  });
});
