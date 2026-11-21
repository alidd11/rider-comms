import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTollExemptions, tollExemptionsStorageKey, TOLL_EXEMPTION_OPTIONS } from '../src/tollExemptionPreference.ts';

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
});
