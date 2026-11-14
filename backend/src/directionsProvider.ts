import { normalizeNavigationInstructionText } from '@rider-comms/shared';

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
  coordinates: RouteCoordinate[];
}

export interface DrivingRoute {
  coordinates: RouteCoordinate[];
  steps: NavigationRouteStep[];
  distanceMeters: number;
  /** With live traffic when the route came from the Routes API. */
  durationSeconds: number;
  /** The same trip in normal traffic, when known: the gap is today's delay. */
  typicalDurationSeconds?: number;
  /** Up to two other ways there, for the rider to choose from. */
  alternatives?: DrivingRoute[];
}

export type DirectionsProviderErrorCode =
  | 'directions_invalid_request'
  | 'directions_not_configured'
  | 'directions_timeout'
  | 'directions_unavailable'
  | 'directions_no_route'
  | 'directions_invalid_response';

export class DirectionsProviderError extends Error {
  readonly code: DirectionsProviderErrorCode;
  constructor(code: DirectionsProviderErrorCode) {
    super(code);
    this.code = code;
  }
}

interface GoogleDirectionsStep {
  html_instructions?: string;
  maneuver?: string;
  distance?: { value?: number };
  duration?: { value?: number };
  start_location?: { lat?: number; lng?: number };
  end_location?: { lat?: number; lng?: number };
  polyline?: { points?: string };
}

interface GoogleDirectionsResponse {
  status?: string;
  routes?: Array<{
    overview_polyline?: { points?: string };
    legs?: Array<{
      distance?: { value?: number };
      duration?: { value?: number };
      steps?: GoogleDirectionsStep[];
    }>;
  }>;
}

/** Rider route options. All default to false (Google's fastest route). */
export interface RouteAvoidance {
  highways?: boolean;
  tolls?: boolean;
  ferries?: boolean;
  /** A stop on the way (petrol, a café): the route goes through it. */
  via?: RouteCoordinate;
}

/** Reads `{ highways, tolls, ferries }` from a request body; anything else counts as false. */
export function routeAvoidance(value: unknown): Omit<RouteAvoidance, 'via'> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  const candidate = value as { highways?: unknown; tolls?: unknown; ferries?: unknown };
  return { highways: candidate.highways === true, tolls: candidate.tolls === true, ferries: candidate.ferries === true };
}

export interface GoogleDirectionsOptions {
  avoid?: RouteAvoidance;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

const ENTITY_REPLACEMENTS: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function stripGoogleNavigationInstruction(value: string): string {
  return normalizeNavigationInstructionText(value
    .replace(/<div[^>]*>/gi, '. ')
    .replace(/<\/div>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITY_REPLACEMENTS[entity] ?? entity)
    .replace(/\s+([,.])/g, '$1'));
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

function isCoordinate(value: RouteCoordinate): boolean {
  return Number.isFinite(value.lat) && value.lat >= -90 && value.lat <= 90
    && Number.isFinite(value.lon) && value.lon >= -180 && value.lon <= 180;
}

function parseGoogleCoordinate(value: { lat?: number; lng?: number } | undefined): RouteCoordinate | null {
  if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lng)) return null;
  const coordinate = { lat: value.lat as number, lon: value.lng as number };
  return isCoordinate(coordinate) ? coordinate : null;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseGoogleResponse(payload: GoogleDirectionsResponse): DrivingRoute {
  if (payload.status === 'ZERO_RESULTS') throw new DirectionsProviderError('directions_no_route');
  if (payload.status !== 'OK') throw new DirectionsProviderError('directions_unavailable');

  const route = payload.routes?.[0];
  const legs = route?.legs ?? [];
  // A stop on the way splits the trip into legs: ride them as one route.
  const leg = legs.length > 1
    ? {
      steps: legs.flatMap((part) => part.steps ?? []),
      distance: { value: legs.reduce((sum, part) => sum + (part.distance?.value ?? Number.NaN), 0) },
      duration: { value: legs.reduce((sum, part) => sum + (part.duration?.value ?? Number.NaN), 0) },
    }
    : legs[0];
  const encoded = route?.overview_polyline?.points;
  if (!route || !leg || typeof encoded !== 'string' || !Array.isArray(leg.steps) || leg.steps.length === 0) {
    throw new DirectionsProviderError('directions_invalid_response');
  }

  const coordinates = decodeGooglePolyline(encoded);
  if (coordinates.length < 2) throw new DirectionsProviderError('directions_invalid_response');

  const steps = leg.steps.map((step): NavigationRouteStep => {
    const start = parseGoogleCoordinate(step.start_location);
    const end = parseGoogleCoordinate(step.end_location);
    const instruction = typeof step.html_instructions === 'string'
      ? stripGoogleNavigationInstruction(step.html_instructions)
      : '';
    const encodedStep = step.polyline?.points;
    const stepCoordinates = typeof encodedStep === 'string' ? decodeGooglePolyline(encodedStep) : [];

    if (!start || !end || !instruction
      || !nonNegativeFinite(step.distance?.value)
      || !nonNegativeFinite(step.duration?.value)
      || stepCoordinates.length < 2) {
      throw new DirectionsProviderError('directions_invalid_response');
    }

    return {
      instruction,
      ...(typeof step.maneuver === 'string' && step.maneuver.trim() ? { maneuver: step.maneuver } : {}),
      distanceMeters: step.distance.value,
      durationSeconds: step.duration.value,
      start,
      end,
      coordinates: stepCoordinates,
    };
  });

  return {
    coordinates,
    steps,
    distanceMeters: nonNegativeFinite(leg.distance?.value)
      ? leg.distance.value
      : steps.reduce((sum, step) => sum + step.distanceMeters, 0),
    durationSeconds: nonNegativeFinite(leg.duration?.value)
      ? leg.duration.value
      : steps.reduce((sum, step) => sum + step.durationSeconds, 0),
  };
}

export async function fetchGoogleDrivingRoute(
  origin: RouteCoordinate,
  destination: RouteCoordinate,
  options: GoogleDirectionsOptions = {},
): Promise<DrivingRoute> {
  if (!isCoordinate(origin) || !isCoordinate(destination)) {
    throw new DirectionsProviderError('directions_invalid_request');
  }

  const apiKey = options.apiKey ?? process.env.GOOGLE_DIRECTIONS_API_KEY ?? '';
  if (!apiKey) throw new DirectionsProviderError('directions_not_configured');

  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lon}`,
    destination: `${destination.lat},${destination.lon}`,
    mode: 'driving',
    key: apiKey,
  });
  const avoid = [
    options.avoid?.highways ? 'highways' : null,
    options.avoid?.tolls ? 'tolls' : null,
    options.avoid?.ferries ? 'ferries' : null,
  ].filter((value): value is string => value !== null);
  if (avoid.length) params.set('avoid', avoid.join('|'));
  const via = options.avoid?.via;
  if (via && isCoordinate(via)) params.set('waypoints', `${via.lat},${via.lon}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(
        `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`,
        { headers: { Accept: 'application/json' }, signal: controller.signal },
      );
    } catch {
      throw new DirectionsProviderError(
        controller.signal.aborted ? 'directions_timeout' : 'directions_unavailable',
      );
    }

    if (!response.ok) throw new DirectionsProviderError('directions_unavailable');

    let payload: GoogleDirectionsResponse;
    try {
      payload = await response.json() as GoogleDirectionsResponse;
    } catch {
      throw new DirectionsProviderError('directions_invalid_response');
    }
    return parseGoogleResponse(payload);
  } finally {
    clearTimeout(timeout);
  }
}

// --- Routes API (Google's successor to the Directions API) ----------------
//
// Asked for live-traffic routes and up to two alternatives, like Google Maps
// and Waze. Until the Routes API is switched on for the key, Google answers
// 403 and the legacy Directions API is used instead, so routing never stops.

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ROUTES_FIELD_MASK = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.staticDuration',
  'routes.polyline.encodedPolyline',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.polyline.encodedPolyline',
  'routes.legs.steps.startLocation.latLng',
  'routes.legs.steps.endLocation.latLng',
  'routes.legs.steps.navigationInstruction',
].join(',');

interface RoutesLatLng { latLng?: { latitude?: number; longitude?: number } }
interface RoutesStep {
  distanceMeters?: number;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
  startLocation?: RoutesLatLng;
  endLocation?: RoutesLatLng;
  navigationInstruction?: { maneuver?: string; instructions?: string };
}
interface RoutesRoute {
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
  legs?: Array<{ steps?: RoutesStep[] }>;
}

/** The Routes API isn't enabled for this key (or refuses it): use the legacy API. */
class RoutesApiUnavailable extends Error {}

/** "123s" or "123.4s" → seconds. */
function routesSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match ? Number(match[1]) : null;
}

function routesCoordinate(value: RoutesLatLng | undefined): RouteCoordinate | null {
  const latLng = value?.latLng;
  if (!latLng) return null;
  return parseGoogleCoordinate({ lat: latLng.latitude, lng: latLng.longitude });
}

/** TURN_SLIGHT_LEFT → turn-slight-left, the legacy names both apps draw. */
export function routesManeuver(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value === 'MANEUVER_UNSPECIFIED') return undefined;
  return value.toLowerCase().replace(/_/g, '-');
}

function parseRoutesRoute(route: RoutesRoute): DrivingRoute {
  const encoded = route.polyline?.encodedPolyline;
  // A stop on the way splits the trip into legs: ride them as one route.
  const rawSteps = route.legs?.length ? route.legs.flatMap((leg) => leg.steps ?? []) : undefined;
  if (typeof encoded !== 'string' || !Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new DirectionsProviderError('directions_invalid_response');
  }
  const coordinates = decodeGooglePolyline(encoded);
  if (coordinates.length < 2) throw new DirectionsProviderError('directions_invalid_response');

  const parsed = rawSteps.map((step) => {
    const start = routesCoordinate(step.startLocation);
    const end = routesCoordinate(step.endLocation);
    const stepEncoded = step.polyline?.encodedPolyline;
    const stepCoordinates = typeof stepEncoded === 'string' ? decodeGooglePolyline(stepEncoded) : [];
    const seconds = routesSeconds(step.staticDuration);
    if (!start || !end || !nonNegativeFinite(step.distanceMeters) || seconds === null || stepCoordinates.length < 2) {
      throw new DirectionsProviderError('directions_invalid_response');
    }
    const instruction = normalizeNavigationInstructionText(step.navigationInstruction?.instructions ?? '') || 'Continue';
    const maneuver = routesManeuver(step.navigationInstruction?.maneuver);
    return { instruction, ...(maneuver ? { maneuver } : {}), distanceMeters: step.distanceMeters, seconds, start, end, coordinates: stepCoordinates };
  });

  const typical = routesSeconds(route.staticDuration) ?? parsed.reduce((sum, step) => sum + step.seconds, 0);
  const withTraffic = routesSeconds(route.duration) ?? typical;
  // Google times each step in normal traffic only; spread today's delay
  // across them so the arrival time each app adds up matches the route's.
  const stepTotal = parsed.reduce((sum, step) => sum + step.seconds, 0);
  const scale = stepTotal > 0 ? withTraffic / stepTotal : 1;
  const steps = parsed.map(({ seconds, ...step }): NavigationRouteStep => ({ ...step, durationSeconds: Math.round(seconds * scale) }));

  return {
    coordinates,
    steps,
    distanceMeters: nonNegativeFinite(route.distanceMeters) ? route.distanceMeters : steps.reduce((sum, step) => sum + step.distanceMeters, 0),
    durationSeconds: Math.round(withTraffic),
    typicalDurationSeconds: Math.round(typical),
  };
}

export async function fetchGoogleRoutes(
  origin: RouteCoordinate,
  destination: RouteCoordinate,
  options: GoogleDirectionsOptions = {},
): Promise<DrivingRoute> {
  if (!isCoordinate(origin) || !isCoordinate(destination)) {
    throw new DirectionsProviderError('directions_invalid_request');
  }
  const apiKey = options.apiKey ?? process.env.GOOGLE_DIRECTIONS_API_KEY ?? '';
  if (!apiKey) throw new DirectionsProviderError('directions_not_configured');

  const point = (coordinate: RouteCoordinate) => ({ location: { latLng: { latitude: coordinate.lat, longitude: coordinate.lon } } });
  const body = {
    origin: point(origin),
    destination: point(destination),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    // Google offers no alternatives for a trip with a stop.
    computeAlternativeRoutes: !options.avoid?.via,
    ...(options.avoid?.via && isCoordinate(options.avoid.via) ? { intermediates: [point(options.avoid.via)] } : {}),
    routeModifiers: {
      avoidHighways: options.avoid?.highways === true,
      avoidTolls: options.avoid?.tolls === true,
      avoidFerries: options.avoid?.ferries === true,
    },
    languageCode: 'en-GB',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(ROUTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': ROUTES_FIELD_MASK },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new DirectionsProviderError(controller.signal.aborted ? 'directions_timeout' : 'directions_unavailable');
    }
    if (response.status === 403) throw new RoutesApiUnavailable();
    if (!response.ok) throw new DirectionsProviderError('directions_unavailable');

    let payload: { routes?: RoutesRoute[] };
    try {
      payload = await response.json() as { routes?: RoutesRoute[] };
    } catch {
      throw new DirectionsProviderError('directions_invalid_response');
    }
    const routes = Array.isArray(payload.routes) ? payload.routes : [];
    if (routes.length === 0) throw new DirectionsProviderError('directions_no_route');
    const [best, ...others] = routes.map(parseRoutesRoute);
    const alternatives = others.slice(0, 2);
    return alternatives.length ? { ...best!, alternatives } : best!;
  } finally {
    clearTimeout(timeout);
  }
}

/** Live-traffic routes with alternatives; the legacy Directions API while
 * the Routes API isn't enabled for the key. */
export async function fetchDrivingRoute(
  origin: RouteCoordinate,
  destination: RouteCoordinate,
  options: GoogleDirectionsOptions = {},
): Promise<DrivingRoute> {
  try {
    return await fetchGoogleRoutes(origin, destination, options);
  } catch (error) {
    if (error instanceof RoutesApiUnavailable) return fetchGoogleDrivingRoute(origin, destination, options);
    throw error;
  }
}
