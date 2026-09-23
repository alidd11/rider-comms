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
  durationSeconds: number;
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

export interface GoogleDirectionsOptions {
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
  const leg = route?.legs?.[0];
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
