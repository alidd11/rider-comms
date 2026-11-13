import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/api/client.ts';
import type { PlaceSummary } from '../src/api/client.ts';
import { distanceBetweenMeters, formatPlaceDistance, isSearchQueryValid, MIN_PLACE_SEARCH_QUERY_LENGTH, newPlaceSearchSession, placeDetails, PLACE_SEARCH_DEBOUNCE_MS, PLACE_SUGGEST_DEBOUNCE_MS, searchNearbyPlaces, suggestPlaces } from '../src/api/places.ts';
import type { PlacesClient } from '../src/api/places.ts';
import { addRecentPlace, parseRecentPlaces, recentPlacesStorageKey } from '../src/search/recentPlaces.ts';

type SearchCall = { kind: 'nearby'; includedTypes: readonly string[]; near: { lat: number; lon: number } };

function fakeClient(respond: () => Promise<{ places: unknown }>): { client: PlacesClient; calls: SearchCall[] } {
  const calls: SearchCall[] = [];
  const client = {
    searchNearbyPlaces: async (includedTypes: readonly string[], near: { lat: number; lon: number }) => {
      calls.push({ kind: 'nearby', includedTypes, near });
      return respond() as Promise<{ places: PlaceSummary[] }>;
    },
    suggestPlaces: async () => { throw new Error('not used here'); },
    placeDetails: async () => { throw new Error('not used here'); },
  };
  return { client, calls };
}

/** A client for the search-as-you-type calls only. */
function suggestClient(
  suggest: () => Promise<unknown>,
  details: () => Promise<unknown> = async () => { throw new Error('not used'); },
): { client: PlacesClient; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const client: PlacesClient = {
    searchNearbyPlaces: async () => { throw new Error('not used'); },
    suggestPlaces: async (...args) => { calls.push(['suggest', ...args]); return suggest() as never; },
    placeDetails: async (...args) => { calls.push(['details', ...args]); return details() as never; },
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

describe('place search results', () => {
  const near = { lat: 51.5, lon: -0.1 };
  const petrol = { includedTypes: ['gas_station'] };

  it('distinguishes quota, configuration and provider failures from zero results', async () => {
    const failing = (status: number) => fakeClient(async () => { throw new ApiError(status, { error: 'x' }); }).client;
    assert.deepEqual(await searchNearbyPlaces(petrol, near, failing(429)), { status: 'rate-limited', places: [] });
    assert.deepEqual(await searchNearbyPlaces(petrol, near, failing(503)), { status: 'unavailable', places: [] });
    assert.deepEqual(await searchNearbyPlaces(petrol, near, failing(502)), { status: 'provider-error', places: [] });
    assert.deepEqual(await searchNearbyPlaces(petrol, near, failing(401)), { status: 'provider-error', places: [] });
  });

  it('distinguishes network failures and timeouts from zero results', async () => {
    const offline = fakeClient(async () => { throw new TypeError('Network request failed'); }).client;
    assert.deepEqual(await searchNearbyPlaces(petrol, near, offline), { status: 'network-error', places: [] });
    const aborted = fakeClient(async () => { throw new DOMException('aborted', 'AbortError'); }).client;
    assert.deepEqual(await searchNearbyPlaces(petrol, near, aborted), { status: 'network-error', places: [] });
  });

  it('reports a malformed backend response', async () => {
    const { client } = fakeClient(async () => ({ places: 'nope' }));
    assert.deepEqual(await searchNearbyPlaces(petrol, near, client), { status: 'provider-error', places: [] });
  });

  it('drops malformed and out-of-range places safely, with distances added', async () => {
    const { client } = fakeClient(async () => ({
      places: [
        place('ok', 51.501, -0.1, 'Bike Cafe'),
        { id: 'no-coords', name: 'x', address: '' },
        { ...place('bad-lat', 91, 0) },
        { ...place('bad-lon', 0, 181) },
        { ...place('nan', Number.NaN, 0) },
        { id: 1, name: 'x', address: '', lat: 0, lon: 0 },
        null,
      ],
    }));
    const result = await searchNearbyPlaces(petrol, near, client);
    assert.deepEqual(result.places.map((p) => p.id), ['ok']);
    assert.equal(result.places[0]!.address, 'Bike Cafe address');
    assert.ok(Math.abs(result.places[0]!.distanceMeters - 111) < 2);
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

describe('search as you type', () => {
  const near = { lat: 51.5, lon: -0.1 };
  const token = 'rc0123456789abcdef0123456789abcd';

  it('waits less after typing than a category search does', () => {
    assert.ok(PLACE_SUGGEST_DEBOUNCE_MS < PLACE_SEARCH_DEBOUNCE_MS);
  });

  it('starts each session with a fresh token the backend accepts', () => {
    const first = newPlaceSearchSession();
    assert.match(first, /^rc[0-9a-f]{30}$/);
    assert.notEqual(newPlaceSearchSession(), first);
    assert.equal(newPlaceSearchSession(() => 0), `rc${'0'.repeat(30)}`);
  });

  it('suggests places for the trimmed query in the session, dropping malformed ones', async () => {
    const { client, calls } = suggestClient(async () => ({
      suggestions: [
        { id: 'a', name: 'Ace Cafe', address: 'North Circular Rd', distanceMeters: 1200 },
        { id: 'b', name: 'Somewhere', address: '' },
        { id: '', name: 'No id', address: '' },
        { id: 'c', name: 'Bad distance', address: '', distanceMeters: -1 },
        null,
      ],
    }));
    const result = await suggestPlaces('  ace  ', near, token, client);
    assert.deepEqual(calls, [['suggest', 'ace', near, token]]);
    assert.deepEqual(result, {
      status: 'ok',
      suggestions: [
        { id: 'a', name: 'Ace Cafe', address: 'North Circular Rd', distanceMeters: 1200 },
        { id: 'b', name: 'Somewhere', address: '' },
      ],
    });
  });

  it('skips short queries and maps failures', async () => {
    const short = suggestClient(async () => ({ suggestions: [] }));
    assert.deepEqual(await suggestPlaces('a', near, token, short.client), { status: 'ok', suggestions: [] });
    assert.equal(short.calls.length, 0);

    assert.deepEqual(await suggestPlaces('ace', near, token, suggestClient(async () => { throw new ApiError(429, {}); }).client), { status: 'rate-limited', suggestions: [] });
    assert.deepEqual(await suggestPlaces('ace', near, token, suggestClient(async () => { throw new TypeError('offline'); }).client), { status: 'network-error', suggestions: [] });
    assert.deepEqual(await suggestPlaces('ace', near, token, suggestClient(async () => ({ suggestions: 'nope' })).client), { status: 'provider-error', suggestions: [] });
  });

  it('looks up the chosen place in the same session and measures it from the rider', async () => {
    const { client, calls } = suggestClient(async () => ({}), async () => ({ place: place('a', 51.51, -0.1, 'Ace Cafe') }));
    const result = await placeDetails('a', token, near, client);
    assert.deepEqual(calls, [['details', 'a', token]]);
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.place.name, 'Ace Cafe');
    assert.equal(result.place.distanceMeters, distanceBetweenMeters(near, { lat: 51.51, lon: -0.1 }));

    const noFix = await placeDetails('a', token, null, client);
    assert.equal(noFix.status === 'ok' && noFix.place.distanceMeters, 0);
  });

  it('reports a failed or malformed details lookup', async () => {
    assert.deepEqual(await placeDetails('a', token, near, suggestClient(async () => ({}), async () => { throw new ApiError(503, {}); }).client), { status: 'unavailable' });
    assert.deepEqual(await placeDetails('a', token, near, suggestClient(async () => ({}), async () => ({ place: { id: 'a' } })).client), { status: 'provider-error' });
    assert.deepEqual(await placeDetails('a', token, near, suggestClient(async () => ({}), async () => null).client), { status: 'provider-error' });
  });
});
