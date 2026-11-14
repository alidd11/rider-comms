import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldEnableSocialFixtures } from '../src/testFixtureMode.ts';

test('production mode has no fictional social content by default', () => {
  assert.equal(shouldEnableSocialFixtures(undefined), false);
  assert.equal(shouldEnableSocialFixtures(''), false);
  assert.equal(shouldEnableSocialFixtures('false'), false);
  assert.equal(shouldEnableSocialFixtures('1'), false);
});
test('only explicit test-export flag enables isolated fictional content', () => {
  assert.equal(shouldEnableSocialFixtures('true'), true);
  assert.equal(shouldEnableSocialFixtures('TRUE'), false);
});
