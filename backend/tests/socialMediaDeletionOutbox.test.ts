import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSocialObjectKey, enqueueSocialMediaDelete, claimSocialMediaDeletes,
  processSocialMediaDeletes,
} from '../src/socialMediaDeletionOutbox.ts';

const key = 'social/processed/123e4567-e89b-42d3-a456-426614174000.jpg';
const id = '123e4567-e89b-42d3-a456-426614174001';
const lease = '123e4567-e89b-42d3-a456-426614174002';
const job = { id, object_key: key, attempts: 1, lease_token: lease };
describe('Social media deletion outbox', () => {
  it('accepts only server-generated processed object key shapes', () => {
    assert.doesNotThrow(() => assertSocialObjectKey(key));
    for (const bad of ['../etc/passwd', 'social/raw/a.jpg',
      'social/processed/123e4567-e89b-42d3-a456-426614174000.svg',
      key + '?token=1', '']) {
      assert.throws(() => assertSocialObjectKey(bad), /invalid_social_media_object_key/);
    }
  });
  it('enqueues idempotently on the supplied transaction', async () => {
    const calls: unknown[] = [];
    await enqueueSocialMediaDelete({ query: async (sql, values) => {
      calls.push([sql, values]); return { rows: [] };
    } }, key);
    assert.equal(calls.length, 1);
    assert.match(String((calls[0] as unknown[])[0]), /ON CONFLICT \(object_key\) DO NOTHING/);
    assert.deepEqual((calls[0] as unknown[])[1], [key]);
  });
  it('rejects invalid batch sizes before touching database', async () => {
    for (const size of [0, 26, -1, 1.5, Number.NaN]) {
      await assert.rejects(claimSocialMediaDeletes({ query: async () => {
        throw new Error('must not query');
      } }, size), /invalid_social_delete_batch_size/);
    }
  });
  it('validates returned lease, key and attempt metadata', async () => {
    for (const bad of [
      { ...job, id: 'bad' }, { ...job, object_key: '../bad' },
      { ...job, attempts: -1 }, { ...job, lease_token: 'bad' },
    ]) {
      await assert.rejects(claimSocialMediaDeletes({
        query: async () => ({ rows: [bad] }),
      }), /invalid_social_delete_job/);
    }
  });
  it('acknowledges only its lease after successful private DELETE', async () => {
    const calls: unknown[] = [];
    const db = { query: async (sql: string, values?: readonly unknown[]) => {
      calls.push([sql, values]);
      return { rows: calls.length === 1 ? [job] : [{ id }] };
    } };
    const deleted: string[] = [];
    assert.deepEqual(await processSocialMediaDeletes(db, {
      deleteProcessed: async k => { deleted.push(k); },
    }), { succeeded: 1, deferred: 0 });
    assert.deepEqual(deleted, [key]);
    assert.deepEqual((calls[1] as unknown[])[1], [id, lease]);
  });
  it('retries failures without exposing storage errors or losing the job', async () => {
    const calls: string[] = [];
    const db = { query: async (sql: string) => {
      calls.push(sql); return { rows: calls.length === 1 ? [job] : [] };
    } };
    assert.deepEqual(await processSocialMediaDeletes(db, {
      deleteProcessed: async () => { throw new Error('secret'); },
    }), { succeeded: 0, deferred: 1 });
    assert.match(calls[1], /next_attempt_at/);
    assert.doesNotMatch(calls[1], /secret/);
  });
  it('does not count stale lease acknowledgements as success', async () => {
    let n = 0;
    const db = { query: async () => ({ rows: ++n === 1 ? [job] : [] }) };
    assert.deepEqual(await processSocialMediaDeletes(db, {
      deleteProcessed: async () => {},
    }), { succeeded: 0, deferred: 1 });
  });
});
