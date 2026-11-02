import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceToPathMeters,
  distanceToSegmentMeters,
  lookAheadCoordinateOnPath,
  metersBetween,
  remainingDistanceOnPathMeters,
} from '../src/api/directions.ts';

describe('native in-app directions helpers', () => {
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
});

describe('route progress on multi-segment paths', () => {
  const path = [
    { lat: 51.5, lon: -0.1 },
    { lat: 51.501, lon: -0.1 },
    { lat: 51.501, lon: -0.1 },
    { lat: 51.502, lon: -0.1 },
  ];

  it('measures what is left from the nearest later segment', () => {
    const remaining = remainingDistanceOnPathMeters({ lat: 51.5015, lon: -0.1 }, path);
    assert.ok(Math.abs(remaining - metersBetween({ lat: 51.5015, lon: -0.1 }, path[3]!)) < 2);
  });

  it('looks ahead past zero-length segments and stops at the end of the route', () => {
    const ahead = lookAheadCoordinateOnPath({ lat: 51.5009, lon: -0.1 }, path, 50);
    assert.ok(ahead.lat > 51.501 && ahead.lat < 51.502);
    const beyond = lookAheadCoordinateOnPath({ lat: 51.5015, lon: -0.1 }, path, 5_000);
    assert.deepEqual(beyond, path[3]);
  });
});
