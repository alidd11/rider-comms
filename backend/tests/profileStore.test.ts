import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileStore } from '../src/profileStore.ts';

describe('ProfileStore', () => {
  it('lazily creates a default profile on first read', () => {
    const store = new ProfileStore();
    const profile = store.getOrCreate('rider-1');
    assert.equal(profile.riderId, 'rider-1');
    assert.equal(profile.displayName, 'Rider');
    assert.equal(profile.handle, '@rider');
    assert.equal(profile.avatarId, 'ember');
    assert.equal(profile.zoneTier, 'free');
    assert.equal(profile.unitSystem, 'mi');
    assert.equal(profile.notifyNearby, true);
    assert.equal(profile.notifyInvites, true);
    assert.equal(profile.notifyChat, true);
    assert.equal(profile.shareLocation, false);
    assert.ok(profile.updatedAt > 0);
  });

  it('returns the same profile on repeated reads', () => {
    const store = new ProfileStore();
    const first = store.getOrCreate('rider-1');
    first.displayName = 'Changed';
    const second = store.getOrCreate('rider-1');
    assert.equal(second.displayName, 'Changed');
  });

  it('merges a partial update and bumps updatedAt', async () => {
    const store = new ProfileStore();
    const original = store.getOrCreate('rider-1');
    await new Promise((r) => setTimeout(r, 2));
    const result = store.update('rider-1', { displayName: 'New Name' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.profile.displayName, 'New Name');
      assert.equal(result.profile.handle, '@rider'); // untouched fields kept
      assert.ok(result.profile.updatedAt > original.updatedAt);
    }
  });

  it('creates a default profile first if updating an unseen rider', () => {
    const store = new ProfileStore();
    const result = store.update('never-seen', { zoneTier: 'premium' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.profile.zoneTier, 'premium');
      assert.equal(result.profile.displayName, 'Rider');
    }
  });

  it('rejects an invalid zoneTier without applying anything', () => {
    const store = new ProfileStore();
    const result = store.update('rider-1', { zoneTier: 'gold' as never });
    assert.equal(result.ok, false);
    const profile = store.getOrCreate('rider-1');
    assert.equal(profile.zoneTier, 'free');
  });

  it('rejects an invalid unitSystem', () => {
    const store = new ProfileStore();
    const result = store.update('rider-1', { unitSystem: 'furlongs' as never });
    assert.equal(result.ok, false);
  });

  it('rejects a non-boolean notify field', () => {
    const store = new ProfileStore();
    const result = store.update('rider-1', { notifyChat: 'yes' as never });
    assert.equal(result.ok, false);
  });

  it('rejects an empty-string displayName/handle/avatarId', () => {
    const store = new ProfileStore();
    assert.equal(store.update('rider-1', { displayName: '' }).ok, false);
    assert.equal(store.update('rider-1', { handle: '' }).ok, false);
    assert.equal(store.update('rider-1', { avatarId: '' }).ok, false);
  });

  it('does not partially apply an update that fails validation', () => {
    const store = new ProfileStore();
    const result = store.update('rider-1', {
      displayName: 'Should Not Stick',
      zoneTier: 'invalid' as never,
    });
    assert.equal(result.ok, false);
    const profile = store.getOrCreate('rider-1');
    assert.equal(profile.displayName, 'Rider');
  });
});
