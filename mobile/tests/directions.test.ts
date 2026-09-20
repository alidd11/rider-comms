import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeGooglePolyline,
  distanceToPathMeters,
  distanceToSegmentMeters,
  fetchDrivingRoute,
  lookAheadCoordinateOnPath,
  metersBetween,
  remainingDistanceOnPathMeters,
  stripNavigationInstruction,
} from '../src/api/directions.ts';

describe('native in-app directions helpers', () => {
  it('decodes Google encoded polylines', () => {
    assert.deepEqual(decodeGooglePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ]);
  });

  it('normalises HTML turn instructions', () => {
    assert.equal(
      stripNavigationInstruction('Turn <b>left</b><div>onto <b>A1</b> &amp; continue</div>'),
      'Turn left. onto A1 & continue'
    );
  });

  it('measures route proximity in metres', () => {
    assert.ok(metersBetween({ lat: 51.5, lon: -0.1 }, { lat: 51.5009, lon: -0.1 }) > 90);
    assert.ok(distanceToSegmentMeters(
      { lat: 51.5002, lon: -0.1 },
      { lat: 51.5, lon: -0.101 },
      { lat: 51.5, lon: -0.099 },
    ) > 15);
  });

  it('tracks curved route geometry instead of the straight step chord', () => {
    const path = [
      { lat: 51.5, lon: -0.1 },
      { lat: 51.501, lon: -0.1 },
      { lat: 51.501, lon: -0.098 },
    ];
    const atBend = path[1]!;

    assert.ok(distanceToSegmentMeters(atBend, path[0]!, path[2]!) > 40);
    assert.equal(distanceToPathMeters(atBend, path), 0);

    const remaining = remainingDistanceOnPathMeters(atBend, path);
    assert.ok(remaining > 130 && remaining < 150);

    const lookAhead = lookAheadCoordinateOnPath(atBend, path, 70);
    assert.ok(Math.abs(lookAhead.lat - 51.501) < 0.00001);
    assert.ok(lookAhead.lon > -0.1 && lookAhead.lon < -0.098);
  });

  it('parses a Google Directions response into route and steps', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({
      status: 'OK',
      routes: [{
        overview_polyline: { points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
        legs: [{
          distance: { value: 1200 },
          duration: { value: 300 },
          steps: [{
            html_instructions: 'Turn <b>left</b> onto A1',
            maneuver: 'turn-left',
            distance: { value: 1200 },
            duration: { value: 300 },
            start_location: { lat: 51.5, lng: -0.1 },
            end_location: { lat: 51.51, lng: -0.11 },
            polyline: { points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          }],
        }],
      }],
    }), { status: 200 })) as typeof fetch;

    const route = await fetchDrivingRoute(
      { lat: 51.5, lon: -0.1 },
      { lat: 51.51, lon: -0.11, label: 'Destination' },
      'test-key',
      fakeFetch
    );

    assert.equal(route.steps[0]?.instruction, 'Turn left onto A1');
    assert.equal(route.steps[0]?.maneuver, 'turn-left');
    assert.equal(route.distanceMeters, 1200);
    assert.equal(route.durationSeconds, 300);
    assert.equal(route.coordinates.length, 3);
    assert.equal(route.steps[0]?.coordinates.length, 3);
  });

  it('fails cleanly when directions are not configured or no route exists', async () => {
    await assert.rejects(
      () => fetchDrivingRoute({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, ''),
      /directions_not_configured/
    );

    const noRouteFetch = (async () => new Response(JSON.stringify({ status: 'ZERO_RESULTS', routes: [] }), { status: 200 })) as typeof fetch;
    await assert.rejects(
      () => fetchDrivingRoute({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, 'key', noRouteFetch),
      /directions_no_route/
    );
  });
});
