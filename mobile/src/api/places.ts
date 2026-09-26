// Native results are rendered list-first, then the selected place is focused
// on the react-native-maps surface. This module queries Google's Places API
// (Text Search, New) directly, the same way the PWA
// loads the Maps JavaScript API directly client-side with a deployment-
// injected browser key (see docs/app.js's loadGoogleMaps()) — no backend
// proxy is needed for this, Places keys are restricted by app
// bundle-id/SHA1 fingerprint in the Google Cloud console, not by request
// origin, so shipping the key in the app bundle via EXPO_PUBLIC_* is the
// standard approach for native (see .env.example).
import { haversineMeters } from '@rider-comms/shared';

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const MAX_QUERY_LENGTH = 200;
export const MIN_PLACE_SEARCH_QUERY_LENGTH = 2;
export const PLACE_SEARCH_DEBOUNCE_MS = 500;
const NEARBY_RADIUS_METERS = 5_000;

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  distanceMeters: number;
}

export type PlaceSearchFailure = 'unavailable' | 'rate-limited' | 'network-error' | 'provider-error';

export type PlaceSearchResult =
  | { status: 'ok'; places: PlaceResult[] }
  | { status: PlaceSearchFailure; places: [] };

/** Query validation only — no network call — so this is unit-testable
 * without a key or a live API. */
export function isSearchQueryValid(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length >= MIN_PLACE_SEARCH_QUERY_LENGTH && trimmed.length <= MAX_QUERY_LENGTH;
}

interface PlacesApiPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
}

interface PlacesApiResponse {
  places?: PlacesApiPlace[];
}

export interface PlaceCategory {
  includedTypes: readonly string[];
}

export function distanceBetweenMeters(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): number {
  return haversineMeters(from, to);
}

export function formatPlaceDistance(meters: number, unit: 'mi' | 'km' = 'km'): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (unit === 'mi') {
    const feet = meters * 3.28084;
    if (feet < 1_000) return `${Math.max(50, Math.round(feet / 50) * 50)} ft`;
    const miles = meters / 1_609.344;
    return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
  }
  if (meters < 1_000) return `${Math.max(50, Math.round(meters / 50) * 50)} m`;
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/**
 * Searches Google Places for `query`, biased toward `near`. Returns a typed
 * result so callers never present quota, provider, configuration, or
 * network failures as a genuine zero-result search.
 */
export async function searchPlaces(
  query: string,
  near: { lat: number; lon: number },
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<PlaceSearchResult> {
  if (!apiKey) return { status: 'unavailable', places: [] };
  if (!isSearchQueryValid(query)) return { status: 'ok', places: [] };

  let response: Response;
  try {
    response = await fetchImpl(PLACES_TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus',
      },
      body: JSON.stringify({
        textQuery: query.trim(),
        locationBias: {
          circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 15_000 },
        },
        maxResultCount: 8,
      }),
    });
  } catch {
    return { status: 'network-error', places: [] };
  }
  if (response.status === 429) return { status: 'rate-limited', places: [] };
  if (!response.ok) return { status: 'provider-error', places: [] };

  const data = await readPlacesResponse(response);
  if (!data) return { status: 'provider-error', places: [] };
  return { status: 'ok', places: mapPlaces(data, near) };
}

/** Category chips use Nearby Search rather than a text query. This makes
 * the category an actual type filter, keeps every result inside the rider's
 * local search radius, and asks Google to rank by distance. */
export async function searchNearbyPlaces(
  category: PlaceCategory,
  near: { lat: number; lon: number },
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<PlaceSearchResult> {
  if (!apiKey) return { status: 'unavailable', places: [] };
  if (category.includedTypes.length === 0) return { status: 'ok', places: [] };

  let response: Response;
  try {
    response = await fetchImpl(PLACES_NEARBY_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus',
      },
      body: JSON.stringify({
        includedTypes: category.includedTypes,
        maxResultCount: 8,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: { center: { latitude: near.lat, longitude: near.lon }, radius: NEARBY_RADIUS_METERS },
        },
      }),
    });
  } catch {
    return { status: 'network-error', places: [] };
  }
  if (response.status === 429) return { status: 'rate-limited', places: [] };
  if (!response.ok) return { status: 'provider-error', places: [] };

  const data = await readPlacesResponse(response);
  if (!data) return { status: 'provider-error', places: [] };
  return {
    status: 'ok',
    places: mapPlaces(data, near)
      .filter((place) => place.distanceMeters <= NEARBY_RADIUS_METERS)
      .sort((a, b) => a.distanceMeters - b.distanceMeters),
  };
}

async function readPlacesResponse(response: Response): Promise<PlacesApiResponse | null> {
  try {
    const data: unknown = await response.json();
    return isPlacesApiResponse(data) ? data : null;
  } catch {
    return null;
  }
}

function isPlacesApiResponse(value: unknown): value is PlacesApiResponse {
  if (!value || typeof value !== 'object') return false;
  const places = (value as PlacesApiResponse).places;
  return places === undefined || Array.isArray(places);
}

function mapPlaces(data: PlacesApiResponse, near: { lat: number; lon: number }): PlaceResult[] {
  return (data.places ?? [])
      .filter((place): place is PlacesApiPlace => Boolean(place) && typeof place === 'object')
      .filter((place) => place.businessStatus !== 'CLOSED_PERMANENTLY')
      .filter(
        (place): place is PlacesApiPlace & { location: { latitude: number; longitude: number } } =>
          typeof place.location?.latitude === 'number' && Number.isFinite(place.location.latitude)
          && place.location.latitude >= -90 && place.location.latitude <= 90
          && typeof place.location?.longitude === 'number' && Number.isFinite(place.location.longitude)
          && place.location.longitude >= -180 && place.location.longitude <= 180
      )
      .map((place) => {
        const result = {
          id: place.id ?? `${place.location.latitude},${place.location.longitude}`,
          name: place.displayName?.text ?? 'Unnamed place',
          address: place.formattedAddress ?? '',
          lat: place.location.latitude,
          lon: place.location.longitude,
        };
        return { ...result, distanceMeters: distanceBetweenMeters(near, result) };
      });
}
