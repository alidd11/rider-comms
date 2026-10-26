import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthStore } from '../src/authStore.ts';
import { FriendStore } from '../src/friendStore.ts';
import { HazardStore } from '../src/hazardStore.ts';
import { MessageStore } from '../src/messageStore.ts';
import { ModerationStore } from '../src/moderationStore.ts';
import { ProfileStore } from '../src/profileStore.ts';
import { RateLimitStore } from '../src/rateLimitStore.ts';
import { RetentionStore } from '../src/retentionStore.ts';
import { RideStore } from '../src/rideStore.ts';
import { SocialRateLimitStore } from '../src/socialRateLimitStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { injectTransactionFault } from './dbFaults.ts';

// Every multi-statement write runs in a transaction. When any statement in it
// fails, the store must roll back (leaving no partial write) and rethrow, and
// the pooled connection must stay usable for the next caller.

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('transaction rollback on failure', { skip: !hasDatabase && 'DATABASE_URL not set' }, () => {
  const authStore = new AuthStore(async () => true, async () => true);
  const profileStore = new ProfileStore();
  const friendStore = new FriendStore(profileStore);
  const hazardStore = new HazardStore();
  const messageStore = new MessageStore();
  const moderationStore = new ModerationStore();
  const rideStore = new RideStore();
  let hazardId = '';
  let rideId = '';

  before(async () => {
    await ensureMigrated();
    await getPool().query(`DELETE FROM users WHERE username = 'rollback_rider'`);
    const signUp = await authStore.signUp('rollback_rider', 'rollback@example.com', 'correct-horse-battery');
    assert.ok('riderId' in signUp);
    hazardId = (await hazardStore.create('police', 51.5, -0.1, 'rb-reporter')).id;
    rideId = (await rideStore.createRide('rb-host')).ride.id;
  });

  after(async () => {
    await resetDbForTests();
  });

  const operations: Array<[string, () => Promise<unknown>]> = [
    ['AuthStore.requestPasswordReset', () => authStore.requestPasswordReset('rollback@example.com')],
    ['AuthStore.resetPassword', () => authStore.resetPassword('some-token', 'new-password-123')],
    ['AuthStore.cleanupExpiredRecords', () => authStore.cleanupExpiredRecords()],
    ['FriendStore.createRequest', () => friendStore.createRequest('rb-a', 'rb-b')],
    ['FriendStore.accept', () => friendStore.accept('missing-request')],
    ['FriendStore.decline', () => friendStore.decline('missing-request')],
    ['FriendStore.cancelRequest', () => friendStore.cancelRequest('missing-request', 'rb-a')],
    ['FriendStore.removeFriend', () => friendStore.removeFriend('rb-a', 'rb-b')],
    ['HazardStore.confirm', () => hazardStore.confirm(hazardId, 'rb-voter')],
    ['MessageStore.create', () => messageStore.create('rb-a', 'rb-b', 'hello')],
    ['MessageStore.markThreadRead', () => messageStore.markThreadRead('rb-a', 'rb-b')],
    ['ModerationStore.block', () => moderationStore.block('rb-a', 'rb-b')],
    ['ModerationStore.unblock', () => moderationStore.unblock('rb-a', 'rb-b')],
    ['ModerationStore.resolveReport', () => moderationStore.resolveReport('missing-report', 'rb-mod', 'dismiss', 'note')],
    ['ModerationStore.unsuspend', () => moderationStore.unsuspend('rb-a', 'rb-mod', 'note')],
    ['ModerationStore.verifyEmail', () => moderationStore.verifyEmail('rb-a', 'rb-mod', 'note')],
    ['ProfileStore.update', () => profileStore.update('rb-a', { displayName: 'Rollback' })],
    ['RateLimitStore.consume', () => new RateLimitStore().consume('rb-subject', 'auth')],
    ['RetentionStore.sweep', () => new RetentionStore().sweep()],
    ['RideStore.createRide', () => rideStore.createRide('rb-creator')],
    ['RideStore.joinRide', () => rideStore.joinRide('ABCDEF', 'rb-joiner')],
    ['RideStore.setMemberLocationSharing', () => rideStore.setMemberLocationSharing(rideId, 'rb-host', false)],
    ['SocialRateLimitStore.consume', () => new SocialRateLimitStore().consume('rb-a', 'friend_request')],
  ];

  for (const [name, run] of operations) {
    it(`${name} rolls back and rethrows`, async () => {
      const fault = injectTransactionFault({});
      try {
        await assert.rejects(run(), /injected database failure/);
      } finally {
        fault.disarm();
      }
      assert.ok(fault.statements.some((sql) => sql.startsWith('BEGIN')), `${name} did not open a transaction`);
      assert.ok(fault.statements.includes('ROLLBACK'), `${name} did not roll back`);
      // The connection went back to the pool in a clean state.
      assert.equal((await getPool().query('SELECT 1 AS ok')).rows[0].ok, 1);
    });
  }
});
