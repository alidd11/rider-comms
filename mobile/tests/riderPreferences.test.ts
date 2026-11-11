import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURATED_ROUTES, routeMatchesVehicle } from '../src/routes/curatedRoutes.ts';
import {
  DEFAULT_RIDER_VEHICLE,
  RIDER_VEHICLE_OPTIONS,
  parseRiderVehicle,
  parseSpokenDirections,
  riderVehicleStorageKey,
  spokenDirectionsStorageKey,
} from '../src/riderPreferences.ts';

test('spoken directions default on and only an explicit false turns them off', () => {
  assert.equal(parseSpokenDirections(null), true);
  assert.equal(parseSpokenDirections('true'), true);
  assert.equal(parseSpokenDirections('false'), false);
  assert.equal(spokenDirectionsStorageKey('r1'), '@rider-comms/settings/spoken-directions/r1');
});

test('vehicle type falls back to a motorcycle for anything unknown', () => {
  assert.equal(DEFAULT_RIDER_VEHICLE, 'motorcycle_large');
  assert.equal(parseRiderVehicle('scooter'), 'scooter');
  assert.equal(parseRiderVehicle('car'), 'motorcycle_large');
  assert.equal(parseRiderVehicle(null), 'motorcycle_large');
  assert.deepEqual(RIDER_VEHICLE_OPTIONS.map(([vehicle]) => vehicle), ['motorcycle_large', 'motorcycle_small', 'scooter']);
  assert.equal(riderVehicleStorageKey('r1'), '@rider-comms/settings/vehicle/r1');
});

test('every vehicle choice leaves routes to ride, and scooters see fewer', () => {
  const count = (vehicle: (typeof RIDER_VEHICLE_OPTIONS)[number][0]) => CURATED_ROUTES.filter((route) => routeMatchesVehicle(route, vehicle)).length;
  assert.equal(count('motorcycle_large'), CURATED_ROUTES.length);
  assert.ok(count('scooter') > 0);
  assert.ok(count('scooter') < CURATED_ROUTES.length);
});
