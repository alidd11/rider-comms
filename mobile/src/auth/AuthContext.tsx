import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../config';
import { ApiError, RiderCommsClient } from '../api/client';
import type { LoginSession } from '../api/client';
import { colors, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';

const KEY = '@rider-comms/auth-v2';
const LEGACY_GUEST_KEY = '@rider-comms/auth-v1';
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type StoredSession = LoginSession;
interface AuthValue {
  riderId: string;
  emailVerified: boolean;
  client: RiderCommsClient;
  logOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = React.createContext<AuthValue | null>(null);

function parse(raw: string | null): StoredSession | null {
  try {
    const value = JSON.parse(raw ?? '') as Partial<StoredSession>;
    return typeof value.riderId === 'string' && typeof value.token === 'string' && typeof value.emailVerified === 'boolean'
      ? value as StoredSession
      : null;
  } catch {
    return null;
  }
}

function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.name === 'AbortError'
      ? 'The request timed out. Check your connection and try again.'
      : 'Rider Comms could not reach the account service. Check your connection and try again.';
  }
  const code = (error.body as { error?: string } | null)?.error;
  const messages: Record<string, string> = {
    username_taken: 'That username is already taken.',
    email_taken: 'That email is already registered.',
    invalid_username: 'Use 3–20 letters, numbers, or underscores.',
    invalid_email: 'Enter a valid email address.',
    weak_password: 'Use a password between 8 and 128 characters.',
    invalid_credentials: 'The username or password is incorrect.',
    rate_limited: 'Too many attempts. Wait a moment and try again.',
  };
  return code ? messages[code] ?? 'The account request could not be completed.' : 'The account request could not be completed.';
}

function AuthScreen({ onAuthenticated, restoreError, onRetryRestore }: {
  onAuthenticated: (session: StoredSession) => Promise<void>;
  restoreError: string | null;
  onRetryRestore: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = React.useState<'login' | 'signup'>('login');
  const [username, setUsername] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const isSignup = mode === 'signup';

  async function submit(): Promise<void> {
    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim();
    setError(null);
    if (!USERNAME_PATTERN.test(normalizedUsername)) {
      setError('Use 3–20 letters, numbers, or underscores for your username.');
      return;
    }
    if (isSignup && !EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8 || password.length > 128) {
      setError('Use a password between 8 and 128 characters.');
      return;
    }

    setBusy(true);
    try {
      const publicClient = new RiderCommsClient(API_BASE_URL);
      if (isSignup) {
        const result = await publicClient.signUp(normalizedUsername, normalizedEmail, password);
        try {
          await new RiderCommsClient(API_BASE_URL, fetch, result.token).updateProfile(result.riderId, {
            displayName: normalizedUsername,
            handle: `@${normalizedUsername}`,
          });
        } catch {
          // Account creation succeeded; profile editing remains available in
          // Settings if this optional first-write could not be completed.
        }
        await onAuthenticated(result);
        Alert.alert(
          'Account created',
          result.emailVerificationSent
            ? 'Open the verification link we sent to your email to confirm your address.'
            : 'Your account is ready. Email verification is temporarily unavailable, so you can continue testing without it.'
        );
      } else {
        await onAuthenticated(await publicClient.logIn(normalizedUsername, password));
      }
    } catch (submitError) {
      setError(authErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode: 'login' | 'signup'): void {
    setMode(nextMode);
    setError(null);
    setPassword('');
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.authScroll, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
      >
        <View style={styles.brandMark}><Text style={styles.brandLetter}>R</Text></View>
        <Text style={styles.eyebrow}>RIDER COMMS</Text>
        <Text style={styles.title}>{isSignup ? 'Create your rider account' : 'Welcome back'}</Text>
        <Text style={styles.subtitle}>
          {isSignup
            ? 'Keep your rides, friends, and identity available across your devices.'
            : 'Sign in to reconnect with your rides and rider circle.'}
        </Text>

        <View accessibilityRole="tablist" style={styles.tabs}>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: !isSignup }} onPress={() => switchMode('login')} style={[styles.tab, !isSignup && styles.tabActive]}>
            <Text style={[styles.tabText, !isSignup && styles.tabTextActive]}>Log in</Text>
          </Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: isSignup }} onPress={() => switchMode('signup')} style={[styles.tab, isSignup && styles.tabActive]}>
            <Text style={[styles.tabText, isSignup && styles.tabTextActive]}>Create account</Text>
          </Pressable>
        </View>

        {restoreError ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{restoreError}</Text>
            <Pressable accessibilityRole="button" onPress={onRetryRestore}><Text style={styles.noticeAction}>Retry</Text></Pressable>
          </View>
        ) : null}

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Username</Text>
            <TextInput
              accessibilityLabel="Username"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              maxLength={20}
              returnKeyType="next"
              value={username}
              onChangeText={setUsername}
              placeholder="rider_name"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
          </View>
          {isSignup ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                maxLength={254}
                returnKeyType="next"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
            </View>
          ) : null}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              textContentType={isSignup ? 'newPassword' : 'password'}
              secureTextEntry
              maxLength={128}
              returnKeyType="go"
              onSubmitEditing={() => { if (!busy) void submit(); }}
              value={password}
              onChangeText={setPassword}
              placeholder={isSignup ? '8 characters minimum' : 'Your password'}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
          </View>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void submit()}
            style={({ pressed }) => [styles.primaryButton, pressed && !busy && styles.primaryButtonPressed, busy && styles.buttonDisabled]}
          >
            {busy ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.primaryButtonText}>{isSignup ? 'Create account' : 'Log in'}</Text>}
          </Pressable>
        </View>

        <Text style={styles.securityNote}>Credentials are sent only to the Rider Comms API. Your session token is stored in this device’s secure storage.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = React.useState<StoredSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setRestoreError(null);
      try {
        // v1 stored auto-created guest identities. Account auth deliberately
        // does not migrate those disposable sessions into a real account.
        await SecureStore.deleteItemAsync(LEGACY_GUEST_KEY);
        const cached = parse(await SecureStore.getItemAsync(KEY));
        if (!cached) return;
        const client = new RiderCommsClient(API_BASE_URL, fetch, cached.token);
        const me = await client.getMe();
        if (me.riderId !== cached.riderId) throw new Error('Stored account identity did not match the server.');
        if (!cancelled) setSession(cached);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await SecureStore.deleteItemAsync(KEY);
        } else if (!cancelled) {
          setRestoreError('We could not restore your saved session. You can retry or sign in again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [restoreAttempt]);

  const onAuthenticated = React.useCallback(async (nextSession: StoredSession) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    setRestoreError(null);
  }, []);

  const value = React.useMemo<AuthValue | null>(() => {
    if (!session) return null;
    const client = new RiderCommsClient(API_BASE_URL, fetch, session.token);
    const clearLocalSession = async () => {
      await SecureStore.deleteItemAsync(KEY);
      setSession(null);
    };
    return {
      riderId: session.riderId,
      emailVerified: session.emailVerified,
      client,
      logOut: async () => {
        try { await client.logOut(); } finally { await clearLocalSession(); }
      },
      deleteAccount: async () => {
        await client.deleteAccount();
        await clearLocalSession();
      },
    };
  }, [session]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent}/><Text style={styles.loadingLabel}>Restoring your account…</Text></View>;
  if (!value) return <AuthScreen onAuthenticated={onAuthenticated} restoreError={restoreError} onRetryRestore={() => setRestoreAttempt((attempt) => attempt + 1)} />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error('useAuth() must be called within AuthProvider');
  return value;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background, padding: spacing.lg },
  loadingLabel: { ...type.body },
  authScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  brandMark: { width: 58, height: 58, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, marginBottom: spacing.xl },
  brandLetter: { fontSize: 28, fontWeight: '900', color: colors.accentText },
  eyebrow: { ...type.label, color: colors.accent, marginBottom: spacing.sm },
  title: { ...type.display, marginBottom: spacing.sm },
  subtitle: { ...type.body, color: colors.textSecondary, marginBottom: spacing.xl },
  tabs: { flexDirection: 'row', padding: spacing.xs, borderRadius: radii.md, backgroundColor: colors.surface, marginBottom: spacing.lg },
  tab: { minHeight: MIN_TOUCH_TARGET, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm },
  tabActive: { backgroundColor: colors.surfaceRaised },
  tabText: { ...type.button, color: colors.textSecondary },
  tabTextActive: { color: colors.textPrimary },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.dangerSurface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  noticeText: { ...type.caption, color: colors.textSecondary, flex: 1 },
  noticeAction: { ...type.button, color: colors.accent },
  form: { gap: spacing.md },
  field: { gap: spacing.sm },
  fieldLabel: { ...type.caption, color: colors.textSecondary },
  input: { minHeight: MIN_TOUCH_TARGET, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.textPrimary, fontSize: 17, paddingHorizontal: spacing.md },
  error: { ...type.caption, color: colors.danger },
  primaryButton: { minHeight: MIN_TOUCH_TARGET, borderRadius: radii.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  primaryButtonPressed: { backgroundColor: colors.accentPressed },
  primaryButtonText: { ...type.button, color: colors.accentText },
  buttonDisabled: { opacity: 0.6 },
  securityNote: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
});
