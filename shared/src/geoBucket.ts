import { toRadians } from './distance.ts';
import type { GeoPoint } from './types.ts';

export interface BucketCoord {
  x: number;
  y: number;
}

const MILES_PER_DEGREE_LAT = 69.0;

/**
 * Bucket size in miles. This is pure infrastructure sharding (Section 5 of
 * the spec) so one SFU room never has to span an entire state — it's
 * invisible to riders, who only ever perceive their own zone. Sized
 * comfortably larger than the biggest radius tier (Premium+, 20mi) so two
 * riders whose zones could ever overlap are guaranteed to already share a
 * bucket or be in an adjacent one.
 */
export const BUCKET_SIZE_MILES = 40;

function milesPerDegreeLon(lat: number): number {
  return MILES_PER_DEGREE_LAT * Math.cos(toRadians(lat));
}

export function getBucketCoord(
  point: GeoPoint,
  bucketSizeMiles = BUCKET_SIZE_MILES
): BucketCoord {
  const degreesPerBucketLat = bucketSizeMiles / MILES_PER_DEGREE_LAT;
  const degreesPerBucketLon = bucketSizeMiles / milesPerDegreeLon(point.lat);
  return {
    x: Math.floor(point.lon / degreesPerBucketLon),
    y: Math.floor(point.lat / degreesPerBucketLat),
  };
}

export function bucketId(coord: BucketCoord): string {
  return `${coord.x}:${coord.y}`;
}

/**
 * The bucket a point falls in, plus its 8 neighbors. Riders near a bucket
 * boundary must be matched against neighboring buckets too — otherwise two
 * riders a few hundred feet apart, on opposite sides of an arbitrary grid
 * line, would never be matched into the same zone at all. Always query
 * this full set when looking for zone candidates, never just a rider's own
 * bucket.
 */
export function getNeighboringBucketIds(
  point: GeoPoint,
  bucketSizeMiles = BUCKET_SIZE_MILES
): string[] {
  const center = getBucketCoord(point, bucketSizeMiles);
  const ids: string[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      ids.push(bucketId({ x: center.x + dx, y: center.y + dy }));
    }
  }
  return ids;
}
