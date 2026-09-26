const MILES_PER_DEGREE_LAT = 69;

export interface LatLonBoundingBox {
  minLat: number;
  maxLat: number;
  /** SQL fragment (a plain BETWEEN, or the antimeridian-wrapping OR form)
   * using placeholder indices starting at the given startParamIndex, or ''
   * when the search radius wraps the entire longitude range. */
  longitudeClause: string;
  /** Values to append to the query's parameter array, in the same order as
   * the placeholders used in longitudeClause. */
  longitudeParams: number[];
}

/**
 * Indexed lat/lon bounding box for a radius search, used to narrow a
 * Postgres query to candidate rows before the exact great-circle distance
 * is checked. Longitude degrees shrink toward the poles, so the longitude
 * half-width is scaled by cos(latitude) rather than reusing the same delta
 * as latitude; near +-90 that scale approaches zero and the search simply
 * spans every longitude instead of dividing by it.
 */
export function latLonBoundingBox(
  center: { lat: number; lon: number },
  radiusMiles: number,
  startParamIndex: number,
): LatLonBoundingBox {
  const latDelta = radiusMiles / MILES_PER_DEGREE_LAT;
  const minLat = Math.max(-90, center.lat - latDelta);
  const maxLat = Math.min(90, center.lat + latDelta);
  const longitudeScale = MILES_PER_DEGREE_LAT * Math.abs(Math.cos(center.lat * Math.PI / 180));
  const lonDelta = longitudeScale < 0.000001 ? 180 : Math.min(180, radiusMiles / longitudeScale);
  if (lonDelta >= 180) return { minLat, maxLat, longitudeClause: '', longitudeParams: [] };

  const minLon = center.lon - lonDelta;
  const maxLon = center.lon + lonDelta;
  const p1 = startParamIndex;
  const p2 = startParamIndex + 1;
  if (minLon < -180) {
    return { minLat, maxLat, longitudeClause: `AND (lon >= $${p1} OR lon <= $${p2})`, longitudeParams: [minLon + 360, maxLon] };
  }
  if (maxLon > 180) {
    return { minLat, maxLat, longitudeClause: `AND (lon >= $${p1} OR lon <= $${p2})`, longitudeParams: [minLon, maxLon - 360] };
  }
  return { minLat, maxLat, longitudeClause: `AND lon BETWEEN $${p1} AND $${p2}`, longitudeParams: [minLon, maxLon] };
}
