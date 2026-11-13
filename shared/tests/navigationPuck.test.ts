import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNavigationPathIndex,
  matchFixToPath,
  navigationFixAgeSeconds,
  navigationPathPointAt,
  predictNavigationPuck,
  type PuckCoordinate,
} from '../src/navigationPuck.ts';

const M_PER_DEG_LAT = 111_195;
const ORIGIN = { lat: 51.5, lon: -0.12 };
const mPerDegLon = M_PER_DEG_LAT * Math.cos(ORIGIN.lat * Math.PI / 180);
/** Local metres (east, north) to a coordinate near ORIGIN. */
const at = (east: number, north: number): PuckCoordinate => ({
  lat: ORIGIN.lat + north / M_PER_DEG_LAT,
  lon: ORIGIN.lon + east / mPerDegLon,
});
const toLocal = (point: PuckCoordinate) => ({
  east: (point.lon - ORIGIN.lon) * mPerDegLon,
  north: (point.lat - ORIGIN.lat) * M_PER_DEG_LAT,
});
const metres = (a: PuckCoordinate, b: PuckCoordinate) => {
  const pa = toLocal(a);
  const pb = toLocal(b);
  return Math.hypot(pa.east - pb.east, pa.north - pb.north);
};

// 500 m north, a right turn, 500 m east, a left turn, 500 m north.
const ROUTE = [at(0, 0), at(0, 500), at(500, 500), at(500, 1000)];
const index = buildNavigationPathIndex(ROUTE);

test('path index measures the route', () => {
  assert.ok(Math.abs(index.totalMeters - 1500) < 1);
  const corner = navigationPathPointAt(index, 500)!;
  assert.ok(metres(corner, at(0, 500)) < 0.5);
  const along = navigationPathPointAt(index, 750)!;
  assert.ok(metres(along, at(250, 500)) < 0.5);
  assert.ok(Math.abs(along.bearingDegrees! - 90) < 0.5);
});

test('a fix beside the road snaps onto it', () => {
  const match = matchFixToPath(index, { ...at(9, 200), accuracyMeters: 10, headingDegrees: 2, speedMps: 12 });
  assert.equal(match.snapped, true);
  assert.ok(metres(match, at(0, 200)) < 0.5);
  assert.ok(Math.abs(match.distanceAlongMeters - 200) < 0.5);
  assert.ok(Math.abs(match.offsetMeters - 9) < 0.5);
});

test('a fix far from the route, or riding the wrong way, is drawn where GPS says', () => {
  const far = matchFixToPath(index, { ...at(60, 200), accuracyMeters: 8, speedMps: 12 });
  assert.equal(far.snapped, false);
  assert.ok(metres(far, at(60, 200)) < 0.01);
  const wrongWay = matchFixToPath(index, { ...at(5, 200), accuracyMeters: 8, headingDegrees: 180, speedMps: 12 });
  assert.equal(wrongWay.snapped, false);
  // Slow enough that GPS heading is noise: still snaps.
  const slow = matchFixToPath(index, { ...at(5, 200), accuracyMeters: 8, headingDegrees: 180, speedMps: 1 });
  assert.equal(slow.snapped, true);
});

test('the previous match keeps the puck on the right leg of a hairpin', () => {
  // Two parallel legs 15 m apart: up the west side, back down the east side.
  const hairpin = buildNavigationPathIndex([at(0, 0), at(0, 300), at(15, 300), at(15, 0)]);
  // Without history the closest leg wins (the east leg, 6 m away).
  const fix = { ...at(9, 100), accuracyMeters: 10, speedMps: 2 };
  assert.ok(matchFixToPath(hairpin, fix).distanceAlongMeters > 300);
  // Having just been 90 m up the west leg, it stays on the west leg.
  const continued = matchFixToPath(hairpin, fix, 90);
  assert.ok(continued.distanceAlongMeters < 120);
});

test('after a long GPS gap the puck catches up instead of sticking', () => {
  // Last matched at 100 m; the next fix (after a tunnel) is 1.2 km on.
  const match = matchFixToPath(index, { ...at(500, 800), accuracyMeters: 8, headingDegrees: 0, speedMps: 15 }, 100);
  assert.equal(match.snapped, true);
  assert.ok(Math.abs(match.distanceAlongMeters - 1300) < 1);
});

test('prediction carries the puck along the route, round corners', () => {
  const match = matchFixToPath(index, { ...at(0, 480), accuracyMeters: 5, headingDegrees: 0, speedMps: 20 });
  const ahead = predictNavigationPuck(index, match, 20, 1.5);
  // 30 m on from 480 m: round the corner, 10 m along the eastbound leg.
  assert.ok(metres(ahead, at(10, 500)) < 0.5);
  assert.ok(Math.abs(ahead.bearingDegrees! - 90) < 0.5);
});

test('prediction is capped and unsnapped fixes follow the GPS heading', () => {
  const match = matchFixToPath(index, { ...at(0, 100), accuracyMeters: 5, speedMps: 40 });
  const capped = predictNavigationPuck(index, match, 40, 10);
  assert.ok(Math.abs(toLocal(capped).north - 160) < 0.5);
  const offRoute = matchFixToPath(index, { ...at(100, 100), accuracyMeters: 5, headingDegrees: 90, speedMps: 10 });
  const predicted = predictNavigationPuck(index, offRoute, 10, 1);
  assert.ok(metres(predicted, at(110, 100)) < 0.5);
  assert.equal(navigationFixAgeSeconds(1_000, 1_800), 0.8);
  assert.equal(navigationFixAgeSeconds(1_000, 60_000), 2.5);
  assert.equal(navigationFixAgeSeconds(5_000, 1_000), 0);
  assert.equal(navigationFixAgeSeconds(undefined, 1_000), 0);
});

test('replayed ride: the puck sits much closer to the rider than raw GPS', () => {
  // A rider at 13.4 m/s (30 mph) with a GPS fix each second that is 1 s old
  // on arrival and up to 12 m off to the side. Deterministic noise.
  const speed = 13.4;
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };
  let rawError = 0;
  let puckError = 0;
  let samples = 0;
  let previousAlong: number | null = null;
  for (let second = 2; second < 100; second += 1) {
    const truthNow = navigationPathPointAt(index, speed * second)!;
    const fixTruth = navigationPathPointAt(index, speed * (second - 1))!;
    const bearing = fixTruth.bearingDegrees! * Math.PI / 180;
    const sideways = noise() * 12;
    const local = toLocal(fixTruth);
    const raw = at(local.east + Math.cos(bearing) * sideways, local.north - Math.sin(bearing) * sideways);
    const match = matchFixToPath(index, {
      ...raw,
      accuracyMeters: 10,
      headingDegrees: fixTruth.bearingDegrees! + noise() * 15,
      speedMps: speed,
    }, previousAlong);
    previousAlong = match.distanceAlongMeters;
    const puck = predictNavigationPuck(index, match, speed, 1);
    rawError += metres(raw, truthNow);
    puckError += metres(puck, truthNow);
    samples += 1;
  }
  rawError /= samples;
  puckError /= samples;
  assert.ok(rawError > 12, `raw GPS error ${rawError.toFixed(1)} m`);
  assert.ok(puckError < 2, `puck error ${puckError.toFixed(1)} m`);
  if (process.env.PUCK_REPORT) console.log(`raw ${rawError.toFixed(1)} m, puck ${puckError.toFixed(1)} m`);
});

test('off-route needs a confident fix away from both the current and next step', async () => {
  const { navigationRouteStatus, NAV_OFF_ROUTE_RADIUS_M } = await import('../src/navigationPuck.ts');
  assert.equal(navigationRouteStatus(20, 200, 8), 'on');
  assert.equal(navigationRouteStatus(NAV_OFF_ROUTE_RADIUS_M + 1, null, 8), 'off');
  // Already turned at the junction: far from this step, on the next one.
  assert.equal(navigationRouteStatus(90, 12, 8), 'on');
  // A tunnel or urban-canyon fix can't decide either way.
  assert.equal(navigationRouteStatus(140, 140, 85), 'unknown');
  // No accuracy reported: judge on distance alone.
  assert.equal(navigationRouteStatus(140, Number.NaN, undefined), 'off');
});
