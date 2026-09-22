import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
    hazard('parallel-road', 'hazard', 51.5050, -0.0988),
    hazard('behind', 'road_closure', 51.5010),
  ],
  { currentAccuracyMeters: 10 },
);
assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['near-police', 'far-camera']);
assert.equal(pwa.NAVIGATION_ALERT_MAX_VISIBLE, 2);
assert.equal(pwa.NAVIGATION_ALERT_MAX_LOCATION_ACCURACY_METERS, 75);
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
assert.equal(pwa.navigationHazardLabel('hazard'), 'Pothole reported');

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
    { ...hazard('unknown', 'hazard', 51.5070), type: 'unknown_report', expiresAt: nowMs + 60_000 },
  ],
  { nowMs, currentAccuracyMeters: 10 },
);
assert.deepEqual(staleAlerts.map((alert) => alert.hazard.id), ['active']);

const [nativeSource, nativeMapSource, pwaAppSource, sharedHazardSource] = await Promise.all([
  readFile(new URL('../mobile/src/navigationRoadEvents.ts', import.meta.url), 'utf8'),
  readFile(new URL('../mobile/src/screens/MapScreen.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../docs/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../shared/src/hazards.ts', import.meta.url), 'utf8'),
]);
for (const [name, value] of [
  ['NAVIGATION_ALERT_ROUTE_CORRIDOR_METERS', 70],
  ['NAVIGATION_ALERT_LOOKAHEAD_METERS', '3_000'],
  ['NAVIGATION_ALERT_PASSED_GRACE_METERS', 25],
  ['NAVIGATION_ALERT_CURRENT_ROUTE_TOLERANCE_METERS', 120],
  ['NAVIGATION_ALERT_MAX_VISIBLE', 2],
  ['NAVIGATION_ALERT_MAX_LOCATION_ACCURACY_METERS', 75],
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

for (const phrase of ['Mobile speed camera reported', 'Police reported', 'Hidden police reported', 'Police checkpoint reported', 'Accident reported', 'Road closure reported', 'Pothole reported']) {
  assert.ok(nativeSource.includes(phrase), `native route-ahead labels must include ${phrase}`);
}

assert.match(
  nativeMapSource,
  /currentAccuracyMeters: currentLocationAccuracyRef\.current/,
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

console.log('Navigation road-ahead parity core valid');
