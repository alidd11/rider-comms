import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExternalNavigationUrl,
  buildNavigationProviderUrl,
  navigationTargetFromValues,
  parseNavigationLink,
} from '../src/navigationLinks.ts';

describe('parseNavigationLink', () => {
  it('parses the public web path and safely decodes its optional label', () => {
    assert.deepEqual(
      parseNavigationLink('https://alidd11.github.io/rider-comms/navigate?lat=51.5074&lon=-0.1278&label=Tower%20Bridge'),
      { lat: 51.5074, lon: -0.1278, label: 'Tower Bridge' }
    );
  });

  it('parses the canonical /navigate path and custom app scheme', () => {
    assert.deepEqual(parseNavigationLink('https://example.com/navigate?lat=0&lon=0'), { lat: 0, lon: 0 });
    assert.deepEqual(parseNavigationLink('ridercomms://navigate?lat=-33.8&lon=151.2'), { lat: -33.8, lon: 151.2 });
  });

  it('rejects missing, non-numeric, and out-of-range coordinates', () => {
    assert.equal(parseNavigationLink('https://example.com/navigate?lon=1'), null);
    assert.equal(parseNavigationLink('https://example.com/navigate?lat=one&lon=1'), null);
    assert.equal(parseNavigationLink('https://example.com/navigate?lat=91&lon=1'), null);
    assert.equal(parseNavigationLink('https://example.com/navigate?lat=1&lon=-181'), null);
  });

  it('accepts coordinates on the supported latitude and longitude boundaries', () => {
    assert.deepEqual(parseNavigationLink('https://example.com/navigate?lat=90&lon=180'), { lat: 90, lon: 180 });
    assert.deepEqual(parseNavigationLink('https://example.com/navigate?lat=-90&lon=-180'), { lat: -90, lon: -180 });
  });

  it('rejects malformed URLs, unsupported paths, and protocols', () => {
    assert.equal(parseNavigationLink('not a URL'), null);
    assert.equal(parseNavigationLink('https://example.com/rides?lat=1&lon=1'), null);
    assert.equal(parseNavigationLink('javascript:navigate?lat=1&lon=1'), null);
  });
});

describe('navigation handoff URLs', () => {
  it('validates raw coordinate values', () => {
    assert.deepEqual(navigationTargetFromValues(51.5, -0.1, '  Cafe  '), { lat: 51.5, lon: -0.1, label: 'Cafe' });
    assert.equal(navigationTargetFromValues(Number.NaN, 0), null);
  });

  it('builds explicit Google Maps, Waze and Apple Maps provider URLs', () => {
    const target = { lat: 51.5, lon: -0.1, label: 'Ace Café & meet' };
    assert.equal(
      buildNavigationProviderUrl(target, 'google_maps'),
      'https://www.google.com/maps/dir/?api=1&destination=51.5%2C-0.1&travelmode=driving'
    );
    assert.equal(
      buildNavigationProviderUrl(target, 'waze'),
      'https://www.waze.com/ul?ll=51.5%2C-0.1&navigate=yes'
    );
    assert.equal(
      buildNavigationProviderUrl(target, 'apple_maps'),
      'https://maps.apple.com/?daddr=51.5%2C-0.1&q=Ace%20Caf%C3%A9%20%26%20meet&dirflg=d'
    );
  });

  it('builds encoded iOS and Android handoff URLs', () => {
    const target = { lat: 51.5, lon: -0.1, label: 'Ace Café & meet' };
    assert.equal(
      buildExternalNavigationUrl(target, 'ios'),
      'https://maps.apple.com/?daddr=51.5%2C-0.1&q=Ace%20Caf%C3%A9%20%26%20meet&dirflg=d'
    );
    assert.equal(
      buildExternalNavigationUrl(target, 'android'),
      'geo:51.5,-0.1?q=51.5%2C-0.1(Ace%20Caf%C3%A9%20%26%20meet)'
    );
  });
});
