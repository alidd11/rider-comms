import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileStore } from '../src/profileStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

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
    await getPool().query('TRUNCATE social_events, rider_blocks, friendships, rider_profiles RESTART IDENTITY');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('lazily creates a default profile on first read', async () => {
    const store = new ProfileStore();
    const profile = await store.getOrCreate('rider-1');
    assert.equal(profile.riderId, 'rider-1');
    assert.equal(profile.displayName, 'Rider');
    assert.equal(profile.handle, '@rider-1');
    assert.equal(profile.avatarId, 'ember');
    assert.equal(profile.zoneTier, 'free');
    assert.equal(profile.unitSystem, 'mi');
    assert.equal(profile.notifyNearby, false);
    assert.equal(profile.notifyInvites, false);
    assert.equal(profile.notifyChat, false);
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
      assert.equal(result.profile.handle, '@rider-1');
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

  it('preserves unrelated fields across concurrent partial updates', async () => {
    const store = new ProfileStore();
    await store.getOrCreate('rider-1');

    const [nameResult, socialResult] = await Promise.all([
      store.update('rider-1', { displayName: 'Parallel Rider' }),
      store.update('rider-1', { instagramUsername: 'parallel_rides' }),
    ]);
    assert.equal(nameResult.ok, true);
    assert.equal(socialResult.ok, true);

    const profile = await store.getOrCreate('rider-1');
    assert.equal(profile.displayName, 'Parallel Rider');
    assert.equal(profile.instagramUsername, 'parallel_rides');
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

  it('rejects an avatar id that neither client can render', async () => {
    const store = new ProfileStore();
    const result = await store.update('rider-1', { avatarId: 'not-a-real-preset' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /avatarId must be one of/);
    const profile = await store.getOrCreate('rider-1');
    assert.equal(profile.avatarId, 'ember');
  });

  it('accepts motorbike and car avatar presets', async () => {
    const store = new ProfileStore();
    const bike = await store.update('rider-1', { avatarId: 'bike_sport' });
    assert.equal(bike.ok, true);
    if (bike.ok) assert.equal(bike.profile.avatarId, 'bike_sport');

    const car = await store.update('rider-1', { avatarId: 'car_hatchback' });
    assert.equal(car.ok, true);
    if (car.ok) assert.equal(car.profile.avatarId, 'car_hatchback');
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

  it('emits a self-only refresh for private profile settings changes', async () => {
    const store = new ProfileStore();
    await store.getOrCreate('rider-1');
    await store.getOrCreate('friend-1');
    await getPool().query(
      `INSERT INTO friendships (rider_id, friend_id, created_at)
       VALUES ('rider-1', 'friend-1', 1), ('friend-1', 'rider-1', 1)`,
    );

    const result = await store.update('rider-1', { notifyChat: true });
    assert.equal(result.ok, true);

    const { rows } = await getPool().query<{ rider_id: string; event_type: string; actor_id: string; entity_id: string }>(
      `SELECT rider_id, event_type, actor_id, entity_id
       FROM social_events
       ORDER BY rider_id`,
    );
    assert.deepEqual(rows, [
      { rider_id: 'rider-1', event_type: 'social_refresh', actor_id: 'rider-1', entity_id: 'profile' },
    ]);
  });

  it('fans friend-facing profile refreshes only to current unblocked friends', async () => {
    const store = new ProfileStore();
    for (const riderId of ['rider-1', 'friend-1', 'blocked-1', 'former-1']) {
      await store.getOrCreate(riderId);
    }
    await getPool().query(
      `INSERT INTO friendships (rider_id, friend_id, created_at)
       VALUES
         ('rider-1', 'friend-1', 1), ('friend-1', 'rider-1', 1),
         ('rider-1', 'blocked-1', 1), ('blocked-1', 'rider-1', 1)`,
    );
    await getPool().query(
      `INSERT INTO rider_blocks (rider_id, blocked_rider_id, created_at)
       VALUES ('blocked-1', 'rider-1', 1)`,
    );

    const result = await store.update('rider-1', {
      displayName: 'Updated Rider',
      instagramVisibility: 'private',
    });
    assert.equal(result.ok, true);

    const { rows } = await getPool().query<{ rider_id: string; event_type: string; actor_id: string; entity_id: string }>(
      `SELECT rider_id, event_type, actor_id, entity_id
       FROM social_events
       WHERE actor_id = 'rider-1' AND entity_id = 'profile'
       ORDER BY rider_id`,
    );
    assert.deepEqual(rows, [
      { rider_id: 'friend-1', event_type: 'social_refresh', actor_id: 'rider-1', entity_id: 'profile' },
      { rider_id: 'rider-1', event_type: 'social_refresh', actor_id: 'rider-1', entity_id: 'profile' },
    ]);
  });

  it('does not emit a refresh when an update leaves the stored profile unchanged', async () => {
    const store = new ProfileStore();
    await store.getOrCreate('rider-1');

    const result = await store.update('rider-1', { displayName: 'Rider' });
    assert.equal(result.ok, true);

    const { rows } = await getPool().query(
      `SELECT 1
       FROM social_events
       WHERE actor_id = 'rider-1' AND entity_id = 'profile'`,
    );
    assert.equal(rows.length, 0);
  });
});
