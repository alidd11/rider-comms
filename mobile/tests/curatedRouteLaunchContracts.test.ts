import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CURATED_ROUTES,
  googleMapsDirectionsUrl,
  routeMatchesVehicle,
  routeMatchesCategory,
  ROUTE_CATEGORIES,
} from '../src/routes/curatedRoutes.ts';

const PRIMARY_VEHICLES = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'] as const;

/** Guardrails for the route data handed to the future multi-stop navigator.
 * These tests do not claim that an actual provider route has been checked. */
describe('curated route launch contracts', () => {
  it('keeps motorcycle, scooter and car discovery supported as first-class audiences', () => {
    for (const vehicle of PRIMARY_VEHICLES) {
      const available = CURATED_ROUTES.filter((route) => routeMatchesVehicle(route, vehicle));
      assert.ok(available.length > 0, `no reviewed rides for ${vehicle}`);
      for (const route of available) {
        assert.ok(route.vehicleSuitability.includes(vehicle), `${route.id}: incorrect ${vehicle} suitability`);
      }
    }
    // Motorways and gradients can make an otherwise appropriate car/bike
    // route unsuitable for smaller scooters. Do not silently broaden it.
    const scooterExclusions = CURATED_ROUTES.filter((route) => !routeMatchesVehicle(route, 'scooter'));
    assert.ok(scooterExclusions.length > 0, 'scooter-specific exclusions must remain visible in the dataset');
    assert.ok(CURATED_ROUTES.every((route) => routeMatchesVehicle(route, null)), 'unset vehicle must not hide all routes');
  });

  it('keeps every advertised discovery category functional', () => {
    for (const category of ROUTE_CATEGORIES) {
      const matching = CURATED_ROUTES.filter((route) => routeMatchesCategory(route, category.value));
      assert.ok(matching.length > 0, `empty category: ${category.value}`);
    }
  });

  it('keeps all itineraries within the backend waypoint capacity', () => {
    for (const route of CURATED_ROUTES) {
      assert.ok(route.waypoints.length >= 1 && route.waypoints.length <= 20, `${route.id}: waypoint count not supported`);
      const points = [route.start, ...route.waypoints, route.end];
      for (const point of points) {
        assert.ok(Number.isFinite(point.lat) && Number.isFinite(point.lon), `${route.id}: invalid itinerary point`);
        assert.ok(point.label.trim(), `${route.id}: unnamed itinerary point`);
      }
    }
  });

  it('preserves the complete ordered itinerary in the external-preview URL', () => {
    for (const route of CURATED_ROUTES) {
      const url = new URL(googleMapsDirectionsUrl(route));
      assert.equal(url.searchParams.get('origin'), `${route.start.lat},${route.start.lon}`, route.id);
      assert.equal(url.searchParams.get('destination'), `${route.end.lat},${route.end.lon}`, route.id);
      assert.equal(
        url.searchParams.get('waypoints'),
        route.waypoints.map((point) => `${point.lat},${point.lon}`).join('|'),
        `${route.id}: ordered stops changed in external preview`,
      );
    }
  });
});
