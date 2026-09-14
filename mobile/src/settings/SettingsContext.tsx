import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProfileUpdate, RiderProfile, ZoneTier } from '@rider-comms/shared';
import { DEFAULT_AVATAR_ID } from './avatars';
import { RiderCommsClient } from '../api/client';
import { API_BASE_URL } from '../config';

// Settings are backend-backed now: the rider-comms backend is the source of
// truth for a rider's profile (see shared/src/social.ts RiderProfile and
// api/client.ts getProfile/updateProfile). This local cache exists only so
// the app has something to render instantly on launch and keeps working
// offline — it is never the thing other devices/sessions would trust.
const CACHE_KEY = '@rider-comms/settings/cachedProfile';

// No auth in this prototype — every screen hardcodes the same rider id.
const RIDER_ID = 'me';

const client = new RiderCommsClient(API_BASE_URL);

const DEFAULT_ZONE_TIER: ZoneTier = 'free';
const DEFAULT_DISPLAY_NAME = 'Rider';
const DEFAULT_HANDLE = '@rider';

export type UnitSystem = 'mi' | 'km';
const DEFAULT_UNIT_SYSTEM: UnitSystem = 'mi';

const DEFAULT_NOTIFY_NEARBY = true;
const DEFAULT_NOTIFY_INVITES = true;
const DEFAULT_NOTIFY_CHAT = true;
const DEFAULT_SHARE_LOCATION = true;

interface CachedProfile {
  zoneTier: ZoneTier;
  avatarId: string;
  displayName: string;
  handle: string;
  unitSystem: UnitSystem;
  notifyNearby: boolean;
  notifyInvites: boolean;
  notifyChat: boolean;
  shareLocation: boolean;
}

const DEFAULT_CACHED_PROFILE: CachedProfile = {
  zoneTier: DEFAULT_ZONE_TIER,
  avatarId: DEFAULT_AVATAR_ID,
  displayName: DEFAULT_DISPLAY_NAME,
  handle: DEFAULT_HANDLE,
  unitSystem: DEFAULT_UNIT_SYSTEM,
  notifyNearby: DEFAULT_NOTIFY_NEARBY,
  notifyInvites: DEFAULT_NOTIFY_INVITES,
  notifyChat: DEFAULT_NOTIFY_CHAT,
  shareLocation: DEFAULT_SHARE_LOCATION,
};

function isZoneTier(value: unknown): value is ZoneTier {
  return value === 'free' || value === 'premium' || value === 'premium_plus';
}

function isUnitSystem(value: unknown): value is UnitSystem {
  return value === 'mi' || value === 'km';
}

/** Best-effort parse of whatever's in the cache key; missing/malformed fields fall back to defaults. */
function parseCache(raw: string | null): CachedProfile {
  if (!raw) return DEFAULT_CACHED_PROFILE;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedProfile>;
    return {
      zoneTier: isZoneTier(parsed.zoneTier) ? parsed.zoneTier : DEFAULT_ZONE_TIER,
      avatarId: typeof parsed.avatarId === 'string' && parsed.avatarId ? parsed.avatarId : DEFAULT_AVATAR_ID,
      displayName:
        typeof parsed.displayName === 'string' && parsed.displayName ? parsed.displayName : DEFAULT_DISPLAY_NAME,
      handle: typeof parsed.handle === 'string' && parsed.handle ? parsed.handle : DEFAULT_HANDLE,
      unitSystem: isUnitSystem(parsed.unitSystem) ? parsed.unitSystem : DEFAULT_UNIT_SYSTEM,
      notifyNearby: typeof parsed.notifyNearby === 'boolean' ? parsed.notifyNearby : DEFAULT_NOTIFY_NEARBY,
      notifyInvites: typeof parsed.notifyInvites === 'boolean' ? parsed.notifyInvites : DEFAULT_NOTIFY_INVITES,
      notifyChat: typeof parsed.notifyChat === 'boolean' ? parsed.notifyChat : DEFAULT_NOTIFY_CHAT,
      shareLocation: typeof parsed.shareLocation === 'boolean' ? parsed.shareLocation : DEFAULT_SHARE_LOCATION,
    };
  } catch {
    return DEFAULT_CACHED_PROFILE;
  }
}

function profileToCache(profile: RiderProfile): CachedProfile {
  return {
    zoneTier: profile.zoneTier,
    avatarId: profile.avatarId,
    displayName: profile.displayName,
    handle: profile.handle,
    unitSystem: profile.unitSystem,
    notifyNearby: profile.notifyNearby,
    notifyInvites: profile.notifyInvites,
    notifyChat: profile.notifyChat,
    shareLocation: profile.shareLocation,
  };
}

function writeCache(cache: CachedProfile): void {
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache)).catch(() => {
    // Best-effort local cache write — the backend remains the source of
    // truth either way, this just misses out on an instant offline render.
  });
}

interface SettingsContextValue {
  zoneTier: ZoneTier;
  setZoneTier: (tier: ZoneTier) => void;
  avatarId: string;
  setAvatarId: (id: string) => void;
  displayName: string;
  setDisplayName: (name: string) => void;
  handle: string;
  setHandle: (handle: string) => void;
  unitSystem: UnitSystem;
  setUnitSystem: (unit: UnitSystem) => void;
  notifyNearby: boolean;
  setNotifyNearby: (value: boolean) => void;
  notifyInvites: boolean;
  setNotifyInvites: (value: boolean) => void;
  notifyChat: boolean;
  setNotifyChat: (value: boolean) => void;
  shareLocation: boolean;
  setShareLocation: (value: boolean) => void;
  /** Resets in-memory state to defaults, clears the local cache, and pushes the reset to the backend. */
  resetAll: () => void;
  /** False until the local cache (or lack of it) has been read once — the initial backend sync may still be in flight. */
  loaded: boolean;
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [zoneTier, setZoneTierState] = React.useState<ZoneTier>(DEFAULT_ZONE_TIER);
  const [avatarId, setAvatarIdState] = React.useState<string>(DEFAULT_AVATAR_ID);
  const [displayName, setDisplayNameState] = React.useState<string>(DEFAULT_DISPLAY_NAME);
  const [handle, setHandleState] = React.useState<string>(DEFAULT_HANDLE);
  const [unitSystem, setUnitSystemState] = React.useState<UnitSystem>(DEFAULT_UNIT_SYSTEM);
  const [notifyNearby, setNotifyNearbyState] = React.useState<boolean>(DEFAULT_NOTIFY_NEARBY);
  const [notifyInvites, setNotifyInvitesState] = React.useState<boolean>(DEFAULT_NOTIFY_INVITES);
  const [notifyChat, setNotifyChatState] = React.useState<boolean>(DEFAULT_NOTIFY_CHAT);
  const [shareLocation, setShareLocationState] = React.useState<boolean>(DEFAULT_SHARE_LOCATION);
  const [loaded, setLoaded] = React.useState(false);

  const applyCache = React.useCallback((cache: CachedProfile) => {
    setZoneTierState(cache.zoneTier);
    setAvatarIdState(cache.avatarId);
    setDisplayNameState(cache.displayName);
    setHandleState(cache.handle);
    setUnitSystemState(cache.unitSystem);
    setNotifyNearbyState(cache.notifyNearby);
    setNotifyInvitesState(cache.notifyInvites);
    setNotifyChatState(cache.notifyChat);
    setShareLocationState(cache.shareLocation);
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => {
        if (cancelled) return;
        // Render instantly from whatever's cached locally (or defaults) so
        // there's no flash-of-defaults while the network call below is
        // still in flight — this is a cache-for-speed, not the source of
        // truth, so getting here at all is enough to mark `loaded`.
        applyCache(parseCache(raw));
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });

    client
      .getProfile(RIDER_ID)
      .then((profile) => {
        if (cancelled) return;
        const cache = profileToCache(profile);
        applyCache(cache);
        writeCache(cache);
      })
      .catch(() => {
        // Offline, backend not running, whatever — keep whatever the local
        // cache/defaults already gave us. The app stays usable, it just
        // won't be synced with the backend until a future call succeeds.
      });

    return () => {
      cancelled = true;
    };
  }, [applyCache]);

  // TODO: a real app needs a retry/sync-conflict story for failed writes
  // (queue-and-retry, last-write-wins vs. merge, etc). For now a failed
  // updateProfile call fails silently and the optimistic local state is
  // left as-is, same tradeoff as MapScreen's getCurrentLocation() stub.

  const setZoneTier = React.useCallback((tier: ZoneTier) => {
    setZoneTierState(tier);
    writeCache({ zoneTier: tier, avatarId, displayName, handle, unitSystem, notifyNearby, notifyInvites, notifyChat, shareLocation });
    client.updateProfile(RIDER_ID, { zoneTier: tier }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarId, displayName, handle, unitSystem, notifyNearby, notifyInvites, notifyChat, shareLocation]);

  const setAvatarId = React.useCallback((id: string) => {
    setAvatarIdState(id);
    writeCache({ zoneTier, avatarId: id, displayName, handle, unitSystem, notifyNearby, notifyInvites, notifyChat, shareLocation });
    client.updateProfile(RIDER_ID, { avatarId: id }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneTier, displayName, handle, unitSystem, notifyNearby, notifyInvites, notifyChat, shareLocation]);

  const setDisplayName = React.useCallback((name: string) => {
    const trimmed = name.trim() || DEFAULT_DISPLAY_NAME;
    setDisplayNameState(trimmed);
    writeCache({ zoneTier, avatarId, displayName: trimmed, handle, unitSystem, notifyNearby, notifyInvites, notifyChat, shareLocation });
    client.updateProfile(RIDER_ID, { displayName: trimmed }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneTier, avatarId, handle, unitSystem, notifyNearby, notifyInvites, notifyChat, shareLocation]);

  const setHandle = React.useCallback((next: string) => {
    const trimmed = next.trim() || DEFAULT_HANDLE;
    setHandleState(trimmed);
    writeCache({ zoneTier, avatarId, displayName, handle: trimmed, unitSystem, notifyNearby, notifyInvites, notifyChat, shareLocation });
    client.updateProfile(RIDER_ID, { handle: trimmed }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneTier, avatarId, displayName, unitSystem, notifyNearby, notifyInvites, notifyChat, shareLocation]);

  const setUnitSystem = React.useCallback((unit: UnitSystem) => {
    setUnitSystemState(unit);
    writeCache({ zoneTier, avatarId, displayName, handle, unitSystem: unit, notifyNearby, notifyInvites, notifyChat, shareLocation });
    client.updateProfile(RIDER_ID, { unitSystem: unit }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneTier, avatarId, displayName, handle, notifyNearby, notifyInvites, notifyChat, shareLocation]);

  const setNotifyNearby = React.useCallback((value: boolean) => {
    setNotifyNearbyState(value);
    writeCache({ zoneTier, avatarId, displayName, handle, unitSystem, notifyNearby: value, notifyInvites, notifyChat, shareLocation });
    client.updateProfile(RIDER_ID, { notifyNearby: value }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneTier, avatarId, displayName, handle, unitSystem, notifyInvites, notifyChat, shareLocation]);

  const setNotifyInvites = React.useCallback((value: boolean) => {
    setNotifyInvitesState(value);
    writeCache({ zoneTier, avatarId, displayName, handle, unitSystem, notifyNearby, notifyInvites: value, notifyChat, shareLocation });
    client.updateProfile(RIDER_ID, { notifyInvites: value }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneTier, avatarId, displayName, handle, unitSystem, notifyNearby, notifyChat, shareLocation]);

  const setNotifyChat = React.useCallback((value: boolean) => {
    setNotifyChatState(value);
    writeCache({ zoneTier, avatarId, displayName, handle, unitSystem, notifyNearby, notifyInvites, notifyChat: value, shareLocation });
    client.updateProfile(RIDER_ID, { notifyChat: value }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneTier, avatarId, displayName, handle, unitSystem, notifyNearby, notifyInvites, shareLocation]);

  const setShareLocation = React.useCallback((value: boolean) => {
    setShareLocationState(value);
    writeCache({ zoneTier, avatarId, displayName, handle, unitSystem, notifyNearby, notifyInvites, notifyChat, shareLocation: value });
    client.updateProfile(RIDER_ID, { shareLocation: value }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneTier, avatarId, displayName, handle, unitSystem, notifyNearby, notifyInvites, notifyChat]);

  const resetAll = React.useCallback(() => {
    applyCache(DEFAULT_CACHED_PROFILE);
    AsyncStorage.removeItem(CACHE_KEY).catch(() => {
      // Best-effort clear — in-memory state is already reset either way.
    });
    client
      .updateProfile(RIDER_ID, {
        zoneTier: DEFAULT_CACHED_PROFILE.zoneTier,
        avatarId: DEFAULT_CACHED_PROFILE.avatarId,
        displayName: DEFAULT_CACHED_PROFILE.displayName,
        handle: DEFAULT_CACHED_PROFILE.handle,
        unitSystem: DEFAULT_CACHED_PROFILE.unitSystem,
        notifyNearby: DEFAULT_CACHED_PROFILE.notifyNearby,
        notifyInvites: DEFAULT_CACHED_PROFILE.notifyInvites,
        notifyChat: DEFAULT_CACHED_PROFILE.notifyChat,
        shareLocation: DEFAULT_CACHED_PROFILE.shareLocation,
      } satisfies ProfileUpdate)
      .catch(() => {
        // Same silent-failure tradeoff as the per-field setters above.
      });
  }, [applyCache]);

  const value = React.useMemo(
    () => ({
      zoneTier,
      setZoneTier,
      avatarId,
      setAvatarId,
      displayName,
      setDisplayName,
      handle,
      setHandle,
      unitSystem,
      setUnitSystem,
      notifyNearby,
      setNotifyNearby,
      notifyInvites,
      setNotifyInvites,
      notifyChat,
      setNotifyChat,
      shareLocation,
      setShareLocation,
      resetAll,
      loaded,
    }),
    [
      zoneTier,
      setZoneTier,
      avatarId,
      setAvatarId,
      displayName,
      setDisplayName,
      handle,
      setHandle,
      unitSystem,
      setUnitSystem,
      notifyNearby,
      setNotifyNearby,
      notifyInvites,
      setNotifyInvites,
      notifyChat,
      setNotifyChat,
      shareLocation,
      setShareLocation,
      resetAll,
      loaded,
    ]
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
