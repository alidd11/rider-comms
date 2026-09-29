import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api/client.ts';
import type { PlaceSummary } from '../src/api/client.ts';
import { distanceBetweenMeters, formatPlaceDistance, isSearchQueryValid, MIN_PLACE_SEARCH_QUERY_LENGTH, PLACE_SEARCH_DEBOUNCE_MS, searchNearbyPlaces, searchPlaces } from '../src/api/places.ts';
import type { PlacesClient } from '../src/api/places.ts';
import { addRecentPlace, parseRecentPlaces, recentPlacesStorageKey } from '../src/search/recentPlaces.ts';

type SearchCall = { kind: 'text'; query: string; near: { lat: number; lon: number } }
  | { kind: 'nearby'; includedTypes: readonly string[]; near: { lat: number; lon: number } };

function fakeClient(respond: () => Promise<{ places: unknown }>): { client: PlacesClient; calls: SearchCall[] } {
  const calls: SearchCall[] = [];
  const client = {
    searchPlaces: async (query: string, near: { lat: number; lon: number }) => {
      calls.push({ kind: 'text', query, near });
      return respond() as Promise<{ places: PlaceSummary[] }>;
    },
    searchNearbyPlaces: async (includedTypes: readonly string[], near: { lat: number; lon: number }) => {
      calls.push({ kind: 'nearby', includedTypes, near });
      return respond() as Promise<{ places: PlaceSummary[] }>;
    },
  };
  return { client, calls };
}

function place(id: string, lat: number, lon: number, name = id): PlaceSummary {
  return { id, name, address: `${name} address`, lat, lon };
}

describe('isSearchQueryValid', () => {
  it('rejects empty, whitespace-only, and single-character queries', () => {
    assert.equal(isSearchQueryValid(''), false);
    assert.equal(isSearchQueryValid('   '), false);
    assert.equal(isSearchQueryValid('a'), false);
  });

  it('accepts useful queries after the minimum input threshold', () => {
    assert.equal(MIN_PLACE_SEARCH_QUERY_LENGTH, 2);
    assert.equal(PLACE_SEARCH_DEBOUNCE_MS, 500);
    assert.equal(isSearchQueryValid('M1'), true);
    assert.equal(isSearchQueryValid('gas station'), true);
  });

  it('rejects a query over the length limit', () => {
    assert.equal(isSearchQueryValid('a'.repeat(201)), false);
  });
});

describe('searchPlaces', () => {
  const near = { lat: 51.5, lon: -0.1 };

  it('returns an empty successful result for an invalid query without calling the backend', async () => {
    const { client, calls } = fakeClient(async () => ({ places: [] }));
    assert.deepEqual(await searchPlaces('   ', near, client), { status: 'ok', places: [] });
    assert.equal(calls.length, 0);
  });

  it('sends the trimmed query and location to the backend and adds distances', async () => {
    const { client, calls } = fakeClient(async () => ({ places: [place('p1', 51.501, -0.1, 'Bike Cafe')] }));

    const result = await searchPlaces('  coffee shop ', near, client);

    assert.deepEqual(calls, [{ kind: 'text', query: 'coffee shop', near }]);
    assert.equal(result.status, 'ok');
    assert.equal(result.places.length, 1);
    assert.equal(result.places[0]!.name, 'Bike Cafe');
    assert.equal(result.places[0]!.address, 'Bike Cafe address');
    assert.ok(Math.abs(result.places[0]!.distanceMeters - 111) < 2);
  });

  it('preserves backend relevance order for text results', async () => {
    const { client } = fakeClient(async () => ({ places: [place('far', 51.52, -0.1), place('near', 51.501, -0.1)] }));
    const result = await searchPlaces('coffee', near, client);
    assert.deepEqual(result.places.map((p) => p.id), ['far', 'near']);
  });

  it('distinguishes quota, configuration and provider failures from zero results', async () => {
    const failing = (status: number) => fakeClient(async () => { throw new ApiError(status, { error: 'x' }); }).client;
    assert.deepEqual(await searchPlaces('coffee', near, failing(429)), { status: 'rate-limited', places: [] });
    assert.deepEqual(await searchPlaces('coffee', near, failing(503)), { status: 'unavailable', places: [] });
    assert.deepEqual(await searchPlaces('coffee', near, failing(502)), { status: 'provider-error', places: [] });
    assert.deepEqual(await searchPlaces('coffee', near, failing(401)), { status: 'provider-error', places: [] });
  });

  it('distinguishes network failures and timeouts from zero results', async () => {
    const offline = fakeClient(async () => { throw new TypeError('Network request failed'); }).client;
    assert.deepEqual(await searchPlaces('coffee', near, offline), { status: 'network-error', places: [] });
    const aborted = fakeClient(async () => { throw new DOMException('aborted', 'AbortError'); }).client;
    assert.deepEqual(await searchPlaces('coffee', near, aborted), { status: 'network-error', places: [] });
  });

  it('reports a malformed backend response', async () => {
    const { client } = fakeClient(async () => ({ places: 'nope' }));
    assert.deepEqual(await searchPlaces('coffee', near, client), { status: 'provider-error', places: [] });
  });

  it('drops malformed and out-of-range places safely', async () => {
    const { client } = fakeClient(async () => ({
      places: [
        place('ok', 51.501, -0.1),
        { id: 'no-coords', name: 'x', address: '' },
        { ...place('bad-lat', 91, 0) },
        { ...place('bad-lon', 0, 181) },
        { ...place('nan', Number.NaN, 0) },
        { id: 1, name: 'x', address: '', lat: 0, lon: 0 },
        null,
      ],
    }));
    const result = await searchPlaces('coffee', near, client);
    assert.deepEqual(result.places.map((p) => p.id), ['ok']);
  });
});

describe('searchNearbyPlaces', () => {
  const near = { lat: 51.5, lon: -0.1 };

  it('sends the category types to the backend nearby search', async () => {
    const { client, calls } = fakeClient(async () => ({ places: [] }));
    await searchNearbyPlaces({ includedTypes: ['cafe', 'coffee_shop'] }, near, client);
    assert.deepEqual(calls, [{ kind: 'nearby', includedTypes: ['cafe', 'coffee_shop'], near }]);
  });

  it('skips the backend for an empty category', async () => {
    const { client, calls } = fakeClient(async () => ({ places: [] }));
    assert.deepEqual(await searchNearbyPlaces({ includedTypes: [] }, near, client), { status: 'ok', places: [] });
    assert.equal(calls.length, 0);
  });

  it('orders by distance and drops anything outside the 5 km radius defensively', async () => {
    const { client } = fakeClient(async () => ({
      places: [place('mid', 51.52, -0.1), place('outside', 51.6, -0.1), place('close', 51.501, -0.1)],
    }));
    const result = await searchNearbyPlaces({ includedTypes: ['parking'] }, near, client);
    assert.deepEqual(result.places.map((p) => p.id), ['close', 'mid']);
  });

  it('passes backend failures through unchanged', async () => {
    const { client } = fakeClient(async () => { throw new ApiError(429, { error: 'rate_limited' }); });
    assert.deepEqual(await searchNearbyPlaces({ includedTypes: ['parking'] }, near, client), { status: 'rate-limited', places: [] });
  });
});

describe('place distance helpers', () => {
  it('calculates and formats useful nearby distances', () => {
    const metres = distanceBetweenMeters({ lat: 51.5, lon: -0.1 }, { lat: 51.501, lon: -0.1 });
    assert.ok(metres > 100 && metres < 120);
    assert.equal(formatPlaceDistance(metres), '100 m');
    assert.equal(formatPlaceDistance(1_450), '1.4 km');
    assert.equal(formatPlaceDistance(100, 'mi'), '350 ft');
    assert.equal(formatPlaceDistance(1_609.344, 'mi'), '1.0 mi');
  });

  it('rejects invalid display distances safely', () => {
    assert.equal(formatPlaceDistance(Number.NaN), '');
    assert.equal(formatPlaceDistance(-1), '');
  });
});


describe('recent place history', () => {
  const a = { id: 'a', name: 'A', address: 'A road', lat: 51.5, lon: -0.1, distanceMeters: 100 };
  const b = { id: 'b', name: 'B', address: 'B road', lat: 51.6, lon: -0.2, distanceMeters: 200 };

  it('scopes storage to the signed-in rider', () => {
    assert.equal(recentPlacesStorageKey('rider_a'), '@rider-comms/search-recents/rider_a');
    assert.notEqual(recentPlacesStorageKey('rider_a'), recentPlacesStorageKey('rider_b'));
  });

  it('keeps newest places first and deduplicates by place id', () => {
    assert.deepEqual(addRecentPlace([a, b], b).map((place) => place.id), ['b', 'a']);
  });

  it('caps history at six entries', () => {
    const current = Array.from({ length: 6 }, (_, index) => ({ ...a, id: `p${index}` }));
    assert.equal(addRecentPlace(current, b).length, 6);
    assert.equal(addRecentPlace(current, b)[0].id, 'b');
  });

  it('rejects malformed cached history instead of trusting arbitrary JSON', () => {
    assert.deepEqual(
      parseRecentPlaces(JSON.stringify([a, { id: 'bad', name: 'Bad', address: '', lat: 999, lon: 0 }])),
      [a]
    );
    assert.deepEqual(parseRecentPlaces('{broken'), []);
  });
});
