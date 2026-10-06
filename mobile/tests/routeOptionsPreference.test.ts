import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROUTE_AVOIDANCE, parseRouteAvoidance, routeAvoidanceStorageKey } from '../src/routeOptionsPreference.ts';

describe('route options preference', () => {
  it('defaults to the fastest route', () => {
    assert.deepEqual(parseRouteAvoidance(null), DEFAULT_ROUTE_AVOIDANCE);
    assert.deepEqual(DEFAULT_ROUTE_AVOIDANCE, { highways: false, tolls: false });
  });

  it('reads stored options and ignores anything malformed', () => {
    assert.deepEqual(parseRouteAvoidance('{"highways":true,"tolls":false}'), { highways: true, tolls: false });
    assert.deepEqual(parseRouteAvoidance('{"highways":"yes","tolls":true}'), { highways: false, tolls: true });
    assert.deepEqual(parseRouteAvoidance('not json'), DEFAULT_ROUTE_AVOIDANCE);
    assert.deepEqual(parseRouteAvoidance('null'), DEFAULT_ROUTE_AVOIDANCE);
  });

  it('stores options per rider', () => {
    assert.notEqual(routeAvoidanceStorageKey('a'), routeAvoidanceStorageKey('b'));
  });
});
