import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readNativeMapScreenSource } from './native-map-screen-source.mjs';

await import('../docs/navigation-road-events.js');

const pwa = globalThis.RiderNavigationRoadEvents;
assert.ok(pwa, 'PWA route-ahead helper must expose RiderNavigationRoadEvents');

const route = [
  { lat: 51.5000, lng: -0.1000 },
  { lat: 51.5100, lng: -0.1000 },
];
const hazard = (id, type, lat, lon = -0.1000) => ({
  id,
  type,
  lat,
  lon,
  reportedBy: 'test-rider',
  createdAt: 1,
  expiresAt: Number.MAX_SAFE_INTEGER,
  confirmations: 0,
  denials: 0,
});

const alerts = pwa.navigationHazardsAhead(
  { lat: 51.5020, lng: -0.1000 },
  route,
  [
    hazard('far-camera', 'camera', 51.5070),
    hazard('near-police', 'police', 51.5040),
    hazard('parallel-road', 'accident', 51.5050, -0.0988),
    hazard('behind', 'road_closure', 51.5010),
  ],
  { currentAccuracyMeters: 10 },
);
assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['near-police', 'far-camera']);
assert.equal(pwa.NAVIGATION_ALERT_MAX_VISIBLE, 2);
assert.equal(pwa.NAVIGATION_ALERT_MAX_LOCATION_ACCURACY_METERS, 75);
assert.equal(pwa.NAVIGATION_ALERT_DUPLICATE_ROUTE_GAP_METERS, 80);
assert.deepEqual(pwa.navigationHazardsAhead(
  { lat: 51.5020, lng: -0.1000 },
  route,
  [hazard('accuracy-camera', 'camera', 51.5040)],
  { currentAccuracyMeters: 76 },
), []);
assert.deepEqual(pwa.navigationHazardsAhead(
  { lat: 51.5020, lng: -0.1000 },
  route,
  [hazard('missing-accuracy-camera', 'camera', 51.5040)],
  { currentAccuracyMeters: null },
), []);
const dedupedAlerts = pwa.navigationHazardsAhead(
  { lat: 51.5020, lng: -0.1000 },
  route,
  [
    hazard('police-first', 'police', 51.5040),
    hazard('police-duplicate', 'police', 51.5044),
    hazard('camera-separate', 'camera', 51.5060),
  ],
  { currentAccuracyMeters: 10, duplicateRouteGapMeters: 80 },
);
assert.deepEqual(dedupedAlerts.map((alert) => alert.hazard.id), ['police-first', 'camera-separate']);

const prioritisedAlerts = pwa.navigationHazardsAhead(
  { lat: 51.5010, lng: -0.1000 },
  route,
  [
    hazard('camera-nearest', 'camera', 51.5020),
    hazard('police-second', 'police', 51.5030),
    hazard('closure-third', 'road_closure', 51.5060),
  ],
  { currentAccuracyMeters: 10 },
);
assert.deepEqual(prioritisedAlerts.map((alert) => alert.hazard.id), ['camera-nearest', 'closure-third']);

assert.equal(pwa.navigationHazardLabel('camera'), 'Mobile speed camera reported');
assert.equal(pwa.navigationHazardLabel('police'), 'Police reported');
assert.equal(pwa.navigationHazardLabel('hidden_police'), 'Hidden police reported');
assert.equal(pwa.navigationHazardLabel('police_checkpoint'), 'Police checkpoint reported');

const newTypeAlerts = pwa.navigationHazardsAhead(
  { lat: 51.5020, lng: -0.1000 },
  route,
  [
    hazard('hidden-police-ahead', 'hidden_police', 51.5040),
    hazard('checkpoint-ahead', 'police_checkpoint', 51.5060),
  ],
  { currentAccuracyMeters: 10 },
);
assert.deepEqual(
  newTypeAlerts.map((alert) => alert.hazard.id),
  ['hidden-police-ahead', 'checkpoint-ahead'],
  'new police-presence types must not be fail-closed as unknown report types',
);

const nowMs = 10_000;
const staleAlerts = pwa.navigationHazardsAhead(
  { lat: 51.5020, lng: -0.1000 },
  route,
  [
    { ...hazard('expired', 'camera', 51.5040), expiresAt: nowMs },
    { ...hazard('crowd-hidden', 'police', 51.5050), expiresAt: nowMs + 60_000, denials: 3 },
    { ...hazard('active', 'accident', 51.5060), expiresAt: nowMs + 60_000, denials: 3, confirmations: 1 },
    { ...hazard('unknown', 'camera', 51.5070), type: 'unknown_report', expiresAt: nowMs + 60_000 },
  ],
  { nowMs, currentAccuracyMeters: 10 },
);
assert.deepEqual(staleAlerts.map((alert) => alert.hazard.id), ['active']);

const [nativeSource, nativeMapScreenSource, nativeNavigationSummarySource, pwaAppSource, sharedHazardSource] = await Promise.all([
  readFile(new URL('../mobile/src/navigationRoadEvents.ts', import.meta.url), 'utf8'),
  readNativeMapScreenSource(),
  readFile(new URL('../mobile/src/screens/useNavigationSummary.ts', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../shared/src/hazards.ts', import.meta.url), 'utf8'),
]);
// MapScreen.tsx delegates the road-ahead-alert derivation to
// useNavigationSummary.ts -- checked together since the assertion below
// doesn't care which file a given literal lives in.
const nativeMapSource = nativeMapScreenSource + nativeNavigationSummarySource;
for (const [name, value] of [
  ['NAVIGATION_ALERT_ROUTE_CORRIDOR_METERS', 70],
  ['NAVIGATION_ALERT_LOOKAHEAD_METERS', '3_000'],
  ['NAVIGATION_ALERT_PASSED_GRACE_METERS', 25],
  ['NAVIGATION_ALERT_CURRENT_ROUTE_TOLERANCE_METERS', 120],
  ['NAVIGATION_ALERT_MAX_VISIBLE', 2],
  ['NAVIGATION_ALERT_MAX_LOCATION_ACCURACY_METERS', 75],
  ['NAVIGATION_ALERT_DUPLICATE_ROUTE_GAP_METERS', 80],
]) {
  assert.match(
    nativeSource,
    new RegExp(`export const ${name} = ${String(value).replace('_', '\\_')}`),
    `native and PWA must keep ${name} aligned`,
  );
}
const sharedHideThreshold = Number(
  sharedHazardSource.match(/export const HIDE_NET_DENIAL_THRESHOLD = (\d+)/)?.[1],
);
assert.ok(Number.isFinite(sharedHideThreshold), 'shared crowd-hide threshold must remain discoverable');
assert.equal(
  pwa.HIDE_NET_DENIAL_THRESHOLD,
  sharedHideThreshold,
  'PWA road-ahead selector must match the shared crowd-hide threshold',
);
assert.match(nativeSource, /HIDE_NET_DENIAL_THRESHOLD/, 'native route-ahead selector must reuse the shared crowd-hide threshold');
assert.match(nativeSource, /hazard\.expiresAt > nowMs/, 'native route-ahead selector must suppress expired reports before the next poll');

for (const phrase of ['Mobile speed camera reported', 'Police reported', 'Hidden police reported', 'Police checkpoint reported', 'Accident reported', 'Road closure reported']) {
  assert.ok(nativeSource.includes(phrase), `native route-ahead labels must include ${phrase}`);
}

assert.match(
  nativeMapScreenSource,
  /currentLocationAccuracyRef\.current,\s*\);/,
  'native road-ahead alerts must pass the OS-reported GPS accuracy into useNavigationSummary',
);
assert.match(
  nativeNavigationSummarySource,
  /currentAccuracyMeters,\s*\}\)/,
  'native road-ahead alerts must consume the OS-reported GPS accuracy',
);
assert.match(
  pwaAppSource,
  /currentAccuracyMeters: navCurrentAccuracyMeters/,
  'PWA road-ahead alerts must consume browser geolocation accuracy',
);
assert.match(
  nativeMapSource,
  /activeRoute && currentLocation && !isNavigationGpsNotice\(navigationNotice\)/,
  'native road-ahead alerts must fail closed while navigation GPS is unusable',
);
assert.match(
  pwaAppSource,
  /!navSteps\.length \|\| !navCurrentPosition \|\| navGpsIssue/,
  'PWA road-ahead alerts must fail closed while navigation GPS is unusable',
);
assert.match(
  pwaAppSource,
  /renderNavSpeed\(\);\s*renderNavigationRoadAhead\(\);\s*setNavStatusNotice\(message\);/,
  'PWA GPS health changes must immediately clear road-ahead guidance',
);

// Before Start: every report along the whole way, said the same in both apps.
const wholeRoute = pwa.routeHazards(route, [
  hazard('far', 'camera', 51.5090),
  hazard('start', 'police', 51.5001),
  hazard('off-route', 'accident', 51.5050, -0.0950),
  hazard('closure', 'road_closure', 51.5060),
  hazard('police-again', 'hidden_police', 51.5040),
]);
assert.deepEqual(wholeRoute.map((item) => item.hazard.id), ['start', 'police-again', 'closure', 'far']);
assert.deepEqual(pwa.routeHazardsSummary(wholeRoute), {
  groups: [
    { type: 'road_closure', count: 1, serious: true },
    { type: 'camera', count: 1, serious: false },
    { type: 'police', count: 1, serious: false },
    { type: 'hidden_police', count: 1, serious: false },
  ],
  label: 'Reported on the way: road closure, speed camera, police, hidden police',
  serious: true,
});
assert.equal(pwa.routeHazardsSummary([]), null);
assert.deepEqual(pwa.routeHazards([], []), []);
for (const name of ['road closures', 'speed cameras', 'police reports', 'police checks', 'hidden police reports', 'Reported on the way: ']) {
  assert.ok(nativeSource.includes(name), `native and PWA route hazard words must both say "${name}"`);
}

// The line, as in Waze: the same points and merging in both apps.
const strip = pwa.routeHazardStrip(wholeRoute, route);
assert.deepEqual(strip.map(({ type, count, serious }) => ({ type, count, serious })), [
  { type: 'police', count: 1, serious: false },
  { type: 'hidden_police', count: 1, serious: false },
  { type: 'road_closure', count: 1, serious: true },
  { type: 'camera', count: 1, serious: false },
]);
assert.deepEqual(strip.map(({ at }) => Math.round(at * 100)), [1, 40, 60, 90]);
// A wider gap merges them under the most serious, with the count.
assert.deepEqual(pwa.routeHazardStrip(wholeRoute, route, 1).map(({ type, count, serious }) => ({ type, count, serious })), [
  { type: 'road_closure', count: 4, serious: true },
]);
assert.equal(pwa.ROUTE_HAZARD_STRIP_GAP, 0.1);
assert.match(nativeSource, /export const ROUTE_HAZARD_STRIP_GAP = 0\.1;/, 'native and PWA must merge nearby reports at the same gap');
assert.deepEqual(pwa.routeHazardStrip([], route), []);
assert.deepEqual(pwa.routeHazardStrip(wholeRoute, []), []);

// Cutting a route line for the server: the same points in both apps.
{
  const winding = Array.from({ length: 3000 }, (_, i) => ({ lat: 51.5 + i * 0.0001, lng: -0.1 + Math.sin(i / 10) * 0.002 }));
  const cut = pwa.simplifyRoutePath(winding);
  assert.ok(cut.length <= pwa.ROUTE_PATH_MAX_POINTS && cut.length > 50);
  const { simplifyRoutePath } = await import('../mobile/src/navigationRoadEvents.ts');
  const native = simplifyRoutePath(winding.map(({ lat, lng }) => ({ lat, lon: lng })));
  assert.deepEqual(cut.map(({ lat, lng }) => ({ lat, lon: lng })), native);
  assert.equal(pwa.ROUTE_PATH_MAX_POINTS, 400);
}

console.log('Navigation road-ahead parity core valid');
