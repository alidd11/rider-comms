import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BillingStore } from '../src/billingStore.ts';
import { FriendStore, InvalidFriendCursorError } from '../src/friendStore.ts';
import { ProfileStore } from '../src/profileStore.ts';
import { RideStore } from '../src/rideStore.ts';
import type { StoreSubscriptionState } from '../src/storeBilling.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { injectTransactionFault } from './dbFaults.ts';

// Outcomes that depend on a concurrent writer winning between a store's
// check and its write, plus a few direct edge cases. The races are staged
// by substituting the result of the contested statement.

const hasDatabase = Boolean(process.env.DATABASE_URL);

function subscription(originalId: string, expiresAt: number): StoreSubscriptionState {
  return {
    platform: 'apple', originalId, productId: 'premium.monthly', tier: 'premium', expiresAt,
    active: true, willRenew: true, accountToken: null, environment: 'sandbox',
  };
}

describe('store race outcomes', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  const profileStore = new ProfileStore();
  const friendStore = new FriendStore(profileStore);
  const rideStore = new RideStore();

  before(async () => {
    await ensureMigrated();
    await getPool().query('DELETE FROM friend_requests; DELETE FROM friendships; DELETE FROM store_subscriptions');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('reports request_exists when another request is inserted first', async () => {
    const fault = injectTransactionFault({ when: (sql) => sql.startsWith('INSERT INTO friend_requests'), result: { rowCount: 0 } });
    try {
      assert.deepEqual(await friendStore.createRequest('race-a', 'race-b'), { ok: false, error: 'request_exists' });
    } finally {
      fault.disarm();
    }
    assert.ok(fault.statements.includes('ROLLBACK'));
  });

  it('reports not_found when a request is resolved elsewhere mid-accept', async () => {
    const created = await friendStore.createRequest('race-c', 'race-d');
    assert.ok(created.ok);
    const fault = injectTransactionFault({ when: (sql) => sql.startsWith('UPDATE friend_requests'), result: { rows: [] } });
    try {
      assert.deepEqual(await friendStore.accept(created.request.id), { ok: false, error: 'not_found' });
    } finally {
      fault.disarm();
    }
    assert.deepEqual(await friendStore.decline('missing-request'), { ok: false, error: 'not_found' });
  });

  it('rejects a malformed friend-list cursor', async () => {
    await assert.rejects(friendStore.getFriendPage('race-a', 10, 'not-a-cursor'), InvalidFriendCursorError);
  });

  it('retries ride code generation when a code is already taken', async () => {
    const fault = injectTransactionFault({ when: (sql) => sql.startsWith('INSERT INTO ride_codes'), result: { rowCount: 0 } });
    let created;
    try {
      created = await rideStore.createRide('race-host');
    } finally {
      fault.disarm();
    }
    assert.equal(fault.statements.filter((sql) => sql.startsWith('INSERT INTO ride_codes')).length, 2);
    assert.deepEqual(await rideStore.joinRide(created.codeRecord.code, 'race-member'), { ok: true, rideId: created.ride.id });
  });

  it('rejects an unknown ride code', async () => {
    assert.deepEqual(await rideStore.joinRide('ZZZZZZ', 'race-member'), { ok: false, reason: 'invalid_or_expired' });
  });

  it('reports not_member when the rider leaves mid-update', async () => {
    const { ride } = await rideStore.createRide('race-sharer');
    const fault = injectTransactionFault({ when: (sql) => sql.startsWith('UPDATE ride_members'), result: { rowCount: 0 } });
    try {
      assert.deepEqual(await rideStore.setMemberLocationSharing(ride.id, 'race-sharer', false), { ok: false, reason: 'not_member' });
    } finally {
      fault.disarm();
    }
  });

  it('ignores a store update for a subscription no account has claimed', async () => {
    const billing = new BillingStore({}, profileStore);
    await billing.record(subscription('unclaimed-sub', Date.now() + 86_400_000));
    const { rows } = await getPool().query(`SELECT 1 FROM store_subscriptions WHERE original_id = 'unclaimed-sub'`);
    assert.equal(rows.length, 0);
  });

  it('reports the latest expiry across subscriptions of the same tier', async () => {
    const billing = new BillingStore({}, profileStore);
    const later = Date.now() + 30 * 86_400_000;
    await billing.record(subscription('same-tier-later', later), 'race-subscriber');
    await billing.record(subscription('same-tier-sooner', Date.now() + 86_400_000), 'race-subscriber');
    const status = await billing.status('race-subscriber');
    assert.equal(status.tier, 'premium');
    assert.equal(status.expiresAt, later);
  });
});
