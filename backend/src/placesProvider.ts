import { haversineMeters } from '@rider-comms/shared';
import type { RouteCoordinate } from './directionsProvider.ts';
import { log } from './log.ts';

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

/** Google's reason for refusing a request (e.g. PERMISSION_DENIED "Places API
 * (New) has not been used in project …", or a key restriction), logged so a
 * misconfigured key is diagnosable from the logs. The key is never logged. */
async function logGoogleRefusal(response: Response): Promise<void> {
  let status: string | undefined;
  let message: string | undefined;
  try {
    const body = await response.json() as { error?: { status?: unknown; message?: unknown } };
    if (typeof body?.error?.status === 'string') status = body.error.status;
    if (typeof body?.error?.message === 'string') message = body.error.message.slice(0, 400);
  } catch {
    // Not JSON: the HTTP status alone is still worth logging.
  }
  log('warn', 'places_provider_refused', { httpStatus: response.status, googleStatus: status, googleMessage: message });
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
    if (!response.ok) {
      await logGoogleRefusal(response);
      throw new PlacesProviderError('places_unavailable');
    }

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

// --- Autocomplete, then details for the chosen place -----------------------
// Search as you type uses Places (New) Autocomplete with a session token, as
// the web app does with the Maps JavaScript API: suggestions are cheap and
// fast, and the session closes with one Place Details call for the place the
// rider picks. Text Search stays for a typed query with no pick.

export interface PlaceSuggestion {
  id: string;
  name: string;
  address: string;
  /** Straight-line distance from `near`, when Google returns one. */
  distanceMeters?: number;
}

export interface PlaceAutocompleteRequest {
  input: string;
  near: RouteCoordinate;
  sessionToken: string;
}

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const DETAILS_FIELD_MASK = 'id,displayName,formattedAddress,location';
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const MAX_SUGGESTIONS = 8;

export function normalizeSessionToken(value: unknown): string | null {
  return typeof value === 'string' && SESSION_TOKEN_PATTERN.test(value) ? value : null;
}

export function normalizePlaceId(value: unknown): string | null {
  return typeof value === 'string' && PLACE_ID_PATTERN.test(value) ? value : null;
}

async function callPlaces(url: string, init: RequestInit, options: GooglePlacesOptions): Promise<unknown> {
  const apiKey = options.apiKey
    ?? (process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_DIRECTIONS_API_KEY || '');
  if (!apiKey) throw new PlacesProviderError('places_not_configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(url, {
        ...init,
        headers: { Accept: 'application/json', 'X-Goog-Api-Key': apiKey, ...(init.headers as Record<string, string>) },
        signal: controller.signal,
      });
    } catch {
      throw new PlacesProviderError(controller.signal.aborted ? 'places_timeout' : 'places_unavailable');
    }
    if (response.status === 429) throw new PlacesProviderError('places_rate_limited');
    if (!response.ok) {
      await logGoogleRefusal(response);
      throw new PlacesProviderError('places_unavailable');
    }
    try {
      return await response.json();
    } catch {
      throw new PlacesProviderError('places_invalid_response');
    }
  } finally {
    clearTimeout(timeout);
  }
}

function text(value: unknown): string {
  return value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string'
    ? (value as { text: string }).text
    : '';
}

export async function fetchGooglePlaceSuggestions(
  request: PlaceAutocompleteRequest,
  options: GooglePlacesOptions = {},
): Promise<PlaceSuggestion[]> {
  if (normalizePlaceQuery(request.input) === null || normalizeSessionToken(request.sessionToken) === null
    || !isLatitude(request.near?.lat) || !isLongitude(request.near?.lon)) {
    throw new PlacesProviderError('places_invalid_request');
  }
  const center = { latitude: request.near.lat, longitude: request.near.lon };
  const payload = await callPlaces(AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: request.input,
      sessionToken: request.sessionToken,
      locationBias: { circle: { center, radius: TEXT_SEARCH_BIAS_RADIUS_METERS } },
      origin: center,
    }),
  }, options);
  if (!payload || typeof payload !== 'object') throw new PlacesProviderError('places_invalid_response');
  const suggestions = (payload as { suggestions?: unknown }).suggestions;
  if (suggestions === undefined) return [];
  if (!Array.isArray(suggestions)) throw new PlacesProviderError('places_invalid_response');
  const results: PlaceSuggestion[] = [];
  for (const suggestion of suggestions) {
    const prediction = suggestion && typeof suggestion === 'object' ? (suggestion as { placePrediction?: Record<string, unknown> }).placePrediction : undefined;
    const id = normalizePlaceId(prediction?.placeId);
    if (!prediction || !id) continue;
    const structured = prediction.structuredFormat as { mainText?: unknown; secondaryText?: unknown } | undefined;
    const name = text(structured?.mainText) || text(prediction.text) || 'Unnamed place';
    const distance = prediction.distanceMeters;
    results.push({
      id,
      name,
      address: text(structured?.secondaryText),
      ...(typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 ? { distanceMeters: distance } : {}),
    });
    if (results.length === MAX_SUGGESTIONS) break;
  }
  return results;
}

export async function fetchGooglePlaceDetails(
  placeId: string,
  sessionToken: string,
  options: GooglePlacesOptions = {},
): Promise<PlaceSummary> {
  const id = normalizePlaceId(placeId);
  const token = normalizeSessionToken(sessionToken);
  if (!id || !token) throw new PlacesProviderError('places_invalid_request');
  const payload = await callPlaces(`${DETAILS_URL}${encodeURIComponent(id)}?sessionToken=${encodeURIComponent(token)}`, {
    method: 'GET',
    headers: { 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
  }, options);
  const place = payload as GooglePlace | null;
  const lat = place?.location?.latitude;
  const lon = place?.location?.longitude;
  if (!place || !isLatitude(lat) || !isLongitude(lon)) throw new PlacesProviderError('places_invalid_response');
  return {
    id: typeof place.id === 'string' && place.id ? place.id : id,
    name: typeof place.displayName?.text === 'string' && place.displayName.text ? place.displayName.text : 'Unnamed place',
    address: typeof place.formattedAddress === 'string' ? place.formattedAddress : '',
    lat,
    lon,
  };
}

// --- Search along the route ---------------------------------------------
// Petrol (or a café) on the way, not just near the rider: Google's search
// along a route, given the rest of the route as a line. Each place comes with
// the time to ride there and on to the end of the line, so the app can say
// how much it adds ("+3 min") against the time it has left.

export interface PlaceAlongRoute extends PlaceSummary {
  /** Seconds from the rider, via this place, to the end of the route. */
  travelSeconds?: number;
}

export interface PlaceAlongRouteRequest {
  query: string;
  /** The rest of the route, from the rider onwards. */
  path: RouteCoordinate[];
}

export const MAX_ROUTE_PATH_POINTS = 400;
const ALONG_ROUTE_RESULTS = 5;

/** The rest of a route as sent by the apps: 2 to 400 valid coordinates. */
export function normalizeRoutePath(value: unknown): RouteCoordinate[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_ROUTE_PATH_POINTS) return null;
  const path: RouteCoordinate[] = [];
  for (const point of value) {
    const lat = (point as { lat?: unknown })?.lat;
    const lon = (point as { lon?: unknown })?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isLatitude(lat) || !isLongitude(lon)) return null;
    path.push({ lat, lon });
  }
  return path;
}

/** Google's encoded polyline format (the inverse of decodeGooglePolyline). */
export function encodeGooglePolyline(points: readonly RouteCoordinate[]): string {
  let lastLat = 0;
  let lastLon = 0;
  let encoded = '';
  const encodeValue = (value: number) => {
    let shifted = value < 0 ? ~(value << 1) : value << 1;
    while (shifted >= 0x20) {
      encoded += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
      shifted >>= 5;
    }
    encoded += String.fromCharCode(shifted + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lon = Math.round(point.lon * 1e5);
    encodeValue(lat - lastLat);
    encodeValue(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return encoded;
}

function routingSummarySeconds(summary: unknown): number | undefined {
  const legs = (summary as { legs?: Array<{ duration?: unknown }> } | null)?.legs;
  if (!Array.isArray(legs) || legs.length === 0) return undefined;
  let total = 0;
  for (const leg of legs) {
    const match = typeof leg?.duration === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(leg.duration) : null;
    if (!match) return undefined;
    total += Number(match[1]);
  }
  return Math.round(total);
}

export async function fetchGooglePlacesAlongRoute(
  request: PlaceAlongRouteRequest,
  options: GooglePlacesOptions = {},
): Promise<PlaceAlongRoute[]> {
  const query = normalizePlaceQuery(request.query);
  const path = normalizeRoutePath(request.path);
  if (!query || !path) throw new PlacesProviderError('places_invalid_request');
  const origin = path[0]!;
  const payload = await callPlaces(TEXT_SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-FieldMask': `${FIELD_MASK},routingSummaries` },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: ALONG_ROUTE_RESULTS,
      searchAlongRouteParameters: { polyline: { encodedPolyline: encodeGooglePolyline(path) } },
      routingParameters: { origin: { latitude: origin.lat, longitude: origin.lon }, travelMode: 'DRIVE' },
    }),
  }, options);
  const places = (payload as { places?: unknown })?.places;
  const summaries = (payload as { routingSummaries?: unknown })?.routingSummaries;
  if (places !== undefined && !Array.isArray(places)) throw new PlacesProviderError('places_invalid_response');
  const results: PlaceAlongRoute[] = [];
  (places ?? []).forEach((raw: GooglePlace, index: number) => {
    if (raw.businessStatus === 'CLOSED_PERMANENTLY') return;
    const lat = raw.location?.latitude;
    const lon = raw.location?.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isLatitude(lat) || !isLongitude(lon)) return;
    const travelSeconds = Array.isArray(summaries) ? routingSummarySeconds(summaries[index]) : undefined;
    results.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : `${lat},${lon}`,
      name: typeof raw.displayName?.text === 'string' && raw.displayName.text ? raw.displayName.text : 'Unnamed place',
      address: typeof raw.formattedAddress === 'string' ? raw.formattedAddress : '',
      lat,
      lon,
      ...(travelSeconds !== undefined ? { travelSeconds } : {}),
    });
  });
  return results;
}
