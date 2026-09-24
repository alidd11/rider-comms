import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildNavigationProviderUrl } from '../mobile/src/navigationLinks.ts';

const app = await readFile(new URL('../docs/app.js', import.meta.url), 'utf8');

// docs/app.js hand-ports mobile/src/navigationLinks.ts's external-provider
// URL building (Google Maps/Waze/Apple Maps handoff) as a private
// `navigationHref` closure -- it isn't exposed on window like the other
// ported modules (RiderNavigationCamera etc.), so extract its real source
// and evaluate it directly rather than re-typing the logic here, which
// would only prove the copy I wrote matches, not the one shipping.
function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Missing ${signature}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let index = bodyStart;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  assert.ok(depth === 0, `Could not find end of ${signature}`);
  return source.slice(start, index + 1);
}

const navigationHrefSource = extractFunction(app, 'function navigationHref(provider, lat, lng, label) {');
// eslint-disable-next-line no-new-func
const navigationHref = new Function(`'use strict'; return (${navigationHrefSource});`)();

const fixtures = [
  { provider: 'google_maps', target: { lat: 51.5074, lon: -0.1278 } },
  { provider: 'google_maps', target: { lat: 40.7128, lon: -74.006, label: 'Empire State Building' } },
  { provider: 'waze', target: { lat: 34.0522, lon: -118.2437 } },
  { provider: 'apple_maps', target: { lat: 48.8566, lon: 2.3522, label: 'Café de Flore' } },
];

for (const { provider, target } of fixtures) {
  const nativeUrl = buildNavigationProviderUrl(target, provider);
  const pwaUrl = navigationHref(provider, target.lat, target.lon, target.label);
  assert.ok(nativeUrl, `native URL builder unexpectedly rejected ${JSON.stringify({ provider, target })}`);

  const native = new URL(nativeUrl);
  const pwa = new URL(pwaUrl);
  assert.equal(pwa.origin + pwa.pathname, native.origin + native.pathname, `PWA/native ${provider} host drift`);
  assert.deepEqual(
    Object.fromEntries(pwa.searchParams),
    Object.fromEntries(native.searchParams),
    `PWA/native ${provider} query params drift for ${JSON.stringify(target)}`,
  );
}

console.log('Navigation-provider handoff URL PWA/native parity valid: Google Maps, Waze and Apple Maps links stay in sync');
