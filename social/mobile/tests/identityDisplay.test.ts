import assert from 'node:assert/strict';
import test from 'node:test';
import { handleWithAt, initialsForName } from '../src/identityDisplay.ts';

test('name initials represent the first and last words, without copying avatar art', () => {
  assert.equal(initialsForName('Ali DD1'), 'AD');
  assert.equal(initialsForName('Alex'), 'AL');
  assert.equal(initialsForName('   '), 'R');
  assert.equal(initialsForName('  Nina   Cole  '), 'NC');
});
test('handle helper preserves one @ and trims user data', () => {
  assert.equal(handleWithAt('  @ali  '), '@ali');
  assert.equal(handleWithAt('ali'), '@ali');
  assert.equal(handleWithAt('  '), '');
});
