import assert from 'node:assert/strict';
import test from 'node:test';
import { accountTextDraftKey, isSafeRiderStorageId, LEGACY_UNSCOPED_TEXT_DRAFT } from '../src/createDraftKey.ts';

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

test('real Rider Comms backend rider_ IDs are valid and stay account-scoped', () => {
  // backend/src/authStore.ts creates rider_${generateRideCode(8).toLowerCase()}
  const first = 'rider_abcd1234';
  const second = 'rider_abcd1235';
  assert.equal(isSafeRiderStorageId(first), true);
  assert.notEqual(accountTextDraftKey(first), accountTextDraftKey(second));
  assert.equal(accountTextDraftKey(first), '@rider-comms/social/create-text-draft-v2/' + first);
  assert.equal(isSafeRiderStorageId('550e8400-e29b-41d4-a716-446655440000'), true);
  for (const invalid of ['rider_../secret', 'rider_/etc', 'rider_\\\\escape', 'rider_ space', 'rider_%2F', 'rider_💥']) {
    assert.equal(isSafeRiderStorageId(invalid), false);
  }
});
