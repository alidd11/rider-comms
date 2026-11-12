import type { PlaceResult } from '../api/places';

export const RECENT_PLACES_MAX = 6;

export function recentPlacesStorageKey(riderId: string): string {
  return `@rider-comms/search-recents/${riderId}`;
}

/** A stored place, checked field by field; anything malformed is dropped. */
export function toPlaceResult(item: unknown): PlaceResult | null {
  if (!item || typeof item !== 'object') return null;
  const place = item as Record<string, unknown>;
  if (
    typeof place.id !== 'string' || place.id.length === 0
    || typeof place.name !== 'string'
    || typeof place.address !== 'string'
    || typeof place.lat !== 'number' || !Number.isFinite(place.lat) || place.lat < -90 || place.lat > 90
    || typeof place.lon !== 'number' || !Number.isFinite(place.lon) || place.lon < -180 || place.lon > 180
  ) return null;
  const distance = place.distanceMeters;
  return {
    id: place.id,
    name: place.name,
    address: place.address,
    lat: place.lat,
    lon: place.lon,
    distanceMeters: typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 ? distance : 0,
  };
}

export function parseRecentPlaces(raw: string | null): PlaceResult[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .map(toPlaceResult)
      .filter((place): place is PlaceResult => place !== null)
      .slice(0, RECENT_PLACES_MAX);
  } catch {
    return [];
  }
}

export function addRecentPlace(current: PlaceResult[], place: PlaceResult): PlaceResult[] {
  return [place, ...current.filter((item) => item.id !== place.id)].slice(0, RECENT_PLACES_MAX);
}
