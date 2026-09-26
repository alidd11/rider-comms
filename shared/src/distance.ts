import type { GeoPoint } from './types.ts';

const EARTH_RADIUS_MILES = 3958.7613;
const EARTH_RADIUS_METERS = 6_371_000;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Shared half-angle term of the haversine formula, for a given earth radius. */
function haversineDistance(a: GeoPoint, b: GeoPoint, radius: number): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  // Clamping h before asin (rather than atan2(sqrt(h), sqrt(1 - h))) guards
  // against a NaN result when floating-point rounding pushes h fractionally
  // past 1 for two nearly-antipodal points.
  return radius * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle distance between two points, in miles. */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  return haversineDistance(a, b, EARTH_RADIUS_MILES);
}

/** Great-circle distance between two points, in meters. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  return haversineDistance(a, b, EARTH_RADIUS_METERS);
}
