// Native results are rendered list-first, then the selected place is focused
// on the react-native-maps surface. Place search goes through the Rider Comms
// backend, which holds the Google Places key server-side and rate-limits per
// rider; the app bundle carries no Places credential, the same model as
// in-app routing's `/directions` proxy.
// - Typing: `/places/autocomplete` suggestions within one search session,
//   then `/places/details` for the pick, which ends the session (the web app
//   does the same with the Maps JavaScript API).
// - Category chips: `/places/nearby`, which returns full places.
import { haversineMeters } from '@rider-comms/shared';
import { ApiError } from './client.ts';
import type { PlaceSuggestionSummary, PlaceSummary, RiderCommsClient } from './client.ts';

const MAX_QUERY_LENGTH = 200;
export const MIN_PLACE_SEARCH_QUERY_LENGTH = 2;
export const PLACE_SEARCH_DEBOUNCE_MS = 500;
/** Suggestions are cheap within a session, so typing gets a quicker answer
 * (the web app waits 220ms). */
export const PLACE_SUGGEST_DEBOUNCE_MS = 250;
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

export type PlacesClient = Pick<RiderCommsClient, 'searchNearbyPlaces' | 'suggestPlaces' | 'placeDetails'>;

/** Category chips use a nearby type search rather than a text query, so the
 * category is an actual type filter, results stay inside the rider's local
 * search radius, and they come back ordered by distance. */
export async function searchNearbyPlaces(
  category: PlaceCategory,
  near: { lat: number; lon: number },
  client: PlacesClient,
): Promise<PlaceSearchResult> {
  if (category.includedTypes.length === 0) return { status: 'ok', places: [] };
  const result = await runSearch(() => client.searchNearbyPlaces(category.includedTypes, near), near);
  if (result.status !== 'ok') return result;
  return {
    status: 'ok',
    places: result.places
      .filter((place) => place.distanceMeters <= NEARBY_RADIUS_METERS)
      .sort((a, b) => a.distanceMeters - b.distanceMeters),
  };
}

async function runSearch(
  request: () => Promise<{ places?: unknown }>,
  near: { lat: number; lon: number },
): Promise<PlaceSearchResult> {
  let response: { places?: unknown };
  try {
    response = await request();
  } catch (error) {
    return { status: searchFailureFor(error), places: [] };
  }
  if (!response || typeof response !== 'object' || !Array.isArray(response.places)) {
    return { status: 'provider-error', places: [] };
  }
  return { status: 'ok', places: mapPlaces(response.places, near) };
}

function searchFailureFor(error: unknown): PlaceSearchFailure {
  if (!(error instanceof ApiError)) return 'network-error';
  if (error.status === 429) return 'rate-limited';
  if (error.status === 503) return 'unavailable';
  return 'provider-error';
}

function isPlaceSummary(value: unknown): value is PlaceSummary {
  if (!value || typeof value !== 'object') return false;
  const place = value as Record<string, unknown>;
  return typeof place.id === 'string'
    && typeof place.name === 'string'
    && typeof place.address === 'string'
    && typeof place.lat === 'number' && Number.isFinite(place.lat) && place.lat >= -90 && place.lat <= 90
    && typeof place.lon === 'number' && Number.isFinite(place.lon) && place.lon >= -180 && place.lon <= 180;
}

function mapPlaces(places: unknown[], near: { lat: number; lon: number }): PlaceResult[] {
  return places
    .filter(isPlaceSummary)
    .map((place) => ({
      id: place.id,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lon: place.lon,
      distanceMeters: distanceBetweenMeters(near, place),
    }));
}

export interface PlaceSuggestion {
  id: string;
  name: string;
  address: string;
  /** From Google, measured from the rider, when it has one. */
  distanceMeters?: number;
}

export type PlaceSuggestResult =
  | { status: 'ok'; suggestions: PlaceSuggestion[] }
  | { status: PlaceSearchFailure; suggestions: [] };

export type PlaceDetailsResult =
  | { status: 'ok'; place: PlaceResult }
  | { status: PlaceSearchFailure };

/** A new search session: suggestions share it, the details call ends it. */
export function newPlaceSearchSession(random: () => number = Math.random): string {
  let token = 'rc';
  for (let index = 0; index < 30; index += 1) token += Math.floor(random() * 16).toString(16);
  return token;
}

function isPlaceSuggestion(value: unknown): value is PlaceSuggestionSummary {
  if (!value || typeof value !== 'object') return false;
  const suggestion = value as Record<string, unknown>;
  return typeof suggestion.id === 'string' && suggestion.id.length > 0
    && typeof suggestion.name === 'string'
    && typeof suggestion.address === 'string'
    && (suggestion.distanceMeters === undefined
      || (typeof suggestion.distanceMeters === 'number' && Number.isFinite(suggestion.distanceMeters) && suggestion.distanceMeters >= 0));
}

export async function suggestPlaces(
  query: string,
  near: { lat: number; lon: number },
  sessionToken: string,
  client: PlacesClient,
): Promise<PlaceSuggestResult> {
  if (!isSearchQueryValid(query)) return { status: 'ok', suggestions: [] };
  let response: { suggestions?: unknown };
  try {
    response = await client.suggestPlaces(query.trim(), near, sessionToken);
  } catch (error) {
    return { status: searchFailureFor(error), suggestions: [] };
  }
  if (!response || typeof response !== 'object' || !Array.isArray(response.suggestions)) {
    return { status: 'provider-error', suggestions: [] };
  }
  return {
    status: 'ok',
    suggestions: response.suggestions.filter(isPlaceSuggestion).map((suggestion) => ({
      id: suggestion.id,
      name: suggestion.name,
      address: suggestion.address,
      ...(suggestion.distanceMeters === undefined ? {} : { distanceMeters: suggestion.distanceMeters }),
    })),
  };
}

export async function placeDetails(
  placeId: string,
  sessionToken: string,
  near: { lat: number; lon: number } | null,
  client: PlacesClient,
): Promise<PlaceDetailsResult> {
  let response: { place?: unknown };
  try {
    response = await client.placeDetails(placeId, sessionToken);
  } catch (error) {
    return { status: searchFailureFor(error) };
  }
  const place = response && typeof response === 'object' ? response.place : undefined;
  if (!isPlaceSummary(place)) return { status: 'provider-error' };
  return {
    status: 'ok',
    place: {
      id: place.id,
      name: place.name,
      address: place.address,
      lat: place.lat,
      lon: place.lon,
      distanceMeters: near ? distanceBetweenMeters(near, place) : 0,
    },
  };
}
