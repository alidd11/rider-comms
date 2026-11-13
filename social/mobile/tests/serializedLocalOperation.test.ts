import assert from 'node:assert/strict';
import test from 'node:test';
import { awaitLocalOperations, serializeLocalOperation } from '../src/serializedLocalOperation.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('account draft deletion waits for an in-flight save and cannot be undone by it', async () => {
  const key = 'draft-rider-test-a';
  const hold = deferred();
  const writes: string[] = [];
  const save = serializeLocalOperation(key, async () => {
    writes.push('save-start');
    await hold.promise;
    writes.push('save-finish');
  });
  const clear = serializeLocalOperation(key, async () => { writes.push('delete'); });
  await Promise.resolve();
  assert.deepEqual(writes, ['save-start']);
  hold.resolve();
  await Promise.all([save, clear]);
  await awaitLocalOperations(key);
  assert.deepEqual(writes, ['save-start', 'save-finish', 'delete']);
});

test('failed saves do not prevent a later private draft deletion', async () => {
  const key = 'draft-rider-test-b';
  const writes: string[] = [];
  const badSave = serializeLocalOperation(key, async () => { throw Error('quota exceeded'); });
  const clear = serializeLocalOperation(key, async () => { writes.push('delete'); });
  await assert.rejects(badSave, /quota exceeded/);
  await clear;
  await awaitLocalOperations(key);
  assert.deepEqual(writes, ['delete']);
});

test('unrelated accounts do not share a write queue', async () => {
  const hold = deferred();
  let aDone = false;
  let bDone = false;
  const a = serializeLocalOperation('draft-rider-test-c', async () => {
    await hold.promise;
    aDone = true;
  });
  const b = serializeLocalOperation('draft-rider-test-d', async () => { bDone = true; });
  await b;
  assert.equal(bDone, true);
  assert.equal(aDone, false);
  hold.resolve();
  await a;
  assert.equal(aDone, true);
});
