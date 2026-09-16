// TODO(native): full POI search on the map needs the native map SDK work
// tracked separately (react-native-maps is not installed — see MapScreen.tsx's
// header note on the illustrative SVG map) before a selected result can be
// panned to on a real map. This module is the search half only: it queries
// Google's Places API (Text Search, New) directly, the same way the PWA
// loads the Maps JavaScript API directly client-side with a deployment-
// injected browser key (see docs/app.js's loadGoogleMaps()) — no backend
// proxy is needed for this, Places keys are restricted by app
// bundle-id/SHA1 fingerprint in the Google Cloud console, not by request
// origin, so shipping the key in the app bundle via EXPO_PUBLIC_* is the
// standard approach for native (see .env.example).

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const MAX_QUERY_LENGTH = 200;

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  distanceMeters: number;
}

/** Query validation only — no network call — so this is unit-testable
 * without a key or a live API. */
export function isSearchQueryValid(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_QUERY_LENGTH;
}

interface PlacesApiPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
}

interface PlacesApiResponse {
  places?: PlacesApiPlace[];
}

export function distanceBetweenMeters(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): number {
  const radians = Math.PI / 180;
  const lat1 = from.lat * radians;
  const lat2 = to.lat * radians;
  const deltaLat = (to.lat - from.lat) * radians;
  const deltaLon = (to.lon - from.lon) * radians;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatPlaceDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1_000) return `${Math.max(50, Math.round(meters / 50) * 50)} m`;
  return `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

/**
 * Searches Google Places for `query`, biased toward `near`. Returns an
 * empty array (never throws) when the API key is missing/empty or the
 * request fails — the same graceful-fallback contract MapScreen.tsx's
 * getCurrentLocation() stub and the PWA's loadGoogleMaps() already use for
 * "the mapping feature is unavailable right now," so callers can render a
 * neutral empty/unavailable state rather than an error.
 */
export async function searchPlaces(
  query: string,
  near: { lat: number; lon: number },
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<PlaceResult[]> {
  if (!apiKey || !isSearchQueryValid(query)) return [];

  try {
    const response = await fetchImpl(PLACES_TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        textQuery: query.trim(),
        locationBias: {
          circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50_000 },
        },
        maxResultCount: 8,
      }),
    });
    if (!response.ok) return [];

    const data = (await response.json()) as PlacesApiResponse;
    return (data.places ?? [])
      .filter(
        (place): place is PlacesApiPlace & { location: { latitude: number; longitude: number } } =>
          typeof place.location?.latitude === 'number' && typeof place.location?.longitude === 'number'
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
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  } catch {
    return [];
  }
}
