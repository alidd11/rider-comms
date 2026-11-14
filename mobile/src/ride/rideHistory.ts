import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseRideHistory, rideHistoryStorageKey, withRideHistoryEntry, type RideHistoryEntry } from '@rider-comms/shared';

// Every screen showing recent rides hears about a ride that just ended.
const listeners = new Set<(riderId: string, history: RideHistoryEntry[]) => void>();
// Saves run one after another, so two rides ending close together both land.
let saving: Promise<void> = Promise.resolve();

/** Keeps a finished ride on this device for the rider (PWA: the same key in
 * localStorage). Rides under a minute are left out (shared withRideHistoryEntry). */
export function recordRideHistory(riderId: string, entry: RideHistoryEntry): Promise<void> {
  saving = saving.then(async () => {
    const key = rideHistoryStorageKey(riderId);
    const history = withRideHistoryEntry(parseRideHistory(await AsyncStorage.getItem(key)), entry);
    await AsyncStorage.setItem(key, JSON.stringify(history));
    for (const listener of listeners) listener(riderId, history);
  }).catch(() => {});
  return saving;
}

/** This rider's recent rides, newest first. */
export function useRideHistory(riderId: string | null | undefined): RideHistoryEntry[] {
  const [history, setHistory] = React.useState<RideHistoryEntry[]>([]);
  React.useEffect(() => {
    setHistory([]);
    if (!riderId) return;
    let cancelled = false;
    AsyncStorage.getItem(rideHistoryStorageKey(riderId))
      .then((raw) => { if (!cancelled) setHistory(parseRideHistory(raw)); })
      .catch(() => {});
    const listener = (changedRiderId: string, next: RideHistoryEntry[]) => {
      if (changedRiderId === riderId) setHistory(next);
    };
    listeners.add(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, [riderId]);
  return history;
}
