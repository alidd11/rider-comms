import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURATED_ROUTES, ROUTE_CATEGORIES, routeMatchesCategory, routeMatchesVehicle } from '../src/routes/curatedRoutes.ts';
import {
  DEFAULT_RIDER_VEHICLE,
  RIDER_VEHICLE_GROUPS,
  RIDER_VEHICLE_OPTIONS,
  parseRiderVehicle,
  riderVehicleLabel,
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
  assert.equal(parseRiderVehicle('car'), 'car');
  assert.equal(parseRiderVehicle('van'), 'van');
  assert.equal(parseRiderVehicle('bicycle'), 'motorcycle_large');
  assert.equal(parseRiderVehicle(null), 'motorcycle_large');
  assert.deepEqual(RIDER_VEHICLE_OPTIONS.map(([vehicle]) => vehicle), ['motorcycle_large', 'motorcycle_small', 'scooter', 'car', 'van']);
  assert.deepEqual(RIDER_VEHICLE_GROUPS, ['Motorcycles', 'Cars and vans']);
  assert.ok(RIDER_VEHICLE_OPTIONS.every(([, , group]) => RIDER_VEHICLE_GROUPS.includes(group)));
  assert.equal(riderVehicleLabel('car'), 'Car');
  assert.equal(riderVehicleLabel('nope' as never), '');
  assert.equal(riderVehicleStorageKey('r1'), '@rider-comms/settings/vehicle/r1');
});

test('routes suit only the vehicles they were reviewed for', () => {
  const count = (vehicle: (typeof RIDER_VEHICLE_OPTIONS)[number][0]) => CURATED_ROUTES.filter((route) => routeMatchesVehicle(route, vehicle)).length;
  assert.equal(count('motorcycle_large'), CURATED_ROUTES.length);
  assert.equal(count('car'), CURATED_ROUTES.length);
  assert.ok(count('scooter') > 0);
  assert.ok(count('scooter') < CURATED_ROUTES.length);
  // No route has been checked for vans or motorhomes yet; Routes says so.
  assert.equal(count('van'), 0);
});

test('route types come from each route\'s road type and difficulty', () => {
  assert.deepEqual(ROUTE_CATEGORIES.map(({ value }) => value), ['all', 'coastal', 'mountain', 'countryside', 'relaxed', 'challenging', 'near']);
  const ids = (category: (typeof ROUTE_CATEGORIES)[number]['value']) => CURATED_ROUTES.filter((route) => routeMatchesCategory(route, category)).map((route) => route.id);
  assert.equal(ids('all').length, CURATED_ROUTES.length);
  assert.equal(ids('near').length, CURATED_ROUTES.length);
  assert.ok(ids('coastal').includes('causeway-coast'));
  assert.ok(!ids('coastal').includes('a82-glencoe'));
  assert.ok(ids('mountain').includes('a82-glencoe'));
  assert.ok(ids('countryside').includes('glyndwrs-way'));
  assert.ok(ids('countryside').includes('surrey-hills-circuit'));
  // Relaxed and Challenging split the catalogue between them.
  assert.equal(ids('relaxed').length + ids('challenging').length, CURATED_ROUTES.length);
  assert.ok(ids('challenging').includes('snowroads'));
  // Every type has something in it.
  for (const { value } of ROUTE_CATEGORIES) assert.ok(ids(value).length > 0, value);
});
