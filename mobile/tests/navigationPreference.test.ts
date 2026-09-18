import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NAVIGATION_PROVIDER,
  NAVIGATION_PROVIDER_OPTIONS,
  navigationProviderLabel,
  navigationProviderStorageKey,
  parseNavigationProvider,
} from '../src/navigationPreference.ts';

describe('navigation preference', () => {
  it('accepts the four supported providers and falls back safely', () => {
    for (const option of NAVIGATION_PROVIDER_OPTIONS) {
      assert.equal(parseNavigationProvider(option.id), option.id);
    }
    assert.equal(parseNavigationProvider('unknown'), DEFAULT_NAVIGATION_PROVIDER);
    assert.equal(parseNavigationProvider(null), DEFAULT_NAVIGATION_PROVIDER);
  });

  it('keeps the preference account scoped on a device', () => {
    assert.equal(
      navigationProviderStorageKey('rider_alpha'),
      '@rider-comms/settings/navigation-provider/rider_alpha'
    );
    assert.notEqual(
      navigationProviderStorageKey('rider_alpha'),
      navigationProviderStorageKey('rider_beta')
    );
  });

  it('returns rider-facing provider labels', () => {
    assert.equal(navigationProviderLabel('in_app'), 'Rider Comms');
    assert.equal(navigationProviderLabel('google_maps'), 'Google Maps');
    assert.equal(navigationProviderLabel('waze'), 'Waze');
    assert.equal(navigationProviderLabel('apple_maps'), 'Apple Maps');
  });
});
