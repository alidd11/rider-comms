import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNavigationProviderUrl,
  navigationTargetFromValues,
  openNavigationUrl,
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

  it('checks URL support before asking the OS to open directions', async () => {
    const opened: string[] = [];
    const supported = await openNavigationUrl('https://www.google.com/maps/dir/?api=1', {
      canOpenURL: async () => true,
      openURL: async (url) => { opened.push(url); },
    });
    assert.equal(supported, true);
    assert.deepEqual(opened, ['https://www.google.com/maps/dir/?api=1']);

    const unsupported = await openNavigationUrl('geo:51.5,-0.1', {
      canOpenURL: async () => false,
      openURL: async () => { throw new Error('must not open'); },
    });
    assert.equal(unsupported, false);
  });

  it('accepts only the generated HTTPS directions endpoints for all three providers', async () => {
    const target = { lat: 51.5074, lon: -0.1278, label: 'Safe test destination' };
    const opened: string[] = [];
    const opener = {
      canOpenURL: async () => true,
      openURL: async (url: string) => { opened.push(url); },
    };
    for (const provider of ['google_maps', 'waze', 'apple_maps'] as const) {
      const url = buildNavigationProviderUrl(target, provider);
      assert.ok(url, provider);
      assert.equal(await openNavigationUrl(url, opener), true, provider);
      assert.equal(opened.at(-1), url, provider);
    }
    assert.equal(opened.length, 3);
  });

  it('blocks executable schemes, untrusted hosts and insecure navigation URLs', async () => {
    const opened: string[] = [];
    for (const url of [
      'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd', 'http://www.google.com/maps/dir/',
      'https://www.google.com.attacker.example/maps/dir/',
      'https://www.google.com@attacker.example/maps/dir/', 'https://www.waze.com:8443/ul',
      'https://www.google.com/search?q=maps', 'https://www.google.com/maps/dir/extra',
      'https://www.waze.com/ul/extra', 'https://maps.apple.com/account',
      'https://www.waze.com/ul.attacker',
    ]) {
      assert.equal(await openNavigationUrl(url, {
        canOpenURL: async () => { throw new Error('untrusted URL must not reach the OS'); },
        openURL: async (openedUrl) => { opened.push(openedUrl); },
      }), false, url);
    }
    assert.deepEqual(opened, []);
  });

  it('fails safely when support checks or OS handoff throw', async () => {
    assert.equal(await openNavigationUrl('geo:51.5,-0.1', {
      canOpenURL: async () => { throw new Error('query unavailable'); },
      openURL: async () => undefined,
    }), false);
    assert.equal(await openNavigationUrl('geo:51.5,-0.1', {
      canOpenURL: async () => true,
      openURL: async () => { throw new Error('handoff failed'); },
    }), false);
  });
});
