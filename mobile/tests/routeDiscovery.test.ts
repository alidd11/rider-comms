import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CURATED_ROUTES } from '../src/routes/curatedRoutes.ts';
import {
  distanceMilesToRouteStart,
  formatApproachDistance,
  routeMatchesRideWindow,
  sortRoutesForDiscovery,
} from '../src/routes/routeDiscovery.ts';

describe('route discovery', () => {
  it('groups routes by useful ride-time windows', () => {
    const quick = CURATED_ROUTES.filter((route) => routeMatchesRideWindow(route, 'quick'));
    const halfDay = CURATED_ROUTES.filter((route) => routeMatchesRideWindow(route, 'half_day'));
    const dayTrip = CURATED_ROUTES.filter((route) => routeMatchesRideWindow(route, 'day_trip'));

    assert.ok(quick.every((route) => route.estimatedDurationMinutes < 90));
    assert.ok(halfDay.every((route) => route.estimatedDurationMinutes >= 90 && route.estimatedDurationMinutes <= 180));
    assert.ok(dayTrip.every((route) => route.estimatedDurationMinutes > 180));
    assert.equal(quick.length + halfDay.length + dayTrip.length, CURATED_ROUTES.length);
  });

  it('sorts discovery by distance to the route start when rider location is known', () => {
    const rider = { lat: 51.5074, lon: -0.1278 };
    const sorted = sortRoutesForDiscovery(CURATED_ROUTES, 'all', rider);
    const distances = sorted.map((route) => distanceMilesToRouteStart(route, rider));

    assert.deepEqual(distances, [...distances].sort((a, b) => a - b));
  });

  it('keeps editorial order when rider location is unavailable', () => {
    assert.deepEqual(sortRoutesForDiscovery(CURATED_ROUTES, 'all', null), [...CURATED_ROUTES]);
  });

  it('formats approach distance for route cards without false precision', () => {
    assert.equal(formatApproachDistance(0.05), 'Start is here');
    assert.equal(formatApproachDistance(4.24), '4.2 mi from you');
    assert.equal(formatApproachDistance(42.4), '42 mi from you');
  });
});
