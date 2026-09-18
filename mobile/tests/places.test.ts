import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { distanceBetweenMeters, formatPlaceDistance, isSearchQueryValid, searchNearbyPlaces, searchPlaces } from '../src/api/places.ts';
import { addRecentPlace, parseRecentPlaces, recentPlacesStorageKey } from '../src/search/recentPlaces.ts';

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
}

describe('isSearchQueryValid', () => {
  it('rejects empty or whitespace-only queries', () => {
    assert.equal(isSearchQueryValid(''), false);
    assert.equal(isSearchQueryValid('   '), false);
  });

  it('accepts a normal query', () => {
    assert.equal(isSearchQueryValid('gas station'), true);
  });

  it('rejects a query over the length limit', () => {
    assert.equal(isSearchQueryValid('a'.repeat(201)), false);
  });
});

describe('searchPlaces', () => {
  const near = { lat: 51.5, lon: -0.1 };

  it('returns an unavailable failure without calling the network when no API key is set', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const results = await searchPlaces('coffee', near, '', fetchImpl);
    assert.deepEqual(results, { status: 'unavailable', places: [] });
    assert.equal(called, false);
  });

  it('returns an empty successful result for an invalid query even with a key set', async () => {
    const results = await searchPlaces('   ', near, 'test-key', fakeFetch(() => ({ status: 200, body: {} })));
    assert.deepEqual(results, { status: 'ok', places: [] });
  });

  it('sends the query, key, and location bias, and maps the response', async () => {
    const results = await searchPlaces(
      'coffee shop',
      near,
      'test-key',
      fakeFetch((url, init) => {
        assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
        assert.equal((init.headers as Record<string, string>)['X-Goog-Api-Key'], 'test-key');
        const body = JSON.parse(init.body as string);
        assert.equal(body.textQuery, 'coffee shop');
        assert.deepEqual(body.locationBias.circle.center, { latitude: 51.5, longitude: -0.1 });
        assert.equal(body.locationBias.circle.radius, 15_000);
        return {
          status: 200,
          body: {
            places: [
              {
                id: 'place1',
                displayName: { text: 'Corner Coffee' },
                formattedAddress: '1 High St',
                location: { latitude: 51.51, longitude: -0.11 },
              },
            ],
          },
        };
      })
    );

    assert.equal(results.status, 'ok');
    assert.equal(results.places.length, 1);
    assert.deepEqual(
      { ...results.places[0], distanceMeters: undefined },
      { id: 'place1', name: 'Corner Coffee', address: '1 High St', lat: 51.51, lon: -0.11, distanceMeters: undefined }
    );
    assert.ok(results.places[0].distanceMeters > 1_000);
  });

  it('skips results missing a location and never throws on a bad response', async () => {
    const results = await searchPlaces(
      'coffee',
      near,
      'test-key',
      fakeFetch(() => ({ status: 200, body: { places: [{ id: 'no-loc', displayName: { text: 'No Location' } }] } }))
    );
    assert.deepEqual(results, { status: 'ok', places: [] });
  });

  it('distinguishes provider and quota failures from zero results', async () => {
    const results = await searchPlaces('coffee', near, 'test-key', fakeFetch(() => ({ status: 403, body: {} })));
    assert.deepEqual(results, { status: 'provider-error', places: [] });
    const limited = await searchPlaces('coffee', near, 'test-key', fakeFetch(() => ({ status: 429, body: {} })));
    assert.deepEqual(limited, { status: 'rate-limited', places: [] });
  });

  it('distinguishes network failures from zero results', async () => {
    const throwingFetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const results = await searchPlaces('coffee', near, 'test-key', throwingFetch);
    assert.deepEqual(results, { status: 'network-error', places: [] });
  });

  it('preserves provider relevance order for text results', async () => {
    const results = await searchPlaces(
      'museum',
      near,
      'test-key',
      fakeFetch(() => ({
        status: 200,
        body: {
          places: [
            { id: 'relevant', displayName: { text: 'Relevant' }, location: { latitude: 51.55, longitude: -0.1 } },
            { id: 'closer', displayName: { text: 'Closer' }, location: { latitude: 51.501, longitude: -0.1 } },
          ],
        },
      }))
    );
    assert.equal(results.status, 'ok');
    assert.deepEqual(results.places.map((place) => place.id), ['relevant', 'closer']);
  });

  it('reports a malformed provider response', async () => {
    const results = await searchPlaces(
      'coffee',
      near,
      'test-key',
      fakeFetch(() => ({ status: 200, body: { places: 'not-an-array' } }))
    );
    assert.deepEqual(results, { status: 'provider-error', places: [] });

    const invalidJson = (async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('invalid JSON'); },
    } as unknown as Response)) as typeof fetch;
    const invalidJsonResult = await searchPlaces('coffee', near, 'test-key', invalidJson);
    assert.deepEqual(invalidJsonResult, { status: 'provider-error', places: [] });
  });

  it('drops malformed and out-of-range provider places safely', async () => {
    const results = await searchPlaces(
      'coffee',
      near,
      'test-key',
      fakeFetch(() => ({
        status: 200,
        body: {
          places: [
            null,
            { id: 'nan', location: { latitude: Number.NaN, longitude: -0.1 } },
            { id: 'outside', location: { latitude: 91, longitude: -0.1 } },
          ],
        },
      }))
    );
    assert.deepEqual(results, { status: 'ok', places: [] });
  });
});

describe('searchNearbyPlaces', () => {
  const near = { lat: 51.5, lon: -0.1 };

  it('uses strict category types, a 5 km restriction, and distance ranking', async () => {
    const results = await searchNearbyPlaces(
      { includedTypes: ['restaurant'] },
      near,
      'test-key',
      fakeFetch((url, init) => {
        assert.equal(url, 'https://places.googleapis.com/v1/places:searchNearby');
        const body = JSON.parse(init.body as string);
        assert.deepEqual(body.includedTypes, ['restaurant']);
        assert.equal(body.rankPreference, 'DISTANCE');
        assert.equal(body.locationRestriction.circle.radius, 5_000);
        assert.deepEqual(body.locationRestriction.circle.center, { latitude: 51.5, longitude: -0.1 });
        return {
          status: 200,
          body: {
            places: [{
              id: 'restaurant-1',
              displayName: { text: 'Nearby Restaurant' },
              formattedAddress: '1 High St',
              location: { latitude: 51.501, longitude: -0.1 },
              businessStatus: 'OPERATIONAL',
            }],
          },
        };
      })
    );

    assert.equal(results.status, 'ok');
    assert.equal(results.places.length, 1);
    assert.equal(results.places[0].name, 'Nearby Restaurant');
  });

  it('removes permanently closed and out-of-radius places defensively', async () => {
    const results = await searchNearbyPlaces(
      { includedTypes: ['restaurant'] },
      near,
      'test-key',
      fakeFetch(() => ({
        status: 200,
        body: {
          places: [
            {
              id: 'closed', displayName: { text: 'Closed' }, businessStatus: 'CLOSED_PERMANENTLY',
              location: { latitude: 51.501, longitude: -0.1 },
            },
            {
              id: 'far', displayName: { text: 'Too Far' }, businessStatus: 'OPERATIONAL',
              location: { latitude: 51.6, longitude: -0.1 },
            },
          ],
        },
      }))
    );

    assert.deepEqual(results, { status: 'ok', places: [] });
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
