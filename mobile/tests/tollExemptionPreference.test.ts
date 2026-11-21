import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTollExemptions, tollExemptionsStorageKey, TOLL_EXEMPTION_OPTIONS, TollExemptionsStorageGuard } from '../src/tollExemptionPreference.ts';

describe('toll exemption preference', () => {
  it('defaults to none, validates IDs and deduplicates', () => {
    assert.deepEqual(parseTollExemptions(null), []);
    assert.deepEqual(parseTollExemptions('{invalid'), []);
    assert.deepEqual(parseTollExemptions('{}'), []);
    assert.deepEqual(parseTollExemptions('["london_ulez","london_ulez","unknown"]'), ['london_ulez']);
    assert.deepEqual(parseTollExemptions(JSON.stringify(TOLL_EXEMPTION_OPTIONS.map(o => o.id))), TOLL_EXEMPTION_OPTIONS.map(o => o.id));
  });
  it('scopes local storage by rider', () => {
    assert.notEqual(tollExemptionsStorageKey('a'), tollExemptionsStorageKey('b'));
  });
  it('rejects outdated preference reads after a reset or later edit', () => {
    const guard = new TollExemptionsStorageGuard();
    const initial = guard.beginLoad();
    assert.equal(guard.isCurrent(initial), true);
    guard.invalidate();
    assert.equal(guard.isCurrent(initial), false);
    const afterReset = guard.beginLoad();
    assert.equal(guard.isCurrent(afterReset), true);
    guard.beginLoad();
    assert.equal(guard.isCurrent(afterReset), false);
  });
  it('orders pending saves before reset and recovers from failed writes', async () => {
    const guard = new TollExemptionsStorageGuard();
    const events: string[] = [];
    guard.enqueue(async () => { events.push('saved'); });
    guard.enqueue(async () => { throw new Error('storage unavailable'); });
    guard.enqueue(async () => { events.push('reset'); });
    await guard.idle();
    assert.deepEqual(events, ['saved', 'reset']);
  });
});
