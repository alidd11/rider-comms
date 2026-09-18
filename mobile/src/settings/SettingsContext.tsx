import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProfileUpdate, RiderProfile, SocialVisibility, ZoneTier } from '@rider-comms/shared';
import { DEFAULT_AVATAR_ID } from './avatars';
import { useAuth } from '../auth/AuthContext';
import { ensureNotificationPermission } from '../notifications/permissions';
import { resolveNotificationPreference } from '../notifications/preference';
import { ApiError } from '../api/client';
import {
  DEFAULT_NAVIGATION_PROVIDER,
  navigationProviderStorageKey,
  parseNavigationProvider,
  type NavigationProvider,
} from '../navigationPreference';

const LEGACY_CACHE_KEY = '@rider-comms/settings/cachedProfile';
const cacheKey = (riderId: string): string => `@rider-comms/settings/profile/${riderId}`;
export type UnitSystem = 'mi' | 'km';
const DEFAULTS: Omit<RiderProfile, 'riderId' | 'updatedAt'> = {
  zoneTier: 'free', avatarId: DEFAULT_AVATAR_ID, displayName: 'Rider', handle: '@rider', unitSystem: 'mi',
  notifyNearby: false, notifyInvites: false, notifyChat: false, shareLocation: false,
  instagramUsername: '', instagramVisibility: 'friends', tiktokUsername: '', tiktokVisibility: 'friends',
};
type ProfileState = typeof DEFAULTS;
interface SettingsContextValue extends ProfileState {
  navigationProvider: NavigationProvider;
  loaded: boolean;
  saving: boolean;
  profileError: string | null;
  clearProfileError: () => void;
  setZoneTier: (v: ZoneTier) => void; setAvatarId: (v: string) => void; setDisplayName: (v: string) => void;
  setHandle: (v: string) => void; setUnitSystem: (v: UnitSystem) => void; setNotifyNearby: (v: boolean) => void;
  setNotifyInvites: (v: boolean) => void; setNotifyChat: (v: boolean) => void; setShareLocation: (v: boolean) => void;
  setInstagramUsername: (v: string) => void; setInstagramVisibility: (v: SocialVisibility) => void;
  setTiktokUsername: (v: string) => void; setTiktokVisibility: (v: SocialVisibility) => void;
  setNavigationProvider: (v: NavigationProvider) => void; resetAll: () => void;
}
const SettingsContext = React.createContext<SettingsContextValue | null>(null);
function validCached(raw: string | null): Partial<ProfileState> { try { return raw ? JSON.parse(raw) as Partial<ProfileState> : {}; } catch { return {}; } }

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { riderId, client } = useAuth();
  const [state, setState] = React.useState<ProfileState>(DEFAULTS); const [loaded, setLoaded] = React.useState(false);
  const [navigationProvider, setNavigationProviderState] = React.useState<NavigationProvider>(DEFAULT_NAVIGATION_PROVIDER);
  const [saving, setSaving] = React.useState(false);
  const [profileError, setProfileError] = React.useState<string | null>(null);
  const saveQueue = React.useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = React.useRef(0);
  const stateRef = React.useRef<ProfileState>(DEFAULTS);
  React.useEffect(() => { stateRef.current = state; }, [state]);
  React.useEffect(() => { const key = cacheKey(riderId); let cancelled = false; setLoaded(false); void AsyncStorage.removeItem(LEGACY_CACHE_KEY); AsyncStorage.getItem(key).then((raw) => { if (!cancelled) { setState({ ...DEFAULTS, ...validCached(raw) }); setLoaded(true); } }).catch(() => setLoaded(true)); client.getProfile(riderId).then((profile) => { if (!cancelled) { const { riderId: _id, updatedAt: _at, ...value } = profile; setState(value); void AsyncStorage.setItem(key, JSON.stringify(value)); setLoaded(true); } }).catch(() => {}); return () => { cancelled = true; }; }, [client, riderId]);
  React.useEffect(() => {
    let cancelled = false;
    setNavigationProviderState(DEFAULT_NAVIGATION_PROVIDER);
    AsyncStorage.getItem(navigationProviderStorageKey(riderId))
      .then((value) => { if (!cancelled) setNavigationProviderState(parseNavigationProvider(value)); })
      .catch(() => { if (!cancelled) setNavigationProviderState(DEFAULT_NAVIGATION_PROVIDER); });
    return () => { cancelled = true; };
  }, [riderId]);
  const update = React.useCallback(<K extends keyof ProfileState>(key: K, value: ProfileState[K]) => {
    const previousValue = stateRef.current[key];
    const optimistic = { ...stateRef.current, [key]: value };
    stateRef.current = optimistic;
    setState(optimistic);
    void AsyncStorage.setItem(cacheKey(riderId), JSON.stringify(optimistic));
    setProfileError(null);
    pendingSaves.current += 1;
    setSaving(true);
    saveQueue.current = saveQueue.current
      .then(async () => {
        await client.updateProfile(riderId, { [key]: value } as ProfileUpdate);
      })
      .catch((error: unknown) => {
        const code = error instanceof ApiError && typeof error.body === 'object' && error.body && 'error' in (error.body as Record<string, unknown>)
          ? String((error.body as Record<string, unknown>).error)
          : '';
        setProfileError(code === 'handle_taken'
          ? 'That handle is already in use. Choose another one.'
          : code.startsWith('handle ')
            ? 'Use a handle that starts with @ and contains only letters, numbers, or underscores.'
            : 'Your profile change could not be saved. Check your connection and try again.');
        setState((current) => {
          // Only roll this field back when the rider has not typed a newer
          // value while the failed request was queued.
          if (current[key] !== value) return current;
          const reverted = { ...current, [key]: previousValue };
          stateRef.current = reverted;
          void AsyncStorage.setItem(cacheKey(riderId), JSON.stringify(reverted));
          return reverted;
        });
      })
      .finally(() => {
        pendingSaves.current -= 1;
        setSaving(pendingSaves.current > 0);
      });
  }, [client, riderId]);

  const updateNotification = React.useCallback((key: 'notifyNearby' | 'notifyInvites' | 'notifyChat', value: boolean) => {
    if (!value) {
      update(key, false);
      return;
    }
    setProfileError(null);
    void resolveNotificationPreference(true, ensureNotificationPermission)
      .then((granted) => {
        if (!granted) {
          setProfileError('Notifications are blocked by the operating system. Allow them in device settings, then try again.');
          return;
        }
        update(key, true);
      })
      .catch(() => {
        setProfileError('Rider Comms could not request notification permission. Try again from device settings.');
      });
  }, [update]);
  const setters = React.useMemo(() => ({
    setZoneTier: (v: ZoneTier) => update('zoneTier', v), setAvatarId: (v: string) => update('avatarId', v),
    setDisplayName: (v: string) => update('displayName', v.trim() || 'Rider'), setHandle: (v: string) => update('handle', v.trim() || '@rider'),
    setUnitSystem: (v: UnitSystem) => update('unitSystem', v), setNotifyNearby: (v: boolean) => updateNotification('notifyNearby', v),
    setNotifyInvites: (v: boolean) => updateNotification('notifyInvites', v), setNotifyChat: (v: boolean) => updateNotification('notifyChat', v),
    setShareLocation: (v: boolean) => update('shareLocation', v), setInstagramUsername: (v: string) => update('instagramUsername', v.replace(/^@/, '').trim()),
    setInstagramVisibility: (v: SocialVisibility) => update('instagramVisibility', v), setTiktokUsername: (v: string) => update('tiktokUsername', v.replace(/^@/, '').trim()),
    setTiktokVisibility: (v: SocialVisibility) => update('tiktokVisibility', v),
  }), [update, updateNotification]);
  const setNavigationProvider = React.useCallback((value: NavigationProvider) => {
    const next = parseNavigationProvider(value);
    setNavigationProviderState(next);
    void AsyncStorage.setItem(navigationProviderStorageKey(riderId), next);
  }, [riderId]);
  const resetAll = React.useCallback(() => {
    stateRef.current = DEFAULTS;
    setState(DEFAULTS);
    setNavigationProviderState(DEFAULT_NAVIGATION_PROVIDER);
    void AsyncStorage.removeItem(cacheKey(riderId));
    void AsyncStorage.removeItem(navigationProviderStorageKey(riderId));
    void client.updateProfile(riderId, DEFAULTS).catch(() => setProfileError('Your settings could not be reset on the server.'));
  }, [client, riderId]);
  const clearProfileError = React.useCallback(() => setProfileError(null), []);
  const value = React.useMemo(() => ({ ...state, ...setters, navigationProvider, setNavigationProvider, loaded, saving, profileError, clearProfileError, resetAll }), [state, setters, navigationProvider, setNavigationProvider, loaded, saving, profileError, clearProfileError, resetAll]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
export function useSettings(): SettingsContextValue { const value = React.useContext(SettingsContext); if (!value) throw new Error('useSettings() must be called within SettingsProvider'); return value; }
