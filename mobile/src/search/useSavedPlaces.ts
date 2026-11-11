import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlaceResult } from '../api/places';
import { parseSavedPlaces, savedPlacesStorageKey, withSavedPlace } from './savedPlaces';
import type { SavedPlaces, SavedPlaceSlot } from './savedPlaces';

// Every screen using Home and Work (the map's drawer, Settings) hears about
// a change made on another, so they never disagree.
const listeners = new Set<(riderId: string, saved: SavedPlaces) => void>();

/** Home and Work for this rider, kept on the device (PWA: riderComms.savedPlaces). */
export function useSavedPlaces(riderId: string | null | undefined): {
  savedPlaces: SavedPlaces;
  setSavedPlace: (slot: SavedPlaceSlot, place: PlaceResult | null) => void;
} {
  const [savedPlaces, setSavedPlaces] = React.useState<SavedPlaces>({});
  const current = React.useRef<SavedPlaces>({});

  React.useEffect(() => {
    current.current = {};
    setSavedPlaces({});
    if (!riderId) return;
    let cancelled = false;
    AsyncStorage.getItem(savedPlacesStorageKey(riderId))
      .then((raw) => {
        if (cancelled) return;
        current.current = parseSavedPlaces(raw);
        setSavedPlaces(current.current);
      })
      .catch(() => {});
    const listener = (changedRiderId: string, saved: SavedPlaces) => {
      if (changedRiderId !== riderId) return;
      current.current = saved;
      setSavedPlaces(saved);
    };
    listeners.add(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, [riderId]);

  const setSavedPlace = React.useCallback((slot: SavedPlaceSlot, place: PlaceResult | null) => {
    if (!riderId) return;
    const next = withSavedPlace(current.current, slot, place);
    void AsyncStorage.setItem(savedPlacesStorageKey(riderId), JSON.stringify(next)).catch(() => {
      // Saved places are a convenience; the shortcut asks again next time.
    });
    for (const listener of listeners) listener(riderId, next);
  }, [riderId]);

  return { savedPlaces, setSavedPlace };
}
