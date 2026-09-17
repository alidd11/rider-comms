import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountDeletionStore } from '../src/accountDeletionStore.ts';

interface RecordedQuery { text: string; values?: unknown[] }

function fakeDependencies(failOn?: string) {
  const queries: RecordedQuery[] = [];
  let released = false;
  const client = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (failOn && text.includes(failOn)) throw new Error('injected delete failure');
      return { rows: [], rowCount: 0 };
    },
    release() { released = true; },
  };
  return {
    dependencies: {
      ensureMigrated: async () => undefined,
      getPool: () => ({ connect: async () => client }),
    },
    queries,
    wasReleased: () => released,
  };
}

describe('AccountDeletionStore', () => {
  it('deletes every rider-owned data class and commits once', async () => {
    const fake = fakeDependencies();
    const store = new AccountDeletionStore(fake.dependencies);

    await store.deleteRider('rider-delete');

    assert.equal(fake.queries[0].text, 'BEGIN');
    assert.equal(fake.queries.at(-1)?.text, 'COMMIT');
    assert.equal(fake.queries.some(({ text }) => text === 'ROLLBACK'), false);
    assert.deepEqual(
      fake.queries.filter(({ values }) => values).map(({ values }) => values),
      Array.from({ length: 15 }, () => ['rider-delete']),
    );
    for (const table of [
      'ride_members', 'rides', 'friendships', 'friend_requests',
      'direct_messages', 'hideout_participants', 'hideouts',
      'rider_presence', 'rider_profiles', 'rider_blocks', 'safety_reports',
      'hazard_report_votes', 'hazard_reports', 'scenic_routes', 'users',
    ]) {
      assert.equal(fake.queries.some(({ text }) => text.includes(`DELETE FROM ${table}`)), true, `missing ${table}`);
    }
    assert.equal(fake.wasReleased(), true);
  });

  it('rolls back and releases the connection when any delete fails', async () => {
    const fake = fakeDependencies('DELETE FROM direct_messages');
    const store = new AccountDeletionStore(fake.dependencies);

    await assert.rejects(store.deleteRider('rider-delete'), /injected delete failure/);

    assert.equal(fake.queries.some(({ text }) => text === 'COMMIT'), false);
    assert.equal(fake.queries.at(-1)?.text, 'ROLLBACK');
    assert.equal(fake.wasReleased(), true);
  });
});
