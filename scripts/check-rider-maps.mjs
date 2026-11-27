import assert from 'node:assert/strict';
import './check-map-lanes.mjs';
import './check-multi-vehicle-routing.mjs';
import './check-maps-charge-handoff.mjs';
import './check-local-map-graph.mjs';
import './check-local-valhalla-routes.mjs';
import {
  VALHALLA_MOTORCYCLE_ROUTING_ENABLED, MAX_RESEARCH_ROUTE_LOCATIONS,
  draftValhallaMotorcycleRequest,
} from '../map-lab/valhalla-request.mjs';

import { readFileSync } from 'node:fs';
import {
  RIDER_MAPS_RELEASED, MAP_STYLE_URLS, openMapStyle, assertMapDataCompatibility,
} from '../map-lab/config.mjs';
import { MAX_ROUTE_POINTS, parseOpenRoute, illustrativeLine } from '../map-lab/open-route.mjs';

import {
  decodeValhallaPolyline6, fromOsrmGeojson, fromValhallaTrip,
} from '../map-lab/route-adapters.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../map-lab/index.html');
const js = read('../map-lab/preview.mjs');
const css = read('../map-lab/preview.css');
assert.equal(js, read('../docs/map-beta/preview.mjs'), 'Both beta preview renderer sources must stay in sync');
assert.match(html, /id="retryMapTiles"/, 'The experimental map must offer explicit tile retry');
assert.match(js, /retryButton\.addEventListener\('click', \(\) => setTheme\(currentTheme\)\)/,
  'Tile retry must reload the current theme without using rider or Google data');
assert.match(js, /retryButton\.disabled = true/, 'A failed map engine load must disable its retry control');

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

// Grounded response formats: OSRM geometry=geojson and Valhalla trip.legs shape.
const osrm = {
  code: 'Ok', routes: [{
    geometry: { type: 'LineString', coordinates: [[-0.1276, 51.5072], [-0.1257, 51.5090]] },
    distance: 250.5, duration: 43.5,
  }],
};
const osrmParsed = fromOsrmGeojson(osrm);
assert.equal(osrmParsed.properties.engine, 'osrm');
assert.equal(osrmParsed.properties.distanceMeters, 250.5);
assert.deepEqual(osrmParsed.geometry.coordinates, osrm.routes[0].geometry.coordinates);
osrm.routes[0].geometry.coordinates[0][0] = 0;
assert.equal(osrmParsed.geometry.coordinates[0][0], -0.1276, 'OSRM response coordinates must be copied');
for (const payload of [
  null, {}, { code: 'NoRoute', routes: osrm.routes },
  { code: 'Ok', routes: [] },
  { code: 'Ok', routes: [{ ...osrm.routes[0], geometry: 'abc' }] },
  { code: 'Ok', routes: [{ ...osrm.routes[0], geometry: { type: 'Point', coordinates: [0, 0] } }] },
  { code: 'Ok', routes: [{ ...osrm.routes[0], duration: -1 }] },
]) assert.throws(() => fromOsrmGeojson(payload));

assert.deepEqual(decodeValhallaPolyline6('??AC'), [[0, 0], [0.000002, 0.000001]]);
assert.deepEqual(decodeValhallaPolyline6('ACAC'), [[0.000002, 0.000001], [0.000004, 0.000002]]);
for (const shape of ['', '?', '??', '_', '??~', '??!@', '_'.repeat(8), '??'.repeat(MAX_ROUTE_POINTS + 1)]) {
  assert.throws(() => decodeValhallaPolyline6(shape), 'Malformed polyline6 must fail');
}
const valhalla = {
  trip: {
    status: 0, units: 'kilometers', summary: { length: 0.25, time: 43.5 },
    legs: [{ shape: '??AC' }, { shape: 'ACAC' }],
  },
};
const valhallaParsed = fromValhallaTrip(valhalla);
assert.equal(valhallaParsed.properties.engine, 'valhalla');
assert.equal(valhallaParsed.properties.distanceMeters, 250);
assert.deepEqual(valhallaParsed.geometry.coordinates,
  [[0, 0], [0.000002, 0.000001], [0.000004, 0.000002]]);
assert.equal(fromValhallaTrip({
  trip: { ...valhalla.trip, units: 'miles', summary: { length: 1, time: 60 } },
}).properties.distanceMeters, 1609.344);
for (const trip of [
  { ...valhalla.trip, status: 1 },
  { ...valhalla.trip, units: 'unknown' },
  { ...valhalla.trip, summary: { length: 0, time: 43 } },
  { ...valhalla.trip, legs: [] },
  { ...valhalla.trip, legs: [{ shape: '??AC' }, { shape: '????' }] },
  { ...valhalla.trip, legs: [{ shape: '??AC' }, { shape: '???' }] },
  { ...valhalla.trip, legs: Array.from({ length: 22 }, () => ({shape:'??AC'})) },
]) assert.throws(() => fromValhallaTrip({ trip }), 'Invalid Valhalla trip must fail');
assert.throws(() => fromValhallaTrip(null));

// Strict Valhalla research request builder: no network, no car fallback,
// no implicit moped speed, no toll eligibility claims, no Google geometry.
assert.equal(VALHALLA_MOTORCYCLE_ROUTING_ENABLED, false);
// This must remain an offline-only research module. Neither the installed PWA
// nor the static beta launcher may import the routing request constructor.
assert.doesNotMatch(read('../docs/app.js'), /draftValhallaMotorcycleRequest/);
assert.doesNotMatch(read('../docs/map-beta/index.html'), /draftValhallaMotorcycleRequest/);
assert.doesNotMatch(read('../docs/map-beta/preview.mjs'), /draftValhallaMotorcycleRequest/);
assert.equal(MAX_RESEARCH_ROUTE_LOCATIONS, 8);
const researchCoordinates = [[-0.1276, 51.5072], [-0.115, 51.51]];
const motorcycleDraft = draftValhallaMotorcycleRequest({
  vehicleCategory: 'motorcycle_small', coordinates: researchCoordinates,
  avoidHighways: true, avoidTolls: true, avoidFerries: true,
});
assert.deepEqual(motorcycleDraft.request.locations, [
  { lat: 51.5072, lon: -0.1276 }, { lat: 51.51, lon: -0.115 },
]);
assert.equal(motorcycleDraft.request.costing, 'motorcycle');
assert.deepEqual(motorcycleDraft.request.costing_options.motorcycle, {
  use_trails: 0, use_highways: 0, use_tolls: 0, use_ferry: 0,
});
for (const property of ['networkRequestMade', 'legalRoadAccessVerified',
  'tollExemptionVerified', 'trafficAvailable', 'navigationReady']) {
  assert.equal(motorcycleDraft.assurance[property], false);
}
assert.equal(motorcycleDraft.assurance.dataProvider, 'openstreetmap');
researchCoordinates[0][0] = 99;
assert.equal(motorcycleDraft.request.locations[0].lon, -0.1276, 'Input coordinates must be cloned');
const scooterDraft = draftValhallaMotorcycleRequest({
  vehicleCategory: 'scooter',
  coordinates: [[-0.1276, 51.5072], [-0.115, 51.51]],
  scooterTopSpeedKph: 100,
});
assert.equal(scooterDraft.request.costing, 'motor_scooter');
assert.deepEqual(scooterDraft.request.costing_options.motor_scooter, { top_speed: 100 });
assert.doesNotMatch(JSON.stringify(scooterDraft.request), /google|apiKey|tollExemption/i);
assert.equal(scooterDraft.assurance.navigationReady, false);
const researchInput = { vehicleCategory: 'motorcycle_large',
  coordinates: [[-0.1276, 51.5072], [-0.115, 51.51]] };
for (const bad of [
  null, [], {}, { ...researchInput, vehicleCategory: 'car' },
  { ...researchInput, vehicleCategory: 'unknown' },
  { ...researchInput, avoidTolls: 'false' },
  { ...researchInput, avoidHighways: 1 },
  { ...researchInput, avoidFerries: null },
  { ...researchInput, scooterTopSpeedKph: 100 },
  { ...researchInput, googlePlaceId: 'secret' },
  { ...researchInput, traffic: true },
  { ...researchInput, tollExemption: true },
  { ...researchInput, coordinates: [] },
  { ...researchInput, coordinates: [[0, 0]] },
  { ...researchInput, coordinates: Array.from({ length: 9 }, () => [0, 0]) },
  { ...researchInput, coordinates: [[-181, 51], [0, 0]] },
  { ...researchInput, coordinates: [[0, 91], [0, 0]] },
  { ...researchInput, coordinates: [[0, 0, 0], [1, 1]] },
  { ...researchInput, coordinates: [[0, NaN], [1, 1]] },
  { ...researchInput, coordinates: [[0, 0], [0, 0]] },
  { vehicleCategory: 'scooter', coordinates: researchInput.coordinates },
  { vehicleCategory: 'scooter', coordinates: researchInput.coordinates, scooterTopSpeedKph: 19 },
  { vehicleCategory: 'scooter', coordinates: researchInput.coordinates, scooterTopSpeedKph: 121 },
  { vehicleCategory: 'scooter', coordinates: researchInput.coordinates, scooterTopSpeedKph: '100' },
]) assert.throws(() => draftValhallaMotorcycleRequest(bad));

const webSettings = read('../docs/app/10-settings.js');
const nativeSettings = read('../mobile/src/screens/SettingsScreen.tsx');
const nativeClient = read('../mobile/src/api/client.ts');
const betaHtml = read('../docs/map-beta/index.html');
assert.match(webSettings, /fresh\?\.role !== 'admin'/);
assert.match(webSettings, /apiFetch\('GET', '\/admin\/me'\)/);
assert.match(webSettings, /window\.RiderMovementSafety\.isLockedForSafety/);
assert.match(nativeSettings, /access\.role === 'admin'/);
assert.match(nativeSettings, /access\.role !== 'admin'/);
assert.match(nativeClient, /getStaffAccess\(\).*\/admin\/me/);
const pwaHtml = read('../docs/index.html');
const pwaBundle = read('../docs/app.js');
const pwaStyles = read('../docs/app.css');
assert.match(pwaHtml, /frame-src 'self' https:\/\/\*\.google\.com/);
// The admin check disables the clicked button before opening the modal;
// activeElement may have become <body>. Pass the original button explicitly
// so close/cancel always restores focus to the correct Settings control.
assert.match(webSettings, /function openEmbeddedMapBeta\(trigger\)/);
assert.match(webSettings, /openEmbeddedMapBeta\(button\);/);
assert.match(pwaBundle, /openEmbeddedMapBeta\(button\);/);
assert.doesNotMatch(webSettings, /const trigger = document\.activeElement;/);
assert.match(pwaBundle, /frame\.removeAttribute\('src'\)/);
assert.match(pwaBundle, /event\.source === frame\.contentWindow/);
assert.ok(pwaBundle.includes('sandbox="allow-scripts"'), 'The beta iframe must have opaque-origin sandbox');
assert.ok(pwaBundle.includes("event.origin === 'null'"), 'Only opaque-origin messages allowed');
assert.ok(pwaBundle.includes("session?.token !== tokenAtOpen"), 'Session switch must close beta');
assert.ok(pwaBundle.includes('window.clearInterval(roleTimer)'), 'Role timer must be cleaned up');
assert.ok(pwaBundle.includes("dialog.addEventListener('cancel'"), 'Native dialog cancel must call the common cleanup path');
assert.ok(pwaBundle.includes("event.stopPropagation();"), 'Modal must prevent Escape reaching Settings');
assert.ok(read('../docs/app/18-map-init-events.js').includes("$('#riderMapBetaDialog')?.open"), 'Settings must yield keyboard to topmost dialog');
assert.ok(pwaBundle.includes("window.removeEventListener('storage', onStorage)"), 'Session listener must be removed on close');
assert.ok(betaHtml.includes("event.source !== mapFrame?.contentWindow"), 'Nested frame messages require source verification');
assert.ok(betaHtml.includes("event.origin !== 'null'"), 'Nested frame messages require opaque-origin verification');
assert.ok(js.includes("event.key !== 'Escape'"), 'Sandbox must relay Escape to parent launcher');
const betaBuilder = read('../scripts/build-pwa.mjs');
assert.ok(betaBuilder.includes("resolve(source, 'map-beta', 'index.html')"), 'Only launcher HTML may be published');
assert.ok(betaBuilder.includes('write: false'), 'Preview JS must remain in an inline sandboxed payload');
assert.ok(betaBuilder.includes('createHash'), 'Inline preview must have an exact CSP hash');
assert.ok(betaHtml.includes('id="mapBetaSandbox"'), 'Standalone page must isolate the renderer in a nested iframe');
assert.ok(betaHtml.includes('sandbox="allow-scripts"'), 'Nested iframe must omit allow-same-origin');
assert.ok(betaHtml.includes('srcdoc="__RIDER_MAPS_SRCDOC__"'), 'Preview must be an opaque srcdoc payload');
assert.doesNotMatch(betaHtml, /<script[^>]+src=/i, 'Top-level launcher may never import CDN scripts');
assert.doesNotMatch(betaHtml, /<link[^>]+unpkg/, 'Top-level launcher may never import third-party styles');
assert.ok(betaHtml.includes('__RIDER_MAPS_PAYLOAD_HASH__'), 'CSP must validate preview bundle');
assert.ok(read('../docs/map-beta/preview.mjs').includes('parent.postMessage'), 'Preview must signal close');
assert.match(pwaStyles, /\.rider-map-beta-dialog/);
assert.match(read('../docs/map-beta/preview.mjs'), /rider-comms-close-map-beta/);
assert.match(js, /window\.addEventListener\('keydown'/,
  'Map child must capture Escape before the map renderer keyboard handlers');
assert.match(js, /document\.documentElement\.dataset\.escapeRelayReady = 'true'/,
  'Nested sandbox must mark Escape relay readiness only after installing the listener');
assert.match(betaHtml, /document\.documentElement\.dataset\.escapeRelayReady = 'true'/,
  'Public launcher must mark its relay readiness after message forwarding is live');
assert.match(read('../tests/visual/settings-account.spec.js'), /data-escape-relay-ready/,
  'Escape regression must await sandbox relay setup instead of only map markup');
assert.doesNotMatch(pwaBundle.slice(pwaBundle.indexOf('function openEmbeddedMapBeta'), pwaBundle.indexOf('async function revealAdminMapBeta')), /google\.maps|Google Directions|Google Places/);
assert.match(betaHtml, /Use classic map/);
assert.match(betaHtml, /id="retryMapBeta"/, 'Map preview must offer manual, isolated retry');
assert.match(betaHtml, /mapFrame\.srcdoc = mapFrame\.srcdoc/, 'Retry must reuse the fixed sandbox payload');
assert.match(betaHtml, /getAttribute\('sandbox'\) === 'allow-scripts'/, 'Retry must keep opaque-origin sandbox');
assert.match(betaHtml, /noindex,nofollow/);
assert.equal(read('../docs/map-beta/preview.mjs'), js);
assert.equal(read('../docs/map-beta/lane-access.mjs'), read('../map-lab/lane-access.mjs'));
assert.match(read('../docs/map-beta/preview.css'), /lane-demo-status/);
assert.match(css, /lane-demo-status/);
assert.match(html, /id="laneGuidanceDemo"/);
assert.match(html, /NOT A REAL ROAD/);
assert.match(js, /RIDER_LANE_GUIDANCE_RELEASED !== false/);
assert.match(js, /syntheticBusLaneScenario/);
assert.doesNotMatch(js + html, /officially allowed|legally permitted in London/i);
assert.equal(read('../docs/map-beta/config.mjs'), read('../map-lab/config.mjs'));
assert.equal(read('../docs/map-beta/open-route.mjs'), read('../map-lab/open-route.mjs'));
assert.match(html, /Content-Security-Policy/);
assert.match(html, /OpenStreetMap contributors/);
assert.match(html, /OpenFreeMap/);
assert.match(html, /maplibre-gl@6\.17\.0/);
assert.match(html, /worker-src blob: data:/, 'Research worker CSP must permit opaque-origin data workers');
assert.match(betaHtml, /worker-src blob: data:/, 'Public launcher CSP must permit sandboxed MapLibre worker');
assert.match(js, /maplibre-gl@6\.17\.0/, 'Map module must match pinned sandbox-compatible version');
assert.match(js, /Map rendering did not finish/, 'Stalled worker must show an accessible failure');
assert.match(js, /assertMapDataCompatibility/);
assert.match(js, /RIDER_MAPS_RELEASED !== false/);
assert.match(js, /map\.on\('style\.load',/);
assert.match(js, /!map\.isStyleLoaded\(\)/, 'Synthetic overlay must wait until the basemap style loads');
assert.match(js, /status\.dataset\.loadState === 'loaded'/, 'Map controls must not mask loading or failure diagnostics');
assert.match(js, /addDemoOverlay\(\)/);
assert.match(html, /not road-matched/);
assert.doesNotMatch(html + js + css, /googleapis\.com|google\.maps|maps\.google\.com/i, 'The experimental map must not fetch Google Maps content');
assert.doesNotMatch(html + js, /getCurrentPosition|watchPosition|localStorage|sessionStorage/, 'The map lab must not collect or persist rider positions');
console.log('Rider Comms Maps: isolated prototype, synthetic overlay, open-route provenance and provider guards validated.');
