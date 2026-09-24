import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  nearbySearchCacheKey,
  PlacesCache,
  textSearchCacheKey,
  wrapPlacesSearchWithCache,
} from '../src/api/placesCache.ts';
import type { PlaceSearchResult } from '../src/api/places.ts';

const near = { lat: 51.5, lon: -0.1 };
const okResult: PlaceSearchResult = {
  status: 'ok',
  places: [{ id: 'p1', name: 'Cafe', address: '1 Main St', lat: 51.5, lon: -0.1, distanceMeters: 10 }],
};

describe('PlacesCache', () => {
  it('serves a cache hit for the same query rounded to ~111m', () => {
    const cache = new PlacesCache();
    const key = textSearchCacheKey('coffee', near);
    cache.set(key, okResult, 0);
    assert.deepEqual(
      cache.get(textSearchCacheKey('coffee', { lat: near.lat + 0.0001, lon: near.lon - 0.0001 }), 1000),
      okResult,
    );
  });

  it('misses for a genuinely different query', () => {
    const cache = new PlacesCache();
    cache.set(textSearchCacheKey('coffee', near), okResult, 0);
    assert.equal(cache.get(textSearchCacheKey('petrol', near), 1000), null);
  });

  it('does not cache a non-ok result', () => {
    const cache = new PlacesCache();
    const key = textSearchCacheKey('coffee', near);
    cache.set(key, { status: 'rate-limited', places: [] }, 0);
    assert.equal(cache.get(key, 0), null);
  });

  it('expires entries after the configured TTL', () => {
    const cache = new PlacesCache(60_000);
    const key = textSearchCacheKey('coffee', near);
    cache.set(key, okResult, 0);
    assert.deepEqual(cache.get(key, 59_999), okResult);
    assert.equal(cache.get(key, 60_000), null);
  });

  it('evicts the oldest entry once at capacity', () => {
    const cache = new PlacesCache(60_000, 2);
    cache.set('a', okResult, 0);
    cache.set('b', okResult, 0);
    cache.set('c', okResult, 0);
    assert.equal(cache.get('a', 0), null);
    assert.deepEqual(cache.get('b', 0), okResult);
    assert.deepEqual(cache.get('c', 0), okResult);
  });

  it('builds distinct keys for nearby categories', () => {
    assert.notEqual(
      nearbySearchCacheKey({ includedTypes: ['gas_station'] }, near),
      nearbySearchCacheKey({ includedTypes: ['parking'] }, near),
    );
  });
});

describe('wrapPlacesSearchWithCache', () => {
  it('only calls the wrapped search once for a repeated query', async () => {
    let calls = 0;
    const cache = new PlacesCache();
    const wrapped = wrapPlacesSearchWithCache(
      async (query: string, _near: typeof near) => {
        calls += 1;
        return okResult;
      },
      cache,
      textSearchCacheKey,
    );

    assert.deepEqual(await wrapped('coffee', near), okResult);
    assert.deepEqual(await wrapped('coffee', near), okResult);
    assert.equal(calls, 1);
  });

  it('does not cache a failed or non-ok search, so a retry hits the network again', async () => {
    let calls = 0;
    const cache = new PlacesCache();
    const wrapped = wrapPlacesSearchWithCache(
      async (query: string, _near: typeof near): Promise<PlaceSearchResult> => {
        calls += 1;
        return { status: 'network-error', places: [] };
      },
      cache,
      textSearchCacheKey,
    );

    await wrapped('coffee', near);
    await wrapped('coffee', near);
    assert.equal(calls, 2);
  });
});
