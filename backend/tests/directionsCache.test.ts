import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DirectionsCache, wrapDirectionsProviderWithCache } from '../src/directionsCache.ts';
import type { DrivingRoute } from '../src/directionsProvider.ts';

const origin = { lat: 51.5, lon: -0.1 };
const destination = { lat: 51.51, lon: -0.11 };
const route: DrivingRoute = {
  coordinates: [origin, destination],
  steps: [{
    instruction: 'Turn left onto A1',
    distanceMeters: 1200,
    durationSeconds: 300,
    start: origin,
    end: destination,
    coordinates: [origin, destination],
  }],
  distanceMeters: 1200,
  durationSeconds: 300,
};

describe('DirectionsCache', () => {
  it('serves a cache hit for the same coordinates rounded to ~11m', () => {
    const cache = new DirectionsCache();
    cache.set(origin, destination, route, 0);
    assert.deepEqual(
      cache.get({ lat: origin.lat + 0.00001, lon: origin.lon - 0.00001 }, destination, 1000),
      route,
    );
  });

  it('misses for a genuinely different destination', () => {
    const cache = new DirectionsCache();
    cache.set(origin, destination, route, 0);
    assert.equal(cache.get(origin, { lat: 52, lon: -0.2 }, 1000), null);
  });

  it('expires entries after the configured TTL', () => {
    const cache = new DirectionsCache(60_000);
    cache.set(origin, destination, route, 0);
    assert.deepEqual(cache.get(origin, destination, 59_999), route);
    assert.equal(cache.get(origin, destination, 60_000), null);
  });

  it('evicts the oldest entry once at capacity', () => {
    const cache = new DirectionsCache(60_000, 2);
    cache.set({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }, route, 0);
    cache.set({ lat: 2, lon: 2 }, { lat: 2, lon: 2 }, route, 0);
    cache.set({ lat: 3, lon: 3 }, { lat: 3, lon: 3 }, route, 0);
    assert.equal(cache.get({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }, 0), null);
    assert.deepEqual(cache.get({ lat: 2, lon: 2 }, { lat: 2, lon: 2 }, 0), route);
    assert.deepEqual(cache.get({ lat: 3, lon: 3 }, { lat: 3, lon: 3 }, 0), route);
  });
});

describe('wrapDirectionsProviderWithCache', () => {
  it('only calls the wrapped provider once for a repeated request', async () => {
    let calls = 0;
    const cache = new DirectionsCache();
    const wrapped = wrapDirectionsProviderWithCache(async () => {
      calls += 1;
      return route;
    }, cache);

    assert.deepEqual(await wrapped(origin, destination), route);
    assert.deepEqual(await wrapped(origin, destination), route);
    assert.equal(calls, 1);
  });

  it('does not cache a failed provider call', async () => {
    let calls = 0;
    const cache = new DirectionsCache();
    const wrapped = wrapDirectionsProviderWithCache(async () => {
      calls += 1;
      throw new Error('upstream failure');
    }, cache);

    await assert.rejects(wrapped(origin, destination));
    await assert.rejects(wrapped(origin, destination));
    assert.equal(calls, 2);
  });
});
