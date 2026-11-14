import assert from 'node:assert/strict';
import test from 'node:test';
import { profileForRider } from '../src/profileDisplay.ts';
import { DEFAULT_PROFILE } from '../src/garage.ts';

test('real Rider Comms account does not inherit fictional Social biography or public status', () => {
  const result = profileForRider({ ...DEFAULT_PROFILE, visibility: 'public' }, 'real-rider', false);
  assert.equal(result.displayName, 'real-rider');
  assert.equal(result.bio, '');
  assert.equal(result.visibility, 'private');
});
test('custom user-authored biography remains visible locally without public publishing', () => {
  const result = profileForRider({
    displayName: 'A rider', bio: 'My own description.', visibility: 'public',
  }, 'real-rider', false);
  assert.equal(result.displayName, 'A rider');
  assert.equal(result.bio, 'My own description.');
  assert.equal(result.visibility, 'private');
});
test('synthetic screenshot fixtures retain their intentional descriptions', () => {
  const result = profileForRider(DEFAULT_PROFILE, 'fixture-rider', true);
  assert.equal(result.displayName, 'fixture-rider');
  assert.equal(result.bio, DEFAULT_PROFILE.bio);
  assert.equal(result.visibility, DEFAULT_PROFILE.visibility);
});
