import type { NavigationTarget } from '../navigationLinks.ts';

export interface RouteCoordinate {
  lat: number;
  lon: number;
}

export interface NavigationRouteStep {
  instruction: string;
  maneuver?: string;
  distanceMeters: number;
  durationSeconds: number;
  start: RouteCoordinate;
  end: RouteCoordinate;
}

export interface InAppNavigationRoute {
  coordinates: RouteCoordinate[];
  steps: NavigationRouteStep[];
  distanceMeters: number;
  durationSeconds: number;
}

interface GoogleDirectionsStep {
  html_instructions?: string;
  maneuver?: string;
  distance?: { value?: number };
  duration?: { value?: number };
  start_location?: { lat?: number; lng?: number };
  end_location?: { lat?: number; lng?: number };
}

interface GoogleDirectionsResponse {
  status?: string;
  error_message?: string;
  routes?: Array<{
    overview_polyline?: { points?: string };
    legs?: Array<{
      distance?: { value?: number };
      duration?: { value?: number };
      steps?: GoogleDirectionsStep[];
    }>;
  }>;
}

const ENTITY_REPLACEMENTS: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function stripNavigationInstruction(value: string): string {
  return value
    .replace(/<div[^>]*>/gi, '. ')
    .replace(/<\/div>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITY_REPLACEMENTS[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
}

export function decodeGooglePolyline(encoded: string): RouteCoordinate[] {
  const coordinates: RouteCoordinate[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return coordinates;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 0;
    shift = 0;
    do {
      if (index >= encoded.length) return coordinates;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }

  return coordinates;
}

function finiteCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function parseCoordinate(value: { lat?: number; lng?: number } | undefined): RouteCoordinate | null {
  if (!value || !finiteCoordinate(value.lat, -90, 90) || !finiteCoordinate(value.lng, -180, 180)) return null;
  return { lat: value.lat, lon: value.lng };
}

export async function fetchDrivingRoute(
  origin: RouteCoordinate,
  target: NavigationTarget,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<InAppNavigationRoute> {
  if (!apiKey) throw new Error('directions_not_configured');

  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lon}`,
    destination: `${target.lat},${target.lon}`,
    mode: 'driving',
    key: apiKey,
  });

  const response = await fetchImpl(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
  if (!response.ok) throw new Error(`directions_http_${response.status}`);

  const payload = await response.json() as GoogleDirectionsResponse;
  if (payload.status !== 'OK') {
    throw new Error(payload.status === 'ZERO_RESULTS' ? 'directions_no_route' : 'directions_failed');
  }

  const route = payload.routes?.[0];
  const leg = route?.legs?.[0];
  const encoded = route?.overview_polyline?.points;
  if (!route || !leg || !encoded || !Array.isArray(leg.steps) || leg.steps.length === 0) {
    throw new Error('directions_invalid_response');
  }

  const steps: NavigationRouteStep[] = leg.steps.map((step) => {
    const start = parseCoordinate(step.start_location);
    const end = parseCoordinate(step.end_location);
    if (!start || !end || !Number.isFinite(step.distance?.value) || !Number.isFinite(step.duration?.value)) {
      throw new Error('directions_invalid_response');
    }
    return {
      instruction: stripNavigationInstruction(step.html_instructions ?? 'Continue'),
      ...(step.maneuver ? { maneuver: step.maneuver } : {}),
      distanceMeters: step.distance!.value!,
      durationSeconds: step.duration!.value!,
      start,
      end,
    };
  });

  const coordinates = decodeGooglePolyline(encoded);
  if (coordinates.length < 2) throw new Error('directions_invalid_response');

  return {
    coordinates,
    steps,
    distanceMeters: Number.isFinite(leg.distance?.value)
      ? leg.distance!.value!
      : steps.reduce((sum, step) => sum + step.distanceMeters, 0),
    durationSeconds: Number.isFinite(leg.duration?.value)
      ? leg.duration!.value!
      : steps.reduce((sum, step) => sum + step.durationSeconds, 0),
  };
}

export function metersBetween(a: RouteCoordinate, b: RouteCoordinate): number {
  const radius = 6_371_000;
  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceToSegmentMeters(
  point: RouteCoordinate,
  segmentStart: RouteCoordinate,
  segmentEnd: RouteCoordinate
): number {
  const metresPerDegreeLat = 111_320;
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos(point.lat * Math.PI / 180);
  const project = (coordinate: RouteCoordinate) => ({
    x: (coordinate.lon - segmentStart.lon) * metresPerDegreeLon,
    y: (coordinate.lat - segmentStart.lat) * metresPerDegreeLat,
  });
  const p = project(point);
  const b = project(segmentEnd);
  const lengthSquared = b.x * b.x + b.y * b.y;
  const ratio = lengthSquared > 0
    ? Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / lengthSquared))
    : 0;
  return Math.hypot(p.x - ratio * b.x, p.y - ratio * b.y);
}
