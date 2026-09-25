import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addRecentPlace, parseRecentPlaces, recentPlacesStorageKey, RECENT_PLACES_MAX } from '../src/search/recentPlaces.ts';
import type { PlaceResult } from '../src/api/places.ts';

const validPlace: PlaceResult = { id: 'p1', name: 'Cafe', address: '1 Main St', lat: 51.5, lon: -0.1, distanceMeters: 120 };

describe('recentPlacesStorageKey', () => {
  it('scopes the storage key to the rider', () => {
    assert.equal(recentPlacesStorageKey('rider-1'), '@rider-comms/search-recents/rider-1');
    assert.notEqual(recentPlacesStorageKey('rider-1'), recentPlacesStorageKey('rider-2'));
  });
});

describe('parseRecentPlaces', () => {
  it('returns an empty list for null, empty, or malformed JSON', () => {
    assert.deepEqual(parseRecentPlaces(null), []);
    assert.deepEqual(parseRecentPlaces(''), []);
    assert.deepEqual(parseRecentPlaces('not json'), []);
    assert.deepEqual(parseRecentPlaces('{"not": "an array"}'), []);
  });

  it('parses a valid list of places', () => {
    assert.deepEqual(parseRecentPlaces(JSON.stringify([validPlace])), [validPlace]);
  });

  it('drops entries missing required fields or with the wrong types', () => {
    const malformed = [
      { ...validPlace, id: '' },
      { ...validPlace, id: 42 },
      { ...validPlace, name: undefined },
      { ...validPlace, address: 7 },
      null,
      'not an object',
    ];
    assert.deepEqual(parseRecentPlaces(JSON.stringify(malformed)), []);
  });

  it('drops entries with out-of-range or non-finite coordinates', () => {
    const outOfRange = [
      { ...validPlace, id: 'a', lat: 91 },
      { ...validPlace, id: 'b', lat: -91 },
      { ...validPlace, id: 'c', lon: 181 },
      { ...validPlace, id: 'd', lon: -181 },
      { ...validPlace, id: 'e', lat: Number.NaN },
      { ...validPlace, id: 'f', lon: Number.POSITIVE_INFINITY },
    ];
    assert.deepEqual(parseRecentPlaces(JSON.stringify(outOfRange)), []);
  });

  it('defaults a missing or invalid distanceMeters to 0 rather than dropping the place', () => {
    const [parsed] = parseRecentPlaces(JSON.stringify([{ ...validPlace, distanceMeters: undefined }]));
    assert.equal(parsed?.distanceMeters, 0);
    const [negativeParsed] = parseRecentPlaces(JSON.stringify([{ ...validPlace, distanceMeters: -5 }]));
    assert.equal(negativeParsed?.distanceMeters, 0);
  });

  it('caps the parsed list at RECENT_PLACES_MAX', () => {
    const many = Array.from({ length: RECENT_PLACES_MAX + 4 }, (_, index) => ({ ...validPlace, id: `p${index}` }));
    assert.equal(parseRecentPlaces(JSON.stringify(many)).length, RECENT_PLACES_MAX);
  });
});

describe('addRecentPlace', () => {
  it('prepends the new place to an empty list', () => {
    assert.deepEqual(addRecentPlace([], validPlace), [validPlace]);
  });

  it('moves an already-present place to the front instead of duplicating it', () => {
    const other: PlaceResult = { ...validPlace, id: 'p2', name: 'Garage' };
    const current = [other, validPlace];
    assert.deepEqual(addRecentPlace(current, validPlace), [validPlace, other]);
  });

  it('caps the list at RECENT_PLACES_MAX, dropping the oldest entries', () => {
    const current = Array.from({ length: RECENT_PLACES_MAX }, (_, index) => ({ ...validPlace, id: `old${index}` }));
    const next = addRecentPlace(current, { ...validPlace, id: 'new' });
    assert.equal(next.length, RECENT_PLACES_MAX);
    assert.equal(next[0]?.id, 'new');
    assert.ok(!next.some((place) => place.id === `old${RECENT_PLACES_MAX - 1}`));
  });
});
