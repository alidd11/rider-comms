import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RIDER_MAPS_RELEASED, MAP_STYLE_URLS, openMapStyle, assertMapDataCompatibility,
} from '../map-lab/config.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../map-lab/index.html');
const js = read('../map-lab/preview.mjs');
const css = read('../map-lab/preview.css');

assert.equal(RIDER_MAPS_RELEASED, false, 'Map-lab must not be released');
assert.deepEqual(Object.keys(MAP_STYLE_URLS), ['day', 'night']);
for (const [name, url] of Object.entries(MAP_STYLE_URLS)) {
  assert.equal(openMapStyle(name), url);
  assert.match(url, /^https:\/\/tiles\.openfreemap\.org\/styles\/[a-z]+$/);
}
assert.throws(() => openMapStyle('unknown'), /Unknown map style/);
assert.equal(assertMapDataCompatibility({ surface: 'open', directions: 'open-data', places: 'rider-owned' }), true);
assert.equal(assertMapDataCompatibility({ surface: 'open', directions: 'none', places: 'none' }), true);
assert.equal(assertMapDataCompatibility({ surface: 'google', directions: 'google', places: 'google' }), true);
for (const illegal of ['google', 'google-routes', 'google-places', 'unreviewed', '', undefined, null]) {
  assert.throws(() => assertMapDataCompatibility({ surface: 'open', directions: illegal, places: 'none' }));
  assert.throws(() => assertMapDataCompatibility({ surface: 'open', directions: 'none', places: illegal }));
}
assert.throws(() => assertMapDataCompatibility({ surface: 'something-new', directions: 'none', places: 'none' }));
assert.match(html, /Content-Security-Policy/);
assert.match(html, /OpenStreetMap contributors/);
assert.match(html, /OpenFreeMap/);
assert.match(html, /maplibre-gl@6\.3\.0/);
assert.match(js, /assertMapDataCompatibility/);
assert.match(js, /RIDER_MAPS_RELEASED !== false/);
assert.doesNotMatch(html + js + css, /googleapis\.com|google\.maps|maps\.google\.com/i, 'The experimental map must not fetch Google Maps content');
assert.doesNotMatch(html + js, /getCurrentPosition|watchPosition|localStorage|sessionStorage/, 'The map lab must not collect or persist rider positions');
console.log('Rider Comms Maps prototype is isolated, release-gated and checks map-provider separation.');
