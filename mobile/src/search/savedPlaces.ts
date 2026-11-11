import type { PlaceResult } from '../api/places.ts';
import { toPlaceResult } from './recentPlaces.ts';

/** The places a rider keeps one tap away in the Where to drawer. */
export type SavedPlaceSlot = 'home' | 'work';
export type SavedPlaces = Partial<Record<SavedPlaceSlot, PlaceResult>>;

export const SAVED_PLACE_SLOTS: readonly SavedPlaceSlot[] = ['home', 'work'];
export const SAVED_PLACE_LABELS: Record<SavedPlaceSlot, string> = { home: 'Home', work: 'Work' };

/** Kept on this device for this rider, like recent places (PWA: riderComms.savedPlaces). */
export function savedPlacesStorageKey(riderId: string): string {
  return `@rider-comms/saved-places/${riderId}`;
}

export function parseSavedPlaces(raw: string | null): SavedPlaces {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const saved: SavedPlaces = {};
    for (const slot of SAVED_PLACE_SLOTS) {
      const place = toPlaceResult(value[slot]);
      if (place) saved[slot] = { ...place, distanceMeters: 0 };
    }
    return saved;
  } catch {
    return {};
  }
}

/** Sets a slot, or clears it when place is null. */
export function withSavedPlace(current: SavedPlaces, slot: SavedPlaceSlot, place: PlaceResult | null): SavedPlaces {
  const next = { ...current };
  if (place) next[slot] = { ...place, distanceMeters: 0 };
  else delete next[slot];
  return next;
}
