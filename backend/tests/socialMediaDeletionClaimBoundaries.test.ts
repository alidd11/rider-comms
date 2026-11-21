import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { claimSocialMediaDeletes, processSocialMediaDeletes } from '../src/socialMediaDeletionOutbox.ts';

const row = {
  id: '123e4567-e89b-42d3-a456-426614174001',
  object_key: 'social/processed/123e4567-e89b-42d3-a456-426614174000.jpg',
  attempts: 1,
  lease_token: '123e4567-e89b-42d3-a456-426614174002',
};

describe('Social deletion lease-claim boundaries', () => {
  it('claims only eligible pending jobs, in a bounded SKIP LOCKED transaction', async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const jobs = await claimSocialMediaDeletes({
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: [row] };
      },
    }, 25);
    assert.deepEqual(jobs, [{
      id: row.id, objectKey: row.object_key, attempts: 1, leaseToken: row.lease_token,
    }]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].values, [25]);
    assert.match(calls[0].sql, /completed_at IS NULL AND next_attempt_at <= now\(\)/);
    assert.match(calls[0].sql, /lease_until IS NULL OR lease_until < now\(\)/);
    assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED LIMIT \$1/);
    assert.match(calls[0].sql, /lease_token = gen_random_uuid\(\)/);
    assert.match(calls[0].sql, /RETURNING jobs\.id, jobs\.object_key, jobs\.attempts, jobs\.lease_token/);
  });

  it('never calls private storage when claimed metadata is malformed', async () => {
    let deletes = 0;
    await assert.rejects(processSocialMediaDeletes({
      query: async () => ({ rows: [{ ...row, attempts: Number.MAX_SAFE_INTEGER + 1 }] }),
    }, {
      deleteProcessed: async () => { deletes++; },
    }), /invalid_social_delete_job/);
    assert.equal(deletes, 0);
  });

  it('returns no work and performs no storage operations for an empty claim', async () => {
    let queries = 0;
    let deletes = 0;
    const result = await processSocialMediaDeletes({
      query: async () => { queries++; return { rows: [] }; },
    }, {
      deleteProcessed: async () => { deletes++; },
    });
    assert.deepEqual(result, { succeeded: 0, deferred: 0 });
    assert.equal(queries, 1);
    assert.equal(deletes, 0);
  });

  it('rejects oversized batches before querying or touching storage', async () => {
    let calls = 0;
    await assert.rejects(processSocialMediaDeletes({
      query: async () => { calls++; return { rows: [] }; },
    }, {
      deleteProcessed: async () => { calls++; },
    }, 26), /invalid_social_delete_batch_size/);
    assert.equal(calls, 0);
  });
});
