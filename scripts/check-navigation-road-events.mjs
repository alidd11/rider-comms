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
);
assert.deepEqual(alerts.map((alert) => alert.hazard.id), ['near-police', 'far-camera']);
assert.equal(pwa.NAVIGATION_ALERT_MAX_VISIBLE, 2);
assert.equal(pwa.navigationHazardLabel('camera'), 'Speed camera reported');
assert.equal(pwa.navigationHazardLabel('police'), 'Police reported');

const nativeSource = await readFile(new URL('../mobile/src/navigationRoadEvents.ts', import.meta.url), 'utf8');
for (const [name, value] of [
  ['NAVIGATION_ALERT_ROUTE_CORRIDOR_METERS', 70],
  ['NAVIGATION_ALERT_LOOKAHEAD_METERS', '3_000'],
  ['NAVIGATION_ALERT_PASSED_GRACE_METERS', 25],
  ['NAVIGATION_ALERT_CURRENT_ROUTE_TOLERANCE_METERS', 120],
  ['NAVIGATION_ALERT_MAX_VISIBLE', 2],
]) {
  assert.match(
    nativeSource,
    new RegExp(`export const ${name} = ${String(value).replace('_', '\\_')}`),
    `native and PWA must keep ${name} aligned`,
  );
}
for (const phrase of ['Speed camera reported', 'Police reported', 'Accident reported', 'Road closure reported', 'Road hazard reported']) {
  assert.ok(nativeSource.includes(phrase), `native route-ahead labels must include ${phrase}`);
}

console.log('Navigation road-ahead parity core valid');
