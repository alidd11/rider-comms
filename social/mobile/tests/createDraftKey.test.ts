import assert from 'node:assert/strict';
import test from 'node:test';
import { accountTextDraftKey, LEGACY_UNSCOPED_TEXT_DRAFT } from '../src/createDraftKey.ts';

test('different signed-in accounts cannot see the same local composer draft', () => {
  const first = accountTextDraftKey('rider-test-001');
  const second = accountTextDraftKey('rider-test-002');
  assert.notEqual(first, second);
  assert.notEqual(first, LEGACY_UNSCOPED_TEXT_DRAFT);
  assert.ok(first.includes('rider-test-001'));
});
test('invalid rider IDs cannot be used to access arbitrary local storage keys', () => {
  for (const id of ['', 'guest', '../something', 'a'.repeat(81), 'a/b/c']) {
    assert.throws(() => accountTextDraftKey(id), /Invalid Rider Comms account identifier/);
  }
});
