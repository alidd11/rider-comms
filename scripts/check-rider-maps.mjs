import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RIDER_MAPS_RELEASED, MAP_STYLE_URLS, openMapStyle, assertMapDataCompatibility,
} from '../map-lab/config.mjs';
import { MAX_ROUTE_POINTS, parseOpenRoute, illustrativeLine } from '../map-lab/open-route.mjs';

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
const openRoute = {
  provenance: { engine: 'valhalla', mapData: 'openstreetmap' },
  coordinates: [[-0.1276, 51.5072], [-0.1257, 51.5090]],
  distanceMeters: 270,
  durationSeconds: 60,
};
const parsed = parseOpenRoute(openRoute);
assert.equal(parsed.type, 'Feature');
assert.equal(parsed.properties.trafficAvailable, false);
assert.equal(parsed.properties.navigationReady, false);
assert.equal(parsed.properties.source, 'open-data');
assert.deepEqual(parsed.geometry.coordinates, openRoute.coordinates);
openRoute.coordinates[0][0] = 99;
assert.equal(parsed.geometry.coordinates[0][0], -0.1276, 'Route data must be copied');
assert.equal(parseOpenRoute({ ...openRoute, provenance: {engine: 'osrm', mapData: 'openstreetmap'} }).properties.engine, 'osrm');
for (const source of ['google', 'google-routes', 'unknown', null]) {
  assert.throws(() => parseOpenRoute({ ...openRoute, provenance: { engine: source, mapData: 'openstreetmap' } }));
}
assert.throws(() => parseOpenRoute({ ...openRoute, provenance: {engine: 'valhalla', mapData: 'google'} }));
for (const coordinates of [[], [[0, 0]], [[Infinity, 0], [1, 2]], [[-181, 0], [1, 2]], [[0, 91], [1, 2]], [[-1, 1, 2], [1, 2]], [[0, 0], [0, NaN]], Array.from({length: MAX_ROUTE_POINTS + 1}, () => [0, 0])]) {
  assert.throws(() => parseOpenRoute({...openRoute, coordinates}));
}
for (const metrics of [{ distanceMeters: -1 }, { durationSeconds: Infinity }, { durationSeconds: 0 }, { distanceMeters: NaN }]) {
  assert.throws(() => parseOpenRoute({...openRoute, ...metrics}));
}
for (const prohibited of ['traffic', 'trafficAware', 'speedLimits', 'tolls', 'lanes', 'googlePlaceId']) {
  assert.throws(() => parseOpenRoute({...openRoute, [prohibited]: null}));
}
assert.equal(illustrativeLine().properties.source, 'synthetic-demo');
assert.equal(illustrativeLine().properties.navigationReady, false);
assert.match(html, /Content-Security-Policy/);
assert.match(html, /OpenStreetMap contributors/);
assert.match(html, /OpenFreeMap/);
assert.match(html, /maplibre-gl@6\.3\.0/);
assert.match(js, /assertMapDataCompatibility/);
assert.match(js, /RIDER_MAPS_RELEASED !== false/);
assert.match(js, /map\.on\('style\.load',/);
assert.match(js, /addDemoOverlay\(\)/);
assert.match(html, /not road-matched/);
assert.doesNotMatch(html + js + css, /googleapis\.com|google\.maps|maps\.google\.com/i, 'The experimental map must not fetch Google Maps content');
assert.doesNotMatch(html + js, /getCurrentPosition|watchPosition|localStorage|sessionStorage/, 'The map lab must not collect or persist rider positions');
console.log('Rider Comms Maps: isolated prototype, synthetic overlay, open-route provenance and provider guards validated.');
