import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedPlaces, savedPlacesStorageKey, withSavedPlace } from '../src/search/savedPlaces.ts';
import type { PlaceResult } from '../src/api/places.ts';

const home: PlaceResult = { id: 'h1', name: '12 Elm Road', address: 'London N8', lat: 51.58, lon: -0.12, distanceMeters: 900 };
const work: PlaceResult = { id: 'w1', name: 'Workshop', address: 'Camden', lat: 51.54, lon: -0.14, distanceMeters: 0 };

describe('saved places', () => {
  it('scopes storage to the rider', () => {
    assert.equal(savedPlacesStorageKey('rider-1'), '@rider-comms/saved-places/rider-1');
    assert.notEqual(savedPlacesStorageKey('rider-1'), savedPlacesStorageKey('rider-2'));
  });

  it('reads Home and Work back, without a stale distance', () => {
    const saved = parseSavedPlaces(JSON.stringify({ home, work }));
    assert.deepEqual(saved.home, { ...home, distanceMeters: 0 });
    assert.deepEqual(saved.work, work);
  });

  it('drops malformed or unknown entries and survives bad JSON', () => {
    assert.deepEqual(parseSavedPlaces(JSON.stringify({ home: { ...home, lat: 120 }, gym: work })), {});
    assert.deepEqual(parseSavedPlaces('[1,2]'), {});
    assert.deepEqual(parseSavedPlaces('{not json'), {});
    assert.deepEqual(parseSavedPlaces(null), {});
  });

  it('sets and clears one slot without touching the other', () => {
    const both = withSavedPlace(withSavedPlace({}, 'home', home), 'work', work);
    assert.equal(both.home?.id, 'h1');
    const cleared = withSavedPlace(both, 'home', null);
    assert.equal(cleared.home, undefined);
    assert.equal(cleared.work?.id, 'w1');
    assert.equal(both.home?.id, 'h1', 'the original is left alone');
  });
});
