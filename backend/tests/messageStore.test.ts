import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageStore } from '../src/messageStore.ts';

describe('MessageStore', () => {
  it('creates a message with a generated id and timestamp', () => {
    const store = new MessageStore();
    const message = store.create('a', 'b', 'hey');
    assert.ok(message.id);
    assert.equal(message.fromRiderId, 'a');
    assert.equal(message.toRiderId, 'b');
    assert.equal(message.text, 'hey');
    assert.ok(message.createdAt > 0);
  });

  it('getThread returns messages in either direction, sorted ascending by createdAt', () => {
    const store = new MessageStore();
    store.create('a', 'b', 'first');
    store.create('b', 'a', 'second');
    store.create('a', 'b', 'third');
    store.create('a', 'c', 'unrelated'); // different thread

    const thread = store.getThread('a', 'b');
    assert.equal(thread.length, 3);
    assert.deepEqual(thread.map((m) => m.text), ['first', 'second', 'third']);

    // symmetric lookup
    const reversed = store.getThread('b', 'a');
    assert.deepEqual(reversed.map((m) => m.text), ['first', 'second', 'third']);
  });

  it('returns an empty array for a thread with no messages', () => {
    const store = new MessageStore();
    assert.deepEqual(store.getThread('x', 'y'), []);
  });
});
