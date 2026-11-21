import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processSocialMediaDeletes } from '../src/socialMediaDeletionOutbox.ts';

const id = '123e4567-e89b-42d3-a456-426614174001';
const key = 'social/processed/123e4567-e89b-42d3-a456-426614174000.jpg';
const lease = '123e4567-e89b-42d3-a456-426614174002';
const job = { id, object_key: key, attempts: 1, lease_token: lease };

describe('Social private-media deletion lease races', () => {
  it('does not acknowledge a deletion when another worker owns the lease', async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const result = await processSocialMediaDeletes({
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: calls.length === 1 ? [job] : [] };
      },
    }, { deleteProcessed: async objectKey => { assert.equal(objectKey, key); } });
    assert.deepEqual(result, { succeeded: 0, deferred: 1 });
    assert.match(calls[1].sql, /lease_token = \$2 AND completed_at IS NULL/);
    assert.deepEqual(calls[1].values, [id, lease]);
  });

  it('releases only its own lease on storage failure and preserves retry backoff', async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const result = await processSocialMediaDeletes({
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rows: calls.length === 1 ? [job] : [] };
      },
    }, { deleteProcessed: async () => { throw new Error('sensitive storage diagnostic'); } });
    assert.deepEqual(result, { succeeded: 0, deferred: 1 });
    assert.match(calls[1].sql, /next_attempt_at = now\(\) \+ make_interval/);
    assert.match(calls[1].sql, /lease_token = \$2 AND completed_at IS NULL/);
    assert.deepEqual(calls[1].values, [id, lease]);
    assert.doesNotMatch(calls[1].sql, /sensitive storage diagnostic/);
  });

  it('continues processing other claimed jobs after a storage deletion fails', async () => {
    const second = {
      ...job,
      id: '123e4567-e89b-42d3-a456-426614174003',
      object_key: 'social/processed/123e4567-e89b-42d3-a456-426614174004.mp4',
    };
    const writes: Array<readonly unknown[] | undefined> = [];
    let queries = 0;
    const deleted: string[] = [];
    const result = await processSocialMediaDeletes({
      query: async (_sql, values) => {
        queries++;
        if (queries === 1) return { rows: [job, second] };
        writes.push(values);
        return { rows: queries === 3 ? [{ id: second.id }] : [] };
      },
    }, {
      deleteProcessed: async objectKey => {
        deleted.push(objectKey);
        if (objectKey === key) throw new Error('temporary outage');
      },
    });
    assert.deepEqual(deleted, [key, second.object_key]);
    assert.deepEqual(result, { succeeded: 1, deferred: 1 });
    assert.deepEqual(writes, [[id, lease], [second.id, lease]]);
  });
});
