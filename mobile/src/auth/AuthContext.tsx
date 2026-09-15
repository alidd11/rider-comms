import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../config';
import { ApiError, RiderCommsClient } from '../api/client';
import type { GuestSession } from '../api/client';
import { colors, spacing, type } from '../theme';

const KEY = '@rider-comms/auth-v1';
interface AuthValue { riderId: string; client: RiderCommsClient; deleteAccount: () => Promise<void> }
const AuthContext = React.createContext<AuthValue | null>(null);
function parse(raw: string | null): GuestSession | null { try { const v = JSON.parse(raw ?? '') as GuestSession; return typeof v?.riderId === 'string' && typeof v?.token === 'string' ? v : null; } catch { return null; } }
export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = React.useState<GuestSession | null>(null); const [error, setError] = React.useState<string | null>(null); const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => { let cancelled = false; (async () => {
    setError(null);
    try {
      const cached = parse(await SecureStore.getItemAsync(KEY));
      if (cached) { const c = new RiderCommsClient(API_BASE_URL, fetch, cached.token); try { if ((await c.getMe()).riderId === cached.riderId) { if (!cancelled) setSession(cached); return; } } catch (e) { if (!(e instanceof ApiError) || e.status !== 401) throw e; } }
      const created = await new RiderCommsClient(API_BASE_URL).registerGuest(); await SecureStore.setItemAsync(KEY, JSON.stringify(created)); if (!cancelled) setSession(created);
    } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not create your rider identity.'); }
  })(); return () => { cancelled = true; }; }, [attempt]);
  const value = React.useMemo(() => session ? {
    riderId: session.riderId,
    client: new RiderCommsClient(API_BASE_URL, fetch, session.token),
    deleteAccount: async () => {
      await new RiderCommsClient(API_BASE_URL, fetch, session.token).deleteAccount();
      await SecureStore.deleteItemAsync(KEY);
      setSession(null);
      setAttempt((value) => value + 1);
    },
  } : null, [session]);
  if (error) return <View style={styles.center}><Text style={styles.title}>Couldn’t create your rider ID</Text><Text style={styles.error}>{error}</Text><Pressable style={styles.button} onPress={() => setAttempt((v) => v + 1)}><Text style={styles.buttonText}>Try again</Text></Pressable></View>;
  if (!value) return <View style={styles.center}><ActivityIndicator color={colors.accent}/><Text style={styles.label}>Creating your rider ID…</Text></View>;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthValue { const value = React.useContext(AuthContext); if (!value) throw new Error('useAuth() must be called within AuthProvider'); return value; }
const styles = StyleSheet.create({ center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background, padding: spacing.lg }, label: { ...type.body }, title: { ...type.heading, textAlign: 'center' }, error: { ...type.body, color: colors.danger, textAlign: 'center' }, button: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, buttonText: { ...type.button, color: colors.accentText } });
