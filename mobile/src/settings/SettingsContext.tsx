import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ZoneTier } from '@rider-comms/shared';
import { DEFAULT_AVATAR_ID } from './avatars';

const STORAGE_KEY = '@rider-comms/settings/zoneTier';
const AVATAR_STORAGE_KEY = '@rider-comms/settings/avatarId';
const NAME_STORAGE_KEY = '@rider-comms/settings/displayName';
const DEFAULT_ZONE_TIER: ZoneTier = 'free';
const DEFAULT_DISPLAY_NAME = 'Rider';

interface SettingsContextValue {
  zoneTier: ZoneTier;
  setZoneTier: (tier: ZoneTier) => void;
  avatarId: string;
  setAvatarId: (id: string) => void;
  displayName: string;
  setDisplayName: (name: string) => void;
  /** False until the persisted values (or lack of them) have been read once. */
  loaded: boolean;
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null);

function isZoneTier(value: string | null): value is ZoneTier {
  return value === 'free' || value === 'premium' || value === 'premium_plus';
}

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [zoneTier, setZoneTierState] = React.useState<ZoneTier>(DEFAULT_ZONE_TIER);
  const [avatarId, setAvatarIdState] = React.useState<string>(DEFAULT_AVATAR_ID);
  const [displayName, setDisplayNameState] = React.useState<string>(DEFAULT_DISPLAY_NAME);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(AVATAR_STORAGE_KEY),
      AsyncStorage.getItem(NAME_STORAGE_KEY),
    ]).then(([storedTier, storedAvatarId, storedName]) => {
      if (cancelled) return;
      if (isZoneTier(storedTier)) setZoneTierState(storedTier);
      if (storedAvatarId) setAvatarIdState(storedAvatarId);
      if (storedName) setDisplayNameState(storedName);
      setLoaded(true);
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

  const setAvatarId = React.useCallback((id: string) => {
    setAvatarIdState(id);
    AsyncStorage.setItem(AVATAR_STORAGE_KEY, id).catch(() => {
      // Best-effort persistence, same as zoneTier above.
    });
  }, []);

  const setDisplayName = React.useCallback((name: string) => {
    const trimmed = name.trim() || DEFAULT_DISPLAY_NAME;
    setDisplayNameState(trimmed);
    AsyncStorage.setItem(NAME_STORAGE_KEY, trimmed).catch(() => {
      // Best-effort persistence, same as zoneTier above.
    });
  }, []);

  const value = React.useMemo(
    () => ({ zoneTier, setZoneTier, avatarId, setAvatarId, displayName, setDisplayName, loaded }),
    [zoneTier, setZoneTier, avatarId, setAvatarId, displayName, setDisplayName, loaded]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = React.useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings() must be called within a SettingsProvider');
  }
  return ctx;
}
