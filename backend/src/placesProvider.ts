import { haversineMeters } from '@rider-comms/shared';
import type { RouteCoordinate } from './directionsProvider.ts';

// Server-side Google Places (New) proxy for the native map search bar. The
// key stays on the backend (GOOGLE_PLACES_API_KEY, falling back to the
// Directions key) so the app bundle never carries a reusable Places
// credential. Results are not cached here: Google's Places terms restrict
// storing results, and the native client already keeps a short in-memory
// session cache in front of these calls.

export interface PlaceSummary {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
}

export type PlaceSearchRequest =
  | { kind: 'text'; query: string; near: RouteCoordinate }
  | { kind: 'nearby'; includedTypes: readonly string[]; near: RouteCoordinate };

export type PlacesProviderErrorCode =
  | 'places_invalid_request'
  | 'places_not_configured'
  | 'places_rate_limited'
  | 'places_timeout'
  | 'places_unavailable'
  | 'places_invalid_response';

export class PlacesProviderError extends Error {
  readonly code: PlacesProviderErrorCode;
  constructor(code: PlacesProviderErrorCode) {
    super(code);
    this.code = code;
  }
}

export const MIN_PLACE_QUERY_LENGTH = 2;
export const MAX_PLACE_QUERY_LENGTH = 200;
export const MAX_PLACE_TYPES = 5;
const PLACE_TYPE_PATTERN = /^[a-z][a-z_]{0,49}$/;
const TEXT_SEARCH_BIAS_RADIUS_METERS = 15_000;
export const NEARBY_SEARCH_RADIUS_METERS = 5_000;
const MAX_RESULTS = 8;
const DEFAULT_TIMEOUT_MS = 8_000;
const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus';

export interface GooglePlacesOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface GooglePlace {
  id?: unknown;
  displayName?: { text?: unknown };
  formattedAddress?: unknown;
  location?: { latitude?: unknown; longitude?: unknown };
  businessStatus?: unknown;
}

/** Returns the trimmed query if it is searchable, otherwise null. */
export function normalizePlaceQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= MIN_PLACE_QUERY_LENGTH && trimmed.length <= MAX_PLACE_QUERY_LENGTH ? trimmed : null;
}

/** Returns the de-duplicated type list if every entry looks like a Places
 * type identifier (e.g. `gas_station`), otherwise null. */
export function normalizePlaceTypes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PLACE_TYPES) return null;
  if (!value.every((type) => typeof type === 'string' && PLACE_TYPE_PATTERN.test(type))) return null;
  return [...new Set(value as string[])];
}

function isLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

function parsePlaces(payload: unknown, request: PlaceSearchRequest): PlaceSummary[] {
  if (!payload || typeof payload !== 'object') throw new PlacesProviderError('places_invalid_response');
  const places = (payload as { places?: unknown }).places;
  if (places === undefined) return [];
  if (!Array.isArray(places)) throw new PlacesProviderError('places_invalid_response');

  const results: Array<PlaceSummary & { distanceMeters: number }> = [];
  for (const place of places as GooglePlace[]) {
    if (!place || typeof place !== 'object') continue;
    if (place.businessStatus === 'CLOSED_PERMANENTLY') continue;
    const lat = place.location?.latitude;
    const lon = place.location?.longitude;
    if (!isLatitude(lat) || !isLongitude(lon)) continue;
    const summary: PlaceSummary = {
      id: typeof place.id === 'string' && place.id ? place.id : `${lat},${lon}`,
      name: typeof place.displayName?.text === 'string' && place.displayName.text ? place.displayName.text : 'Unnamed place',
      address: typeof place.formattedAddress === 'string' ? place.formattedAddress : '',
      lat,
      lon,
    };
    results.push({ ...summary, distanceMeters: haversineMeters(request.near, summary) });
  }

  const shaped = request.kind === 'nearby'
    ? results
      .filter((place) => place.distanceMeters <= NEARBY_SEARCH_RADIUS_METERS)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
    : results;
  return shaped.map(({ distanceMeters: _distance, ...place }) => place);
}

function requestBody(request: PlaceSearchRequest): Record<string, unknown> {
  const center = { latitude: request.near.lat, longitude: request.near.lon };
  if (request.kind === 'text') {
    return {
      textQuery: request.query,
      locationBias: { circle: { center, radius: TEXT_SEARCH_BIAS_RADIUS_METERS } },
      maxResultCount: MAX_RESULTS,
    };
  }
  return {
    includedTypes: request.includedTypes,
    maxResultCount: MAX_RESULTS,
    rankPreference: 'DISTANCE',
    locationRestriction: { circle: { center, radius: NEARBY_SEARCH_RADIUS_METERS } },
  };
}

function isValidRequest(request: PlaceSearchRequest): boolean {
  if (!isLatitude(request.near?.lat) || !isLongitude(request.near?.lon)) return false;
  return request.kind === 'text'
    ? normalizePlaceQuery(request.query) !== null
    : normalizePlaceTypes(request.includedTypes) !== null;
}

export async function fetchGooglePlaces(
  request: PlaceSearchRequest,
  options: GooglePlacesOptions = {},
): Promise<PlaceSummary[]> {
  if (!isValidRequest(request)) throw new PlacesProviderError('places_invalid_request');

  const apiKey = options.apiKey
    ?? (process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_DIRECTIONS_API_KEY || '');
  if (!apiKey) throw new PlacesProviderError('places_not_configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(
        request.kind === 'text' ? TEXT_SEARCH_URL : NEARBY_SEARCH_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': FIELD_MASK,
          },
          body: JSON.stringify(requestBody(request)),
          signal: controller.signal,
        },
      );
    } catch {
      throw new PlacesProviderError(controller.signal.aborted ? 'places_timeout' : 'places_unavailable');
    }

    if (response.status === 429) throw new PlacesProviderError('places_rate_limited');
    if (!response.ok) throw new PlacesProviderError('places_unavailable');

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PlacesProviderError('places_invalid_response');
    }
    return parsePlaces(payload, request);
  } finally {
    clearTimeout(timeout);
  }
}
