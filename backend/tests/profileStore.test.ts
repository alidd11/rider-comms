import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileStore } from '../src/profileStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

// ProfileStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('ProfileStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed ProfileStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
      await ensureMigrated();
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE rider_profiles');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('lazily creates a default profile on first read', async () => {
    const store = new ProfileStore();
    const profile = await store.getOrCreate('rider-1');
    assert.equal(profile.riderId, 'rider-1');
    assert.equal(profile.displayName, 'Rider');
    // Derived from the riderId itself (see profileStore's makeDefault) so
    // every new profile starts with a handle that's already unique, no
    // customization required before a friend could add them by it.
    assert.equal(profile.handle, '@rider-1');
    assert.equal(profile.avatarId, 'ember');
    assert.equal(profile.zoneTier, 'free');
    assert.equal(profile.unitSystem, 'mi');
    assert.equal(profile.notifyNearby, true);
    assert.equal(profile.notifyInvites, true);
    assert.equal(profile.notifyChat, true);
    assert.equal(profile.shareLocation, false);
    assert.ok(profile.updatedAt > 0);
  });

  it('returns the same profile on repeated reads', async () => {
    const store = new ProfileStore();
    await store.getOrCreate('rider-1');
    await store.update('rider-1', { displayName: 'Changed' });
    const second = await store.getOrCreate('rider-1');
    assert.equal(second.displayName, 'Changed');
  });

  it('merges a partial update and bumps updatedAt', async () => {
    const store = new ProfileStore();
    const original = await store.getOrCreate('rider-1');
    await new Promise((r) => setTimeout(r, 2));
    const result = await store.update('rider-1', { displayName: 'New Name' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.profile.displayName, 'New Name');
      assert.equal(result.profile.handle, '@rider-1'); // untouched fields kept
      assert.ok(result.profile.updatedAt > original.updatedAt);
    }
  });

  it('creates a default profile first if updating an unseen rider', async () => {
    const store = new ProfileStore();
    const result = await store.update('never-seen', { zoneTier: 'premium' });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.profile.zoneTier, 'premium');
      assert.equal(result.profile.displayName, 'Rider');
    }
  });

  it('rejects an invalid zoneTier without applying anything', async () => {
    const store = new ProfileStore();
    const result = await store.update('rider-1', { zoneTier: 'gold' as never });
    assert.equal(result.ok, false);
    const profile = await store.getOrCreate('rider-1');
    assert.equal(profile.zoneTier, 'free');
  });

  it('rejects an invalid unitSystem', async () => {
    const store = new ProfileStore();
    const result = await store.update('rider-1', { unitSystem: 'furlongs' as never });
    assert.equal(result.ok, false);
  });

  it('rejects a non-boolean notify field', async () => {
    const store = new ProfileStore();
    const result = await store.update('rider-1', { notifyChat: 'yes' as never });
    assert.equal(result.ok, false);
  });

  it('rejects an empty-string displayName/handle/avatarId', async () => {
    const store = new ProfileStore();
    assert.equal((await store.update('rider-1', { displayName: '' })).ok, false);
    assert.equal((await store.update('rider-1', { handle: '' })).ok, false);
    assert.equal((await store.update('rider-1', { avatarId: '' })).ok, false);
  });

  it('does not partially apply an update that fails validation', async () => {
    const store = new ProfileStore();
    const result = await store.update('rider-1', {
      displayName: 'Should Not Stick',
      zoneTier: 'invalid' as never,
    });
    assert.equal(result.ok, false);
    const profile = await store.getOrCreate('rider-1');
    assert.equal(profile.displayName, 'Rider');
  });

  it('rejects taking a handle another rider already has, case-insensitively', async () => {
    const store = new ProfileStore();
    await store.getOrCreate('rider-1');
    await store.getOrCreate('rider-2');
    await store.update('rider-2', { handle: '@taken_handle' });
    const result = await store.update('rider-1', { handle: '@Taken_Handle' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'handle_taken');
  });

  it('lets a rider keep their own handle unchanged on update', async () => {
    const store = new ProfileStore();
    await store.getOrCreate('rider-1');
    await store.update('rider-1', { handle: '@riderone' });
    const result = await store.update('rider-1', { handle: '@riderone', displayName: 'Same Handle' });
    assert.equal(result.ok, true);
  });

  it('finds a riderId by handle, case-insensitively, or undefined for no match', async () => {
    const store = new ProfileStore();
    await store.getOrCreate('rider-1');
    assert.equal(await store.findRiderIdByHandle('@Rider-1'), 'rider-1');
    assert.equal(await store.findRiderIdByHandle('@nobody'), undefined);
  });
});
