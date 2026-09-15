import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../src/messageStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

// MessageStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('MessageStore', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed MessageStore tests' }, () => {
  before(async () => {
    try {
      await getPool().query('SELECT 1');
      await ensureMigrated();
    } catch (error) {
      throw new Error(`DATABASE_URL is set but Postgres is unreachable: ${(error as Error).message}`);
    }
  });

  beforeEach(async () => {
    await getPool().query('TRUNCATE direct_messages');
  });

  after(async () => {
    await resetDbForTests();
  });

  it('creates a message with a generated id and timestamp', async () => {
    const store = new MessageStore();
    const message = await store.create('a', 'b', 'hey');
    assert.ok(message.id);
    assert.equal(message.fromRiderId, 'a');
    assert.equal(message.toRiderId, 'b');
    assert.equal(message.text, 'hey');
    assert.ok(message.createdAt > 0);
  });

  it('getThread returns messages in either direction, sorted ascending by createdAt', async () => {
    const store = new MessageStore();
    await store.create('a', 'b', 'first');
    await store.create('b', 'a', 'second');
    await store.create('a', 'b', 'third');
    await store.create('a', 'c', 'unrelated'); // different thread

    const thread = await store.getThread('a', 'b');
    assert.equal(thread.length, 3);
    assert.deepEqual(thread.map((m) => m.text), ['first', 'second', 'third']);

    // symmetric lookup
    const reversed = await store.getThread('b', 'a');
    assert.deepEqual(reversed.map((m) => m.text), ['first', 'second', 'third']);
  });

  it('returns an empty array for a thread with no messages', async () => {
    const store = new MessageStore();
    assert.deepEqual(await store.getThread('x', 'y'), []);
  });
});
