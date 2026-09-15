import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProfileUpdate, RiderProfile, SocialVisibility, ZoneTier } from '@rider-comms/shared';
import { DEFAULT_AVATAR_ID } from './avatars';
import { useAuth } from '../auth/AuthContext';

const CACHE_KEY = '@rider-comms/settings/cachedProfile';
export type UnitSystem = 'mi' | 'km';
const DEFAULTS: Omit<RiderProfile, 'riderId' | 'updatedAt'> = {
  zoneTier: 'free', avatarId: DEFAULT_AVATAR_ID, displayName: 'Rider', handle: '@rider', unitSystem: 'mi',
  notifyNearby: true, notifyInvites: true, notifyChat: true, shareLocation: false,
  instagramUsername: '', instagramVisibility: 'friends', tiktokUsername: '', tiktokVisibility: 'friends',
};
type ProfileState = typeof DEFAULTS;
interface SettingsContextValue extends ProfileState {
  loaded: boolean;
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
  React.useEffect(() => { let cancelled = false; AsyncStorage.getItem(CACHE_KEY).then((raw) => { if (!cancelled) { setState({ ...DEFAULTS, ...validCached(raw) }); setLoaded(true); } }).catch(() => setLoaded(true)); client.getProfile(riderId).then((profile) => { if (!cancelled) { const { riderId: _id, updatedAt: _at, ...value } = profile; setState(value); void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(value)); } }).catch(() => {}); return () => { cancelled = true; }; }, [client, riderId]);
  const update = React.useCallback(<K extends keyof ProfileState>(key: K, value: ProfileState[K]) => {
    setState((current) => { const next = { ...current, [key]: value }; void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)); return next; });
    void client.updateProfile(riderId, { [key]: value } as ProfileUpdate).catch(() => {});
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
  const resetAll = React.useCallback(() => { setState(DEFAULTS); void AsyncStorage.removeItem(CACHE_KEY); void client.updateProfile(riderId, DEFAULTS).catch(() => {}); }, [client, riderId]);
  const value = React.useMemo(() => ({ ...state, ...setters, loaded, resetAll }), [state, setters, loaded, resetAll]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
export function useSettings(): SettingsContextValue { const value = React.useContext(SettingsContext); if (!value) throw new Error('useSettings() must be called within SettingsProvider'); return value; }
