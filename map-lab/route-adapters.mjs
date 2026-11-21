// No network access. Translates strictly bounded open routing responses into
// the display-only GeoJSON contract. Never imports Google route/places data.
// Actual service connections must go through an authenticated backend later.
import { MAX_ROUTE_POINTS, parseOpenRoute } from './open-route.mjs';

const MAX_SHAPE_CHARS = MAX_ROUTE_POINTS * 16;
const MAX_LEGS = 21;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Valhalla returns 6-decimal latitude/longitude varints, unlike Google polyline5. */
export function decodeValhallaPolyline6(shape) {
  if (typeof shape !== 'string' || shape.length === 0 || shape.length > MAX_SHAPE_CHARS) {
    throw new RangeError('Invalid Valhalla polyline6 shape length');
  }
  let index = 0;
  let latE6 = 0;
  let lonE6 = 0;
  const points = [];
  function readSignedDelta() {
    let value = 0;
    let multiplier = 1;
    for (let digit = 0; digit < 7; digit += 1) {
      if (index >= shape.length) throw new RangeError('Truncated polyline6 varint');
      const code = shape.charCodeAt(index++) - 63;
      if (code < 0 || code > 63) throw new RangeError('Invalid polyline6 character');
      value += (code & 31) * multiplier;
      if (code < 32) {
        const signed = value % 2 === 0 ? value / 2 : -(value + 1) / 2;
        if (!Number.isSafeInteger(signed)) throw new RangeError('Invalid polyline6 delta');
        return signed;
      }
      multiplier *= 32;
    }
    throw new RangeError('Polyline6 varint exceeds maximum length');
  }
  while (index < shape.length) {
    if (points.length >= MAX_ROUTE_POINTS) throw new RangeError('Polyline6 has too many points');
    latE6 += readSignedDelta();
    lonE6 += readSignedDelta();
    if (!Number.isSafeInteger(latE6) || !Number.isSafeInteger(lonE6)
        || Math.abs(latE6) > 90_000_000 || Math.abs(lonE6) > 180_000_000) {
      throw new RangeError('Polyline6 coordinate outside WGS84 range');
    }
    points.push([lonE6 / 1_000_000, latE6 / 1_000_000]);
  }
  if (points.length < 2) throw new RangeError('Polyline6 needs at least two points');
  return points;
}

/** OSRM must be called with geometries=geojson&overview=full. */
export function fromOsrmGeojson(response) {
  if (!object(response) || response.code !== 'Ok'
      || !Array.isArray(response.routes) || response.routes.length < 1
      || !object(response.routes[0])
      || !object(response.routes[0].geometry)
      || response.routes[0].geometry.type !== 'LineString') {
    throw new Error('Invalid OSRM GeoJSON route response');
  }
  const first = response.routes[0];
  return parseOpenRoute({
    provenance: { engine: 'osrm', mapData: 'openstreetmap' },
    coordinates: first.geometry.coordinates,
    distanceMeters: first.distance,
    durationSeconds: first.duration,
  });
}

/** Valhalla route responses carry leg shapes in encoded polyline6.
 * Summary lengths are kilometres or miles; summary times are seconds.
 * Adjacent legs share their end/start point. No route or traffic data is fetched.
 */
export function fromValhallaTrip(response) {
  const trip = response?.trip;
  if (!object(response) || !object(trip)
      || trip.status !== 0
      || !['kilometers', 'miles'].includes(trip.units)
      || !object(trip.summary)
      || !Array.isArray(trip.legs)
      || trip.legs.length < 1 || trip.legs.length > MAX_LEGS) {
    throw new Error('Invalid Valhalla trip response');
  }
  const points = [];
  for (const leg of trip.legs) {
    if (!object(leg)) throw new Error('Invalid Valhalla leg');
    const coordinates = decodeValhallaPolyline6(leg.shape);
    const last = points[points.length - 1];
    if (last && (last[0] !== coordinates[0][0] || last[1] !== coordinates[0][1])) {
      throw new Error('Valhalla leg geometry is disconnected');
    }
    points.push(...(last ? coordinates.slice(1) : coordinates));
    if (points.length > MAX_ROUTE_POINTS) throw new RangeError('Valhalla route too large');
  }
  return parseOpenRoute({
    provenance: { engine: 'valhalla', mapData: 'openstreetmap' },
    coordinates: points,
    distanceMeters: trip.summary.length * (trip.units === 'miles' ? 1609.344 : 1000),
    durationSeconds: trip.summary.time,
  });
}
