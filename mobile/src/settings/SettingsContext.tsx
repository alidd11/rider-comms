import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProfileUpdate, RiderProfile, SocialVisibility, ZoneTier } from '@rider-comms/shared';
import { DEFAULT_AVATAR_ID } from './avatars';
import { useAuth } from '../auth/AuthContext';
import { ensureNotificationPermission } from '../notifications/permissions';
import { ApiError } from '../api/client';

const NOTIFY_KEYS = new Set(['notifyNearby', 'notifyInvites', 'notifyChat']);

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
  loaded: boolean;
  saving: boolean;
  profileError: string | null;
  clearProfileError: () => void;
  setZoneTier: (v: ZoneTier) => void; setAvatarId: (v: string) => void; setDisplayName: (v: string) => void;
  setHandle: (v: string) => void; setUnitSystem: (v: UnitSystem) => void; setNotifyNearby: (v: boolean) => void;
  setNotifyInvites: (v: boolean) => void; setNotifyChat: (v: boolean) => void; setShareLocation: (v: boolean) => void;
  setInstagramUsername: (v: string) => void; setInstagramVisibility: (v: SocialVisibility) => void;
  setTiktokUsername: (v: string) => void; setTiktokVisibility: (v: SocialVisibility) => void; resetAll: () => void;
}
const SettingsContext = React.createContext<SettingsContextValue | null>(null);
function validCached(raw: string | null): Partial<ProfileState> { try { return raw ? JSON.parse(raw) as Partial<ProfileState> : {}; } catch { return {}; } }

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { riderId, client } = useAuth();
  const [state, setState] = React.useState<ProfileState>(DEFAULTS); const [loaded, setLoaded] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [profileError, setProfileError] = React.useState<string | null>(null);
  const saveQueue = React.useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = React.useRef(0);
  const stateRef = React.useRef<ProfileState>(DEFAULTS);
  React.useEffect(() => { stateRef.current = state; }, [state]);
  React.useEffect(() => { const key = cacheKey(riderId); let cancelled = false; setLoaded(false); void AsyncStorage.removeItem(LEGACY_CACHE_KEY); AsyncStorage.getItem(key).then((raw) => { if (!cancelled) { setState({ ...DEFAULTS, ...validCached(raw) }); setLoaded(true); } }).catch(() => setLoaded(true)); client.getProfile(riderId).then((profile) => { if (!cancelled) { const { riderId: _id, updatedAt: _at, ...value } = profile; setState(value); void AsyncStorage.setItem(key, JSON.stringify(value)); setLoaded(true); } }).catch(() => {}); return () => { cancelled = true; }; }, [client, riderId]);
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
    if (value === true && NOTIFY_KEYS.has(key)) void ensureNotificationPermission().catch(() => {});
  }, [client, riderId]);
  const setters = React.useMemo(() => ({
    setZoneTier: (v: ZoneTier) => update('zoneTier', v), setAvatarId: (v: string) => update('avatarId', v),
    setDisplayName: (v: string) => update('displayName', v.trim() || 'Rider'), setHandle: (v: string) => update('handle', v.trim() || '@rider'),
    setUnitSystem: (v: UnitSystem) => update('unitSystem', v), setNotifyNearby: (v: boolean) => update('notifyNearby', v),
    setNotifyInvites: (v: boolean) => update('notifyInvites', v), setNotifyChat: (v: boolean) => update('notifyChat', v),
    setShareLocation: (v: boolean) => update('shareLocation', v), setInstagramUsername: (v: string) => update('instagramUsername', v.replace(/^@/, '').trim()),
    setInstagramVisibility: (v: SocialVisibility) => update('instagramVisibility', v), setTiktokUsername: (v: string) => update('tiktokUsername', v.replace(/^@/, '').trim()),
    setTiktokVisibility: (v: SocialVisibility) => update('tiktokVisibility', v),
  }), [update]);
  const resetAll = React.useCallback(() => { stateRef.current = DEFAULTS; setState(DEFAULTS); void AsyncStorage.removeItem(cacheKey(riderId)); void client.updateProfile(riderId, DEFAULTS).catch(() => setProfileError('Your settings could not be reset on the server.')); }, [client, riderId]);
  const clearProfileError = React.useCallback(() => setProfileError(null), []);
  const value = React.useMemo(() => ({ ...state, ...setters, loaded, saving, profileError, clearProfileError, resetAll }), [state, setters, loaded, saving, profileError, clearProfileError, resetAll]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
export function useSettings(): SettingsContextValue { const value = React.useContext(SettingsContext); if (!value) throw new Error('useSettings() must be called within SettingsProvider'); return value; }
