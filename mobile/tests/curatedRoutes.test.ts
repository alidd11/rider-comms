import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CURATED_ROUTES,
  googleMapsDirectionsUrl,
  routeMatchesVehicle,
} from '../src/routes/curatedRoutes.ts';

const CONDITIONS_HOSTS = new Set([
  'one.network',
  'traffic.wales',
  'www.traffic.gov.scot',
  'www.trafficwatchni.com',
]);

function haversineMiles(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const radiusMiles = 3958.7613;
  const toRadians = (value: number) => value * Math.PI / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusMiles * Math.asin(Math.min(1, Math.sqrt(h)));
}

describe('curated route catalogue', () => {
  it('has unique, fully attributed records suitable for road motorcycles', () => {
    assert.equal(new Set(CURATED_ROUTES.map((route) => route.id)).size, CURATED_ROUTES.length);
    assert.equal(new Set(CURATED_ROUTES.map((route) => route.name)).size, CURATED_ROUTES.length);
    assert.ok(CURATED_ROUTES.length >= 20);

    for (const route of CURATED_ROUTES) {
      assert.ok(route.vehicleSuitability.includes('motorcycle_small'));
      assert.ok(route.vehicleSuitability.includes('motorcycle_large'));
      assert.ok(route.vehicleSuitability.includes('car'));
      assert.match(route.routeSourceUrl, /^https:\/\//);
      assert.equal(new URL(route.routeSourceUrl).hostname.includes('wikipedia.org'), false);
      assert.match(route.conditionsUrl, /^https:\/\//);
      assert.ok(CONDITIONS_HOSTS.has(new URL(route.conditionsUrl).hostname));
      assert.match(route.reviewedAt, /^2026-\d{2}-\d{2}$/);
      assert.match(route.image.uri, /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//);
      assert.equal(route.image.uri.includes('Special:FilePath'), false);
      assert.match(route.image.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      assert.match(route.image.licenseUrl, /^https:\/\/creativecommons\.org\//);
      assert.ok(route.image.author.trim().length > 0);
      assert.ok(route.image.alt.trim().length > 0);
      assert.ok(route.safetyNotices.length >= 2);
      assert.ok(route.highlights.length >= 2);
      assert.ok(route.waypoints.length >= 1);
      assert.ok(route.distanceMiles > 0);
      assert.ok(route.estimatedDurationMinutes > 0);
    }
  });

  it('keeps every curated coordinate inside a plausible UK and Northern Ireland envelope', () => {
    for (const route of CURATED_ROUTES) {
      for (const point of [route.start, ...route.waypoints, route.end]) {
        assert.ok(point.lat >= 49.5 && point.lat <= 61, `${route.id}: latitude ${point.lat}`);
        assert.ok(point.lon >= -8.5 && point.lon <= 2.2, `${route.id}: longitude ${point.lon}`);
        assert.ok(point.label.trim().length > 0, `${route.id}: coordinate is missing a label`);
      }
    }
  });

  it('keeps ordered route points close enough to guard against misplaced or misordered waypoints', () => {
    for (const route of CURATED_ROUTES) {
      const points = [route.start, ...route.waypoints, route.end];
      for (let index = 1; index < points.length; index += 1) {
        const gap = haversineMiles(points[index - 1], points[index]);
        assert.ok(
          gap < 45,
          `${route.id}: ${points[index - 1].label} -> ${points[index].label} jumps ${gap.toFixed(1)} miles straight-line`,
        );
      }
    }
  });

  it('keeps editorial timing within a plausible scenic-road planning range', () => {
    for (const route of CURATED_ROUTES) {
      const minutesPerMile = route.estimatedDurationMinutes / route.distanceMiles;
      assert.ok(minutesPerMile >= 1.25, `${route.id}: timing is implausibly fast`);
      assert.ok(minutesPerMile <= 3.5, `${route.id}: timing is implausibly slow`);
    }
  });

  it('keeps the PWA and native curated route data in 1:1 parity', () => {
    const pwaSource = readFileSync(new URL('../../docs/routes.js', import.meta.url), 'utf8');
    const match = pwaSource.match(/const routes = (\[[\s\S]*?\]);\n\n  const labels/);
    assert.ok(match, 'PWA curated route data block was not found');
    const pwaRoutes = JSON.parse(match[1]);

    const nativeComparable = CURATED_ROUTES.map((route) => ({
      id: route.id,
      name: route.name,
      region: route.region,
      road: route.road,
      distance: route.distanceMiles,
      minutes: route.estimatedDurationMinutes,
      difficulty: route.difficulty,
      roadType: route.roadType,
      description: route.description,
      note: route.riderNote,
      vehicleSuitability: route.vehicleSuitability,
      highlights: route.highlights,
      safety: route.safetyNotices,
      start: [route.start.lat, route.start.lon],
      end: [route.end.lat, route.end.lon],
      waypoints: route.waypoints.map(({ lat, lon }) => [lat, lon]),
      image: route.image.uri,
      alt: route.image.alt,
      imageAuthor: route.image.author,
      imageLicenseName: route.image.licenseName,
      source: route.image.sourceUrl,
      license: route.image.licenseUrl,
      conditions: route.conditionsUrl,
      routeSource: route.routeSourceUrl,
      reviewedAt: route.reviewedAt,
    }));

    const pwaComparable = pwaRoutes.map((route: Record<string, unknown>) => ({
      ...route,
      difficulty: String(route.difficulty).toLowerCase(),
      roadType: String(route.roadType).toLowerCase(),
      credit: undefined,
    })).map(({ credit: _credit, ...route }: Record<string, unknown>) => route);

    assert.deepEqual(pwaComparable, nativeComparable);
  });

  it('filters without mutating the catalogue', () => {
    const before = [...CURATED_ROUTES];
    const matching = CURATED_ROUTES.filter((route) => routeMatchesVehicle(route, 'scooter'));
    assert.ok(matching.length > 0);
    assert.deepEqual(CURATED_ROUTES, before);
    assert.ok(CURATED_ROUTES.every((route) => routeMatchesVehicle(route, null)));
  });

  it('builds a maps URL containing endpoints and ordered waypoints', () => {
    const route = CURATED_ROUTES.find((item) => item.id === 'snowroads');
    assert.ok(route);
    const url = new URL(googleMapsDirectionsUrl(route));
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/dir/');
    assert.equal(url.searchParams.get('origin'), `${route.start.lat},${route.start.lon}`);
    assert.equal(url.searchParams.get('destination'), `${route.end.lat},${route.end.lon}`);
    assert.equal(url.searchParams.get('waypoints'), route.waypoints.map(({ lat, lon }) => `${lat},${lon}`).join('|'));
  });
});
