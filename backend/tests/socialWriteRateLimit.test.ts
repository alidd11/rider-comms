import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeSocialWriteQuota, SOCIAL_WRITE_RATE_SCHEMA } from '../src/socialWriteRateLimit.ts';

const actor = '123e4567-e89b-42d3-a456-426614174000';

test('schema uses independent actor/action/window key and check', () => {
  assert.match(SOCIAL_WRITE_RATE_SCHEMA, /PRIMARY KEY \(actor_id, action, window_start\)/);
  assert.match(SOCIAL_WRITE_RATE_SCHEMA, /CHECK \(hits > 0\)/);
});
test('grants atomically and binds arguments', async () => {
  let sql = ''; let params: readonly unknown[] = [];
  const db = { async query(s: string, p: readonly unknown[]) { sql = s; params = p; return { rows: [{ hits: 1 }] }; } };
  assert.deepEqual(await consumeSocialWriteQuota(db, actor, 'post_create', 5, 60, 61_000), { allowed: true, retryAfterSeconds: 0 });
  assert.match(sql, /ON CONFLICT/);
  assert.match(sql, /WHERE social_write_rate_windows.hits < \$4/);
  assert.deepEqual(params, [actor, 'post_create', '1970-01-01T00:01:00.000Z', 5]);
});
test('denial is fail closed and returns remaining window seconds', async () => {
  const db = { async query() { return { rows: [] }; } };
  assert.deepEqual(await consumeSocialWriteQuota(db, actor, 'post_create', 1, 60, 61_001), { allowed: false, retryAfterSeconds: 59 });
});
test('rejects malformed actor, action, quota and clock before querying', async () => {
  const db = { async query() { throw new Error('should not query'); } };
  for (const args of [
    ['bad', 'post_create', 1, 60, 0],
    [actor, 'post-create', 1, 60, 0],
    [actor, 'post_create', 0, 60, 0],
    [actor, 'post_create', 1, 0, 0],
    [actor, 'post_create', 1, 60, -1],
    [actor, 'post_create', 1, 60, Number.NaN],
  ] as const) {
    await assert.rejects(consumeSocialWriteQuota(db, ...args), /invalid_social_write_quota/);
  }
});
test('rejects impossible database counter and propagates database failure', async () => {
  const bad = { async query() { return { rows: [{ hits: 3 }] }; } };
  await assert.rejects(consumeSocialWriteQuota(bad, actor, 'post_create', 2, 60, 0), /invalid_social_write_quota_result/);
  const down = { async query(): Promise<{rows: Array<{hits:number}>}> { throw new Error('database_down'); } };
  await assert.rejects(consumeSocialWriteQuota(down, actor, 'post_create', 2, 60, 0), /database_down/);
});
