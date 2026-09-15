import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CURATED_ROUTES,
  googleMapsDirectionsUrl,
  routeMatchesVehicle,
} from '../src/routes/curatedRoutes.ts';

describe('curated route catalogue', () => {
  it('has unique, fully attributed records suitable for road motorcycles', () => {
    assert.equal(new Set(CURATED_ROUTES.map((route) => route.id)).size, CURATED_ROUTES.length);
    assert.ok(CURATED_ROUTES.length >= 6);

    for (const route of CURATED_ROUTES) {
      assert.ok(route.vehicleSuitability.includes('motorcycle_small'));
      assert.ok(route.vehicleSuitability.includes('motorcycle_large'));
      assert.match(route.routeSourceUrl, /^https:\/\//);
      assert.match(route.conditionsUrl, /^https:\/\//);
      assert.match(route.image.uri, /^https:\/\/commons\.wikimedia\.org\//);
      assert.match(route.image.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      assert.match(route.image.licenseUrl, /^https:\/\/creativecommons\.org\//);
      assert.ok(route.image.author.length > 0);
      assert.ok(route.safetyNotices.length > 0);
      assert.ok(route.start.lat >= -90 && route.start.lat <= 90);
      assert.ok(route.start.lon >= -180 && route.start.lon <= 180);
      assert.ok(route.end.lat >= -90 && route.end.lat <= 90);
      assert.ok(route.end.lon >= -180 && route.end.lon <= 180);
    }
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
