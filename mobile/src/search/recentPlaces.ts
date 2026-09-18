import type { PlaceResult } from '../api/places';

export const RECENT_PLACES_MAX = 6;

export function recentPlacesStorageKey(riderId: string): string {
  return `@rider-comms/search-recents/${riderId}`;
}

export function parseRecentPlaces(raw: string | null): PlaceResult[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is PlaceResult =>
        Boolean(item)
        && typeof item.id === 'string'
        && item.id.length > 0
        && typeof item.name === 'string'
        && typeof item.address === 'string'
        && Number.isFinite(item.lat)
        && item.lat >= -90
        && item.lat <= 90
        && Number.isFinite(item.lon)
        && item.lon >= -180
        && item.lon <= 180
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        address: item.address,
        lat: item.lat,
        lon: item.lon,
        distanceMeters: Number.isFinite(item.distanceMeters) && item.distanceMeters >= 0 ? item.distanceMeters : 0,
      }))
      .slice(0, RECENT_PLACES_MAX);
  } catch {
    return [];
  }
}

export function addRecentPlace(current: PlaceResult[], place: PlaceResult): PlaceResult[] {
  return [place, ...current.filter((item) => item.id !== place.id)].slice(0, RECENT_PLACES_MAX);
}
