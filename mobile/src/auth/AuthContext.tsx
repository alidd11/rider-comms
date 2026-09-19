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
  ImageBackground,
  StatusBar,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../config';
import { ApiError, RiderCommsClient } from '../api/client';
import type { LoginSession } from '../api/client';
import { colors, radii, spacing, type, useConcreteThemeColors } from '../theme';

const KEY = '@rider-comms/auth-v2';
const LEGACY_GUEST_KEY = '@rider-comms/auth-v1';
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AUTH_HERO_IMAGE = 'https://images.unsplash.com/photo-1770614956862-a143fb5e4921?auto=format&fit=crop&q=80&w=1200';

const AUTH_COPY = {
  login: {
    eyebrow: 'WELCOME BACK',
    title: 'Ready to ride?',
    description: 'Sign in to reconnect with your rides, friends and rider circle.',
  },
  signup: {
    eyebrow: 'NEW RIDER',
    title: 'Create your account',
    description: 'Set up your Rider Comms identity and keep your rides and rider circle across devices.',
  },
  recover: {
    eyebrow: 'ACCOUNT RECOVERY',
    title: 'Get back in',
    description: 'Request a one-hour reset link without revealing whether an account exists.',
  },
  reset: {
    eyebrow: 'SECURE RESET',
    title: 'Choose a new password',
    description: 'Enter the one-hour code from your email. Every existing session will be signed out.',
  },
} as const;

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
    invalid_token: 'That reset code is invalid or has already been used.',
    expired_token: 'That reset code has expired. Request a new one.',
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
  const palette = useConcreteThemeColors();
  const [mode, setMode] = React.useState<'login' | 'signup' | 'recover' | 'reset'>('login');
  const [username, setUsername] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [resetToken, setResetToken] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = React.useState(false);
  const isSignup = mode === 'signup';
  const isRecovery = mode === 'recover' || mode === 'reset';
  const copy = AUTH_COPY[mode];

  async function submit(): Promise<void> {
    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim();
    setError(null);
    setNotice(null);
    if (!isRecovery && !USERNAME_PATTERN.test(normalizedUsername)) {
      setError('Use 3–20 letters, numbers, or underscores for your username.');
      return;
    }
    if ((isSignup || mode === 'recover') && !EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (mode !== 'recover' && (password.length < 8 || password.length > 128)) {
      setError('Use a password between 8 and 128 characters.');
      return;
    }
    if (mode === 'reset' && !resetToken.trim()) {
      setError('Enter the reset code from your email.');
      return;
    }

    setBusy(true);
    try {
      const publicClient = new RiderCommsClient(API_BASE_URL);
      if (mode === 'recover') {
        await publicClient.requestPasswordReset(normalizedEmail);
        setMode('reset');
        setNotice('If that address belongs to an account, a one-hour reset link and code has been sent.');
      } else if (mode === 'reset') {
        await publicClient.resetPassword(resetToken.trim(), password);
        setMode('login');
        setPassword('');
        setResetToken('');
        setNotice('Password updated. Sign in again on each device.');
      } else if (isSignup) {
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

  function switchMode(nextMode: 'login' | 'signup' | 'recover' | 'reset'): void {
    setMode(nextMode);
    setError(null);
    setNotice(null);
    setPassword('');
    setPasswordVisible(false);
  }

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.authScroll, { paddingTop: 0, paddingBottom: insets.bottom + 20 }]}
      >
        <ImageBackground
          source={{ uri: AUTH_HERO_IMAGE }}
          style={[styles.visual, { height: 244 + insets.top, backgroundColor: palette.surface }]}
          imageStyle={styles.visualImage}
          accessibilityRole="image"
          accessibilityLabel="Motorcyclists riding together on a winding mountain road"
        >
          <View style={styles.visualShade} />
          <View style={styles.visualCopy}>
            <Text style={styles.visualTitle}>{'Ride further.\ntogether.'}</Text>
          </View>
        </ImageBackground>

        <View style={styles.intro}>
          <Text style={[styles.modeEyebrow, { color: palette.accent }]}>{copy.eyebrow}</Text>
          <Text style={[styles.title, { color: palette.textPrimary }]}>{copy.title}</Text>
          <Text style={[styles.subtitle, { color: palette.textSecondary }]}>{copy.description}</Text>
        </View>

        {!isRecovery ? <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: palette.surfaceRaised }]}>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: !isSignup }} onPress={() => switchMode('login')} style={[styles.tab, !isSignup && [styles.tabActive, { backgroundColor: palette.surface, borderBottomColor: palette.accent }]]}>
            <Text style={[styles.tabText, { color: !isSignup ? palette.textPrimary : palette.textMuted }]}>Log in</Text>
          </Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: isSignup }} onPress={() => switchMode('signup')} style={[styles.tab, isSignup && [styles.tabActive, { backgroundColor: palette.surface, borderBottomColor: palette.accent }]]}>
            <Text style={[styles.tabText, { color: isSignup ? palette.textPrimary : palette.textMuted }]}>Create account</Text>
          </Pressable>
        </View> : null}

        {isRecovery ? (
          <Pressable accessibilityRole="button" onPress={() => switchMode('login')} style={styles.backToLogin}>
            <Text style={[styles.backToLoginText, { color: palette.accent }]}>Back to log in</Text>
          </Pressable>
        ) : null}

        {restoreError ? (
          <View style={[styles.notice, { backgroundColor: palette.dangerSurface, borderColor: palette.danger }]}>
            <Text style={[styles.noticeText, { color: palette.textSecondary }]}>{restoreError}</Text>
            <Pressable accessibilityRole="button" onPress={onRetryRestore}><Text style={[styles.noticeAction, { color: palette.accent }]}>Retry</Text></Pressable>
          </View>
        ) : null}

        {notice ? <View style={[styles.notice, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={[styles.noticeText, { color: palette.textSecondary }]}>{notice}</Text></View> : null}

        <View style={styles.form}>
          {!isRecovery ? <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>{isSignup ? 'Choose a username' : 'Username'}</Text>
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
              placeholder={isSignup ? 'e.g. ali_rides' : 'Your username'}
              placeholderTextColor={palette.textMuted}
              style={[styles.input, { backgroundColor: palette.surfaceRaised, borderColor: 'transparent', color: palette.textPrimary }]}
            />
          </View> : null}
          {isSignup || mode === 'recover' ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>{mode === 'recover' ? 'Account email' : 'Email address'}</Text>
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
                placeholderTextColor={palette.textMuted}
                style={[styles.input, { backgroundColor: palette.surfaceRaised, borderColor: 'transparent', color: palette.textPrimary }]}
              />
            </View>
          ) : null}
          {mode === 'reset' ? (
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>Reset code</Text>
              <TextInput
                accessibilityLabel="Password reset code"
                autoCapitalize="none"
                autoCorrect={false}
                value={resetToken}
                onChangeText={setResetToken}
                placeholder="Code from your email"
                placeholderTextColor={palette.textMuted}
                style={[styles.input, { backgroundColor: palette.surfaceRaised, borderColor: 'transparent', color: palette.textPrimary }]}
              />
            </View>
          ) : null}
          {mode !== 'recover' ? <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>Password</Text>
            <View style={[styles.passwordField, { backgroundColor: palette.surfaceRaised, borderColor: 'transparent' }]}>
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={isSignup || mode === 'reset' ? 'new-password' : 'current-password'}
                textContentType={isSignup || mode === 'reset' ? 'newPassword' : 'password'}
                secureTextEntry={!passwordVisible}
                maxLength={128}
                returnKeyType="go"
                onSubmitEditing={() => { if (!busy) void submit(); }}
                value={password}
                onChangeText={setPassword}
                placeholder={isSignup ? '8 characters minimum' : 'Your password'}
                placeholderTextColor={palette.textMuted}
                style={[styles.passwordInput, { color: palette.textPrimary }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                accessibilityState={{ selected: passwordVisible }}
                onPress={() => setPasswordVisible((visible) => !visible)}
                style={styles.passwordToggle}
              >
                <MaterialCommunityIcons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={palette.textMuted} />
              </Pressable>
            </View>
          </View> : null}
          {mode === 'login' ? (
            <Pressable accessibilityRole="button" onPress={() => switchMode('recover')} style={styles.forgotButton}>
              <Text style={[styles.forgotText, { color: palette.accent }]}>Forgot password?</Text>
            </Pressable>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: pressed && !busy ? palette.accentPressed : palette.accent },
              busy && styles.buttonDisabled,
            ]}
          >
            {busy ? <ActivityIndicator color={palette.accentText} /> : <Text style={[styles.primaryButtonText, { color: palette.accentText }]}>{isSignup ? 'Create account' : mode === 'recover' ? 'Send reset link' : mode === 'reset' ? 'Reset password' : 'Log in'}</Text>}
          </Pressable>
        </View>

        <Text style={[styles.securityNote, { color: palette.textMuted }]}>By continuing, you agree to ride responsibly and follow the Rider Comms safety and privacy rules.</Text>
        <View style={styles.featureRow} accessibilityLabel="Nearby riders, Private rides, Hazard alerts">
          <Text style={[styles.featureText, { color: palette.textSecondary }]}>Nearby riders</Text>
          <View style={[styles.featureDot, { backgroundColor: palette.accent }]} />
          <Text style={[styles.featureText, { color: palette.textSecondary }]}>Private rides</Text>
          <View style={[styles.featureDot, { backgroundColor: palette.accent }]} />
          <Text style={[styles.featureText, { color: palette.textSecondary }]}>Hazard alerts</Text>
        </View>
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
        const refreshed = { ...cached, emailVerified: me.emailVerified };
        await SecureStore.setItemAsync(KEY, JSON.stringify(refreshed));
        if (!cancelled) setSession(refreshed);
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
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background, padding: spacing.lg },
  loadingLabel: { ...type.body },
  authScroll: { flexGrow: 1, justifyContent: 'flex-start', paddingHorizontal: 20, width: '100%', maxWidth: 440, alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  brandMark: { position: 'relative', width: 42, height: 42, borderRadius: radii.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  brandStatusDot: { position: 'absolute', right: 5, bottom: 5, width: 8, height: 8, borderRadius: radii.pill, borderWidth: 2 },
  brandCopy: { gap: 3 },
  brandName: { fontSize: 12, lineHeight: 15, fontWeight: '800', letterSpacing: 2.1 },
  brandTagline: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  visual: { height: 244, justifyContent: 'flex-end', overflow: 'hidden', marginHorizontal: -20, marginBottom: 0, borderRadius: 0, borderWidth: 0 },
  visualImage: { borderRadius: 0 },
  visualShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(3,7,9,0.20)' },
  visualCopy: { paddingHorizontal: 22, paddingBottom: 18 },
  visualTitle: { color: '#FFFFFF', fontSize: 30, lineHeight: 28, fontWeight: '800', letterSpacing: -1.2, textShadowColor: 'rgba(0,0,0,0.48)', textShadowRadius: 10 },
  intro: { marginTop: 15, marginBottom: 11, paddingHorizontal: 2 },
  modeEyebrow: { fontSize: 10, lineHeight: 12, fontWeight: '800', letterSpacing: 1.6, marginBottom: 5 },
  title: { fontSize: 30, lineHeight: 31, fontWeight: '800', letterSpacing: -1.05 },
  subtitle: { fontSize: 13, lineHeight: 18, fontWeight: '500', maxWidth: 370, marginTop: 6 },
  tabs: { width: 248, flexDirection: 'row', gap: 2, padding: 2, minHeight: 38, borderRadius: radii.lg, borderWidth: 0, marginBottom: 11 },
  tab: { minHeight: 34, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: {},
  tabText: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  backToLogin: { minHeight: 36, alignSelf: 'flex-start', justifyContent: 'center', marginBottom: spacing.sm },
  backToLoginText: { fontSize: 12, fontWeight: '700' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radii.lg, padding: 10, marginBottom: 10 },
  noticeText: { ...type.caption, flex: 1, fontSize: 11, lineHeight: 15 },
  noticeAction: { ...type.button, fontSize: 12 },
  form: { gap: 9 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  input: { minHeight: 42, borderWidth: 1, borderRadius: radii.lg, fontSize: 14, paddingHorizontal: 13 },
  passwordField: { minHeight: 42, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radii.lg, overflow: 'hidden' },
  passwordInput: { minHeight: 40, flex: 1, fontSize: 14, paddingLeft: 13, paddingRight: 7 },
  passwordToggle: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  error: { ...type.caption, fontSize: 11, lineHeight: 16 },
  forgotButton: { minHeight: 30, alignSelf: 'flex-end', justifyContent: 'center', marginTop: -2 },
  forgotText: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  primaryButton: { minHeight: 44, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  primaryButtonText: { ...type.button, fontSize: 14 },
  buttonDisabled: { opacity: 0.6 },
  featureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 'auto', paddingTop: 18, paddingBottom: 4 },
  featureText: { fontSize: 10, lineHeight: 13, fontWeight: '700', letterSpacing: 0.2 },
  featureDot: { width: 3, height: 3, borderRadius: radii.pill, opacity: 0.72 },
  securityNote: { fontSize: 10, lineHeight: 14, textAlign: 'center', maxWidth: 326, alignSelf: 'center', marginTop: 10 },
});
