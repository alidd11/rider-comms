import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ZoneTier } from '@rider-comms/shared';

const STORAGE_KEY = '@rider-comms/settings/zoneTier';
const DEFAULT_ZONE_TIER: ZoneTier = 'free';

interface SettingsContextValue {
  zoneTier: ZoneTier;
  setZoneTier: (tier: ZoneTier) => void;
  /** False until the persisted value (or lack of one) has been read once. */
  loaded: boolean;
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null);

function isZoneTier(value: string | null): value is ZoneTier {
  return value === 'free' || value === 'premium' || value === 'premium_plus';
}

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [zoneTier, setZoneTierState] = React.useState<ZoneTier>(DEFAULT_ZONE_TIER);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (!cancelled && isZoneTier(stored)) {
        setZoneTierState(stored);
      }
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setZoneTier = React.useCallback((tier: ZoneTier) => {
    setZoneTierState(tier);
    AsyncStorage.setItem(STORAGE_KEY, tier).catch(() => {
      // Best-effort persistence — the setting still works for this session
      // if storage write fails (e.g. full disk), it just won't survive restart.
    });
  }, []);

  const value = React.useMemo(() => ({ zoneTier, setZoneTier, loaded }), [zoneTier, setZoneTier, loaded]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = React.useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings() must be called within a SettingsProvider');
  }
  return ctx;
}
