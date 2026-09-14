import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HideoutStore } from '../src/hideoutStore.ts';

describe('HideoutStore', () => {
  it('creates a hideout with a generated id and timestamp', () => {
    const store = new HideoutStore();
    const hideout = store.create({
      name: 'Base Camp',
      lat: 40,
      lon: -105,
      createdBy: 'a',
      participantIds: ['b', 'c'],
    });
    assert.ok(hideout.id);
    assert.equal(hideout.name, 'Base Camp');
    assert.ok(hideout.createdAt > 0);
  });

  it('getForRider returns hideouts where rider is creator or participant', () => {
    const store = new HideoutStore();
    const h1 = store.create({ name: 'H1', lat: 0, lon: 0, createdBy: 'a', participantIds: [] });
    const h2 = store.create({ name: 'H2', lat: 0, lon: 0, createdBy: 'x', participantIds: ['a'] });
    store.create({ name: 'H3', lat: 0, lon: 0, createdBy: 'x', participantIds: ['y'] });

    const results = store.getForRider('a');
    const ids = results.map((h) => h.id).sort();
    assert.deepEqual(ids, [h1.id, h2.id].sort());
  });

  it('delete() succeeds only for the creator', () => {
    const store = new HideoutStore();
    const hideout = store.create({
      name: 'H',
      lat: 0,
      lon: 0,
      createdBy: 'a',
      participantIds: ['b'],
    });

    const forbidden = store.delete(hideout.id, 'b');
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) assert.equal(forbidden.error, 'forbidden');

    const ok = store.delete(hideout.id, 'a');
    assert.equal(ok.ok, true);
  });

  it('delete() 404s on an unknown hideout', () => {
    const store = new HideoutStore();
    const result = store.delete('nonexistent', 'a');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'not_found');
  });
});
