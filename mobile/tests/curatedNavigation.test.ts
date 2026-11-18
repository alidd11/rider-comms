import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advanceCuratedStops, initialCuratedStops } from '../src/routes/curatedNavigation.ts';

const itinerary = {
  start: { lat: 51.5, lon: -0.1, label: 'Start' },
  waypoints: [
    { lat: 51.51, lon: -0.11, label: 'First stop' },
    { lat: 51.52, lon: -0.12, label: 'Second stop' },
  ],
};

describe('curated scenic-route navigation checkpoints', () => {
  it('routes to the start and every ordered waypoint when joining from afar', () => {
    assert.deepEqual(initialCuratedStops(itinerary, { lat: 51.4, lon: -0.2 }).map(p => p.label), ['Start', 'First stop', 'Second stop']);
  });
  it('does not send a rider already at the start back around the block', () => {
    assert.deepEqual(initialCuratedStops(itinerary, { lat: 51.5001, lon: -0.1001 }).map(p => p.label), ['First stop', 'Second stop']);
  });
  it('does not skip an earlier stop because the rider is near a later one', () => {
    const initial = initialCuratedStops(itinerary, { lat: 51.4, lon: -0.2 });
    const attempt = advanceCuratedStops(initial, itinerary.waypoints[1]!, 5);
    assert.equal(attempt.reached, null);
    assert.deepEqual(attempt.remaining, initial);
  });
  it('rejects unreliable fixes instead of skipping checkpoints', () => {
    const initial = initialCuratedStops(itinerary, { lat: 51.4, lon: -0.2 });
    for (const accuracy of [null, undefined, 120, Number.NaN, -1]) {
      assert.equal(advanceCuratedStops(initial, itinerary.start, accuracy).reached, null);
    }
  });
  it('advances one stop at a time in order without mutating the original array', () => {
    const initial = initialCuratedStops(itinerary, { lat: 51.4, lon: -0.2 });
    const first = advanceCuratedStops(initial, itinerary.start, 10);
    assert.equal(first.reached?.label, 'Start');
    assert.deepEqual(initial.map(s=>s.label), ['Start', 'First stop', 'Second stop']);
    const second = advanceCuratedStops(first.remaining, itinerary.waypoints[0]!, 10);
    assert.equal(second.reached?.label, 'First stop');
    assert.deepEqual(second.remaining.map(p=>p.label), ['Second stop']);
  });
});
