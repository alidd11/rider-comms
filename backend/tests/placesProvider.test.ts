import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchGooglePlaceDetails,
  fetchGooglePlaces,
  fetchGooglePlaceSuggestions,
  normalizePlaceId,
  normalizePlaceQuery,
  normalizeSessionToken,
  normalizePlaceTypes,
  PlacesProviderError,
} from '../src/placesProvider.ts';

const near = { lat: 51.5, lon: -0.1 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

async function assertProviderError(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof PlacesProviderError && error.code === code);
}

describe('Google places provider', () => {
  it('sends a biased text search with the server key and normalises results', async () => {
    let requestedUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestInit = init;
      return jsonResponse(200, {
        places: [
          {
            id: 'place-1',
            displayName: { text: 'Bike Cafe' },
            formattedAddress: '1 High Street',
            location: { latitude: 51.501, longitude: -0.101 },
          },
          {
            id: 'closed',
            displayName: { text: 'Gone' },
            location: { latitude: 51.5, longitude: -0.1 },
            businessStatus: 'CLOSED_PERMANENTLY',
          },
          { id: 'no-location', displayName: { text: 'Nowhere' } },
          { id: 'bad-lat', location: { latitude: 120, longitude: 0 } },
          null,
        ],
      });
    }) as typeof fetch;

    const places = await fetchGooglePlaces({ kind: 'text', query: 'bike cafe', near }, { apiKey: 'server-secret', fetchImpl });

    assert.equal(requestedUrl, 'https://places.googleapis.com/v1/places:searchText');
    const headers = requestInit?.headers as Record<string, string>;
    assert.equal(headers['X-Goog-Api-Key'], 'server-secret');
    assert.match(headers['X-Goog-FieldMask']!, /places\.location/);
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    assert.equal(body.textQuery, 'bike cafe');
    assert.deepEqual(body.locationBias, { circle: { center: { latitude: 51.5, longitude: -0.1 }, radius: 15_000 } });
    assert.deepEqual(places, [{ id: 'place-1', name: 'Bike Cafe', address: '1 High Street', lat: 51.501, lon: -0.101 }]);
    assert.equal(JSON.stringify(places).includes('server-secret'), false);
  });

  it('restricts nearby search to the radius and orders results by distance', async () => {
    let requestedUrl = '';
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(200, {
        places: [
          { id: 'far', displayName: { text: 'Far' }, location: { latitude: 51.53, longitude: -0.1 } },
          { id: 'outside', displayName: { text: 'Outside' }, location: { latitude: 51.6, longitude: -0.1 } },
          { id: 'close', displayName: { text: 'Close' }, location: { latitude: 51.501, longitude: -0.1 } },
        ],
      });
    }) as typeof fetch;

    const places = await fetchGooglePlaces(
      { kind: 'nearby', includedTypes: ['gas_station'], near },
      { apiKey: 'server-secret', fetchImpl },
    );

    assert.equal(requestedUrl, 'https://places.googleapis.com/v1/places:searchNearby');
    assert.deepEqual(body.includedTypes, ['gas_station']);
    assert.equal(body.rankPreference, 'DISTANCE');
    assert.deepEqual(places.map((place) => place.id), ['close', 'far']);
  });

  it('fills in fallbacks for missing ids, names and addresses', async () => {
    const fetchImpl = (async () => jsonResponse(200, {
      places: [{ location: { latitude: 51.5, longitude: -0.1 } }],
    })) as typeof fetch;

    const places = await fetchGooglePlaces({ kind: 'text', query: 'coffee', near }, { apiKey: 'k', fetchImpl });

    assert.deepEqual(places, [{ id: '51.5,-0.1', name: 'Unnamed place', address: '', lat: 51.5, lon: -0.1 }]);
  });

  it('treats a response with no places as an empty result', async () => {
    const fetchImpl = (async () => jsonResponse(200, {})) as typeof fetch;
    assert.deepEqual(await fetchGooglePlaces({ kind: 'text', query: 'coffee', near }, { apiKey: 'k', fetchImpl }), []);
  });

  it('rejects invalid requests before calling the provider', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return jsonResponse(200, {}); }) as typeof fetch;

    await assertProviderError(fetchGooglePlaces({ kind: 'text', query: ' a ', near }, { apiKey: 'k', fetchImpl }), 'places_invalid_request');
    await assertProviderError(fetchGooglePlaces({ kind: 'nearby', includedTypes: [], near }, { apiKey: 'k', fetchImpl }), 'places_invalid_request');
    await assertProviderError(fetchGooglePlaces({ kind: 'text', query: 'coffee', near: { lat: 91, lon: 0 } }, { apiKey: 'k', fetchImpl }), 'places_invalid_request');
    assert.equal(calls, 0);
  });

  it('reports a missing key as not configured', async () => {
    await assertProviderError(fetchGooglePlaces({ kind: 'text', query: 'coffee', near }, { apiKey: '' }), 'places_not_configured');
  });

  it('maps upstream failures to provider error codes', async () => {
    const statusFetch = (status: number) => (async () => jsonResponse(status, {})) as typeof fetch;
    await assertProviderError(fetchGooglePlaces({ kind: 'text', query: 'coffee', near }, { apiKey: 'k', fetchImpl: statusFetch(429) }), 'places_rate_limited');
    await assertProviderError(fetchGooglePlaces({ kind: 'text', query: 'coffee', near }, { apiKey: 'k', fetchImpl: statusFetch(403) }), 'places_unavailable');

    const networkFetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    await assertProviderError(fetchGooglePlaces({ kind: 'text', query: 'coffee', near }, { apiKey: 'k', fetchImpl: networkFetch }), 'places_unavailable');

    const invalidJson = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    await assertProviderError(fetchGooglePlaces({ kind: 'text', query: 'coffee', near }, { apiKey: 'k', fetchImpl: invalidJson }), 'places_invalid_response');

    const wrongShape = (async () => jsonResponse(200, { places: 'nope' })) as typeof fetch;
    await assertProviderError(fetchGooglePlaces({ kind: 'text', query: 'coffee', near }, { apiKey: 'k', fetchImpl: wrongShape }), 'places_invalid_response');
  });

  it('times out slow upstream requests', async () => {
    const hangingFetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
    await assertProviderError(
      fetchGooglePlaces({ kind: 'text', query: 'coffee', near }, { apiKey: 'k', fetchImpl: hangingFetch, timeoutMs: 10 }),
      'places_timeout',
    );
  });

  it('validates queries and place types', () => {
    assert.equal(normalizePlaceQuery('  coffee  '), 'coffee');
    assert.equal(normalizePlaceQuery('a'), null);
    assert.equal(normalizePlaceQuery('x'.repeat(201)), null);
    assert.equal(normalizePlaceQuery(42), null);

    assert.deepEqual(normalizePlaceTypes(['cafe', 'coffee_shop', 'cafe']), ['cafe', 'coffee_shop']);
    assert.equal(normalizePlaceTypes([]), null);
    assert.equal(normalizePlaceTypes(['a', 'b', 'c', 'd', 'e', 'f']), null);
    assert.equal(normalizePlaceTypes(['Cafe']), null);
    assert.equal(normalizePlaceTypes(['cafe; DROP']), null);
    assert.equal(normalizePlaceTypes('cafe'), null);
  });
});

describe('Google place suggestions and details', () => {
  const sessionToken = 'session-0123456789';

  it('asks Autocomplete with the session token, biased and measured from the rider', async () => {
    let requestedUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestInit = init;
      return jsonResponse(200, {
        suggestions: [
          { placePrediction: { placeId: 'abc_1', text: { text: 'Ace Cafe, London' }, structuredFormat: { mainText: { text: 'Ace Cafe' }, secondaryText: { text: 'North Circular Rd' } }, distanceMeters: 1200 } },
          { placePrediction: { placeId: 'only-text', text: { text: 'Somewhere' } } },
          { placePrediction: { placeId: 'bad id!' } },
          { queryPrediction: { text: { text: 'cafes near me' } } },
          null,
        ],
      });
    }) as typeof fetch;

    const suggestions = await fetchGooglePlaceSuggestions({ input: 'ace', near, sessionToken }, { apiKey: 'server-secret', fetchImpl });

    assert.equal(requestedUrl, 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal((requestInit?.headers as Record<string, string>)['X-Goog-Api-Key'], 'server-secret');
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    assert.equal(body.input, 'ace');
    assert.equal(body.sessionToken, sessionToken);
    assert.deepEqual(body.origin, { latitude: 51.5, longitude: -0.1 });
    assert.deepEqual(suggestions, [
      { id: 'abc_1', name: 'Ace Cafe', address: 'North Circular Rd', distanceMeters: 1200 },
      { id: 'only-text', name: 'Somewhere', address: '' },
    ]);
  });

  it('closes the session with one details call for the chosen place', async () => {
    let requestedUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      requestInit = init;
      return jsonResponse(200, { id: 'abc_1', displayName: { text: 'Ace Cafe' }, formattedAddress: 'North Circular Rd', location: { latitude: 51.541, longitude: -0.277 } });
    }) as typeof fetch;

    const place = await fetchGooglePlaceDetails('abc_1', sessionToken, { apiKey: 'server-secret', fetchImpl });

    assert.equal(requestedUrl, `https://places.googleapis.com/v1/places/abc_1?sessionToken=${sessionToken}`);
    assert.equal(requestInit?.method, 'GET');
    assert.equal((requestInit?.headers as Record<string, string>)['X-Goog-FieldMask'], 'id,displayName,formattedAddress,location');
    assert.deepEqual(place, { id: 'abc_1', name: 'Ace Cafe', address: 'North Circular Rd', lat: 51.541, lon: -0.277 });
  });

  it('rejects bad input before calling Google and maps failures to error codes', async () => {
    const neverCalled = (async () => { throw new Error('should not be called'); }) as typeof fetch;
    await assertProviderError(fetchGooglePlaceSuggestions({ input: 'a', near, sessionToken }, { apiKey: 'k', fetchImpl: neverCalled }), 'places_invalid_request');
    await assertProviderError(fetchGooglePlaceSuggestions({ input: 'ace', near, sessionToken: 'x' }, { apiKey: 'k', fetchImpl: neverCalled }), 'places_invalid_request');
    await assertProviderError(fetchGooglePlaceSuggestions({ input: 'ace', near: { lat: 99, lon: 0 }, sessionToken }, { apiKey: 'k', fetchImpl: neverCalled }), 'places_invalid_request');
    await assertProviderError(fetchGooglePlaceDetails('bad id!', sessionToken, { apiKey: 'k', fetchImpl: neverCalled }), 'places_invalid_request');
    await assertProviderError(fetchGooglePlaceDetails('abc', sessionToken, { apiKey: '', fetchImpl: neverCalled }), 'places_not_configured');

    const status = (code: number) => (async () => jsonResponse(code, {})) as typeof fetch;
    await assertProviderError(fetchGooglePlaceSuggestions({ input: 'ace', near, sessionToken }, { apiKey: 'k', fetchImpl: status(429) }), 'places_rate_limited');
    await assertProviderError(fetchGooglePlaceSuggestions({ input: 'ace', near, sessionToken }, { apiKey: 'k', fetchImpl: status(500) }), 'places_unavailable');
    await assertProviderError(fetchGooglePlaceSuggestions({ input: 'ace', near, sessionToken }, { apiKey: 'k', fetchImpl: (async () => new Response('not json')) as typeof fetch }), 'places_invalid_response');
    await assertProviderError(fetchGooglePlaceSuggestions({ input: 'ace', near, sessionToken }, { apiKey: 'k', fetchImpl: (async () => jsonResponse(200, { suggestions: 'nope' })) as typeof fetch }), 'places_invalid_response');
    assert.deepEqual(await fetchGooglePlaceSuggestions({ input: 'ace', near, sessionToken }, { apiKey: 'k', fetchImpl: (async () => jsonResponse(200, {})) as typeof fetch }), []);
    await assertProviderError(fetchGooglePlaceDetails('abc', sessionToken, { apiKey: 'k', fetchImpl: (async () => jsonResponse(200, { id: 'abc' })) as typeof fetch }), 'places_invalid_response');
    await assertProviderError(fetchGooglePlaceDetails('abc', sessionToken, { apiKey: 'k', fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch }), 'places_unavailable');
    const slow = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
    await assertProviderError(fetchGooglePlaceDetails('abc', sessionToken, { apiKey: 'k', fetchImpl: slow, timeoutMs: 5 }), 'places_timeout');
  });

  it('validates session tokens and place ids', () => {
    assert.equal(normalizeSessionToken('session-0123456789'), 'session-0123456789');
    assert.equal(normalizeSessionToken('short'), null);
    assert.equal(normalizeSessionToken(42), null);
    assert.equal(normalizePlaceId('ChIJ_abc-123'), 'ChIJ_abc-123');
    assert.equal(normalizePlaceId('../etc'), null);
  });
});
