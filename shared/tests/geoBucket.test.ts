import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import {
  BUCKET_SIZE_MILES,
  bucketId,
  getBucketCoord,
  getNeighboringBucketIds,
} from '../src/geoBucket.ts';

describe('getBucketCoord', () => {
  it('assigns the same bucket to two points that are close together', () => {
    const a = { lat: 40.0, lon: -105.0 };
    const b = { lat: 40.01, lon: -105.01 }; // well under BUCKET_SIZE_MILES apart
    expect(getBucketCoord(a)).toEqual(getBucketCoord(b));
  });

  it('assigns different buckets to points far apart', () => {
    const a = { lat: 40.0, lon: -105.0 };
    const b = { lat: 45.0, lon: -110.0 };
    expect(getBucketCoord(a)).not.toEqual(getBucketCoord(b));
  });
});

describe('getNeighboringBucketIds', () => {
  it('returns 9 ids (self + 8 neighbors)', () => {
    const ids = getNeighboringBucketIds({ lat: 40.0, lon: -105.0 });
    expect(new Set(ids).size).toBe(9);
  });

  it('includes the point\'s own bucket id', () => {
    const point = { lat: 40.0, lon: -105.0 };
    const ownId = bucketId(getBucketCoord(point));
    expect(getNeighboringBucketIds(point)).toContain(ownId);
  });

  it('solves the boundary problem: two riders just across a bucket edge share a neighboring bucket', () => {
    // Pick a point, then a second point roughly BUCKET_SIZE_MILES away in
    // longitude (i.e. likely across a bucket boundary) but still close in
    // real-world terms — their neighbor sets must overlap.
    const a = { lat: 40.0, lon: -105.0 };
    const degreesPerBucketLon = BUCKET_SIZE_MILES / (69.0 * Math.cos((40.0 * Math.PI) / 180));
    const b = { lat: 40.0, lon: -105.0 + degreesPerBucketLon * 0.99 };

    const neighborsA = new Set(getNeighboringBucketIds(a));
    const neighborsB = new Set(getNeighboringBucketIds(b));
    const overlap = [...neighborsA].some((id) => neighborsB.has(id));
    expect(overlap).toBe(true);
  });
});
