import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_RIDE_SAFE_ENABLED,
  parseRideSafeEnabled,
  rideSafeStorageKey,
} from '../src/rideSafePreference.ts';

describe('Ride Safe preference', () => {
  it('defaults on and only an explicit false disables it', () => {
    assert.equal(DEFAULT_RIDE_SAFE_ENABLED, true);
    assert.equal(parseRideSafeEnabled(null), true);
    assert.equal(parseRideSafeEnabled('true'), true);
    assert.equal(parseRideSafeEnabled('false'), false);
  });

  it('is account scoped on the device', () => {
    assert.notEqual(rideSafeStorageKey('rider-a'), rideSafeStorageKey('rider-b'));
  });
});
