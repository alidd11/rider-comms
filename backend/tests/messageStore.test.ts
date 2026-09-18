import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidMessageCursorError, MessageStore, decodeMessageCursor, encodeMessageCursor } from '../src/messageStore.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';

// MessageStore is now Postgres-backed (see db.ts) — these tests need
// DATABASE_URL to point at a reachable Postgres instance and are skipped
// otherwise, rather than failing every run in a sandbox with no database.
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('message cursors', () => {
  it('round-trips opaque sequence cursors and rejects malformed input', () => {
    const cursor = encodeMessageCursor('123456789');
    assert.equal(decodeMessageCursor(cursor), '123456789');
    assert.throws(() => decodeMessageCursor('not-a-sequence'), InvalidMessageCursorError);
  });
});

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
    await getPool().query('TRUNCATE direct_message_reads, direct_messages');
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

  it('advances a per-rider read cursor monotonically', async () => {
    const store = new MessageStore();
    await store.create('b', 'a', 'first incoming');
    await store.create('a', 'b', 'outgoing');
    await store.create('b', 'a', 'second incoming');

    const firstRead = await store.markThreadRead('a', 'b');
    assert.ok(firstRead > 0);
    const stored = await getPool().query<{ last_read_seq: string }>(
      'SELECT last_read_seq FROM direct_message_reads WHERE rider_id = $1',
      ['a'],
    );
    assert.equal(Number(stored.rows[0].last_read_seq), firstRead);

    await store.create('b', 'a', 'third incoming');
    const secondRead = await store.markThreadRead('a', 'b');
    assert.ok(secondRead > firstRead);

    // Repeating the call cannot move the cursor backwards.
    assert.equal(await store.markThreadRead('a', 'b'), secondRead);
  });

  it('paginates newest-first in SQL without gaps or duplicates', async () => {
    const store = new MessageStore();
    for (const text of ['one', 'two', 'three', 'four', 'five']) await store.create('a', 'b', text);
    const latest = await store.getThreadPage('a', 'b', 2);
    assert.deepEqual(latest.messages.map((message) => message.text), ['four', 'five']);
    assert.ok(latest.nextCursor);
    const middle = await store.getThreadPage('b', 'a', 2, latest.nextCursor ?? undefined);
    assert.deepEqual(middle.messages.map((message) => message.text), ['two', 'three']);
    assert.ok(middle.nextCursor);
    const oldest = await store.getThreadPage('a', 'b', 2, middle.nextCursor ?? undefined);
    assert.deepEqual(oldest.messages.map((message) => message.text), ['one']);
    assert.equal(oldest.nextCursor, null);
  });
});
