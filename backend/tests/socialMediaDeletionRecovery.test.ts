import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processSocialMediaDeletes } from '../src/socialMediaDeletionOutbox.ts';

const keyA = 'social/processed/123e4567-e89b-42d3-a456-426614174000.jpg';
const keyB = 'social/processed/123e4567-e89b-42d3-a456-426614174003.mp4';
const first = {
  id: '123e4567-e89b-42d3-a456-426614174001',
  object_key: keyA,
  attempts: 1,
  lease_token: '123e4567-e89b-42d3-a456-426614174002',
};
const second = {
  id: '123e4567-e89b-42d3-a456-426614174004',
  object_key: keyB,
  attempts: 3,
  lease_token: '123e4567-e89b-42d3-a456-426614174005',
};

describe('Social private media deletion recovery', () => {
  it('continues deleting independent objects when one storage deletion fails', async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const db = {
      query: async (sql: string, values?: readonly unknown[]) => {
        statements.push({ sql, values });
        if (statements.length === 1) return { rows: [first, second] };
        if (sql.includes('completed_at = now()')) return { rows: [{ id: second.id }] };
        return { rows: [] };
      },
    };
    const visited: string[] = [];
    const result = await processSocialMediaDeletes(db, {
      deleteProcessed: async key => {
        visited.push(key);
        if (key === keyA) throw new Error('private storage unavailable');
      },
    }, 2);
    assert.deepEqual(result, { succeeded: 1, deferred: 1 });
    assert.deepEqual(visited, [keyA, keyB]);
    assert.match(statements[1].sql, /next_attempt_at/);
    assert.deepEqual(statements[1].values, [first.id, first.lease_token]);
    assert.deepEqual(statements[2].values, [second.id, second.lease_token]);
  });

  it('does not let a stale failed worker clear a replacement lease', async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const db = {
      query: async (sql: string, values?: readonly unknown[]) => {
        statements.push({ sql, values });
        return { rows: statements.length === 1 ? [first] : [] };
      },
    };
    assert.deepEqual(await processSocialMediaDeletes(db, {
      deleteProcessed: async () => { throw new Error('storage timeout'); },
    }), { succeeded: 0, deferred: 1 });
    assert.match(statements[1].sql, /lease_token = \$2 AND completed_at IS NULL/);
    assert.deepEqual(statements[1].values, [first.id, first.lease_token]);
  });

  it('counts an already-replaced successful lease as deferred, not completed', async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const db = {
      query: async (sql: string, values?: readonly unknown[]) => {
        statements.push({ sql, values });
        return { rows: statements.length === 1 ? [first] : [] };
      },
    };
    const visited: string[] = [];
    assert.deepEqual(await processSocialMediaDeletes(db, {
      deleteProcessed: async key => { visited.push(key); },
    }), { succeeded: 0, deferred: 1 });
    assert.deepEqual(visited, [keyA]);
    assert.match(statements[1].sql, /lease_token = \$2 AND completed_at IS NULL/);
    assert.deepEqual(statements[1].values, [first.id, first.lease_token]);
  });
});
