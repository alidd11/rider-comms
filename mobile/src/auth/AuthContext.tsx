import * as React from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
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
import { LEGAL_LINKS } from '../legalLinks';
import { AUTH_HERO_IMAGE, AUTH_MUTED, AUTH_TEXT, styles } from './AuthContext.styles';
import { ApiError, RiderCommsClient } from '../api/client';
import type { LoginSession } from '../api/client';


const KEY = '@rider-comms/auth-v2';
const LEGACY_GUEST_KEY = '@rider-comms/auth-v1';
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AUTH_COPY = {
  login: {
    eyebrow: '',
    title: 'Welcome back',
    description: 'Good to see you again.',
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
    account_suspended: 'This account has been suspended for breaking the community rules. Contact support if you think this is a mistake.',
    invalid_token: 'That reset code is invalid or has already been used.',
    expired_token: 'That reset code has expired. Request a new one.',
    rate_limited: 'Too many attempts. Wait a moment and try again.',
    terms_not_accepted: 'Agree to the Terms of Service and Community Guidelines to create an account.',
    objectionable_username: 'That username isn’t allowed. Choose another.',
  };
  return code ? messages[code] ?? 'The account request could not be completed.' : 'The account request could not be completed.';
}

function AuthScreen({ onAuthenticated, restoreError, onRetryRestore }: {
  onAuthenticated: (session: StoredSession, remember?: boolean) => Promise<void>;
  restoreError: string | null;
  onRetryRestore: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = React.useState<'login' | 'signup' | 'recover' | 'reset'>('login');
  const [username, setUsername] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [resetToken, setResetToken] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(true);
  const [agreedToTerms, setAgreedToTerms] = React.useState(false);

  React.useEffect(() => {
    Keyboard.dismiss();
  }, []);
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
    if (isSignup && !agreedToTerms) {
      setError('Agree to the Terms of Service and Community Guidelines to create an account.');
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
        await onAuthenticated(result, true);
        Alert.alert(
          'Account created',
          result.emailVerificationSent
            ? 'Open the verification link we sent to your email to confirm your address.'
            : 'Your account was created, but the verification email could not be sent. Features that require a verified email, including Nearby Voice, will stay unavailable until verification delivery is restored.'
        );
      } else {
        await onAuthenticated(await publicClient.logIn(normalizedUsername, password), rememberMe);
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
    <ImageBackground
      source={{ uri: AUTH_HERO_IMAGE }}
      style={styles.screen}
      imageStyle={styles.backgroundImage}
      accessibilityLabel="Motorcyclist riding through mountains at dusk"
    >
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <View style={styles.backgroundShade} />
      <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[styles.authScroll, { paddingTop: insets.top + 170, paddingBottom: insets.bottom + 20 }]}
        >
          <View style={styles.intro}>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.subtitle}>{copy.description}</Text>
          </View>

          {restoreError ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{restoreError}</Text>
              <Pressable accessibilityRole="button" onPress={onRetryRestore}><Text style={styles.noticeAction}>Retry</Text></Pressable>
            </View>
          ) : null}

          {notice ? <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View> : null}

          {!isRecovery ? (
            <View style={styles.form}>
              <View style={styles.fieldWrap}>
                <MaterialCommunityIcons name="account-outline" size={18} color={AUTH_MUTED} style={styles.fieldIcon} />
                <TextInput
                  accessibilityLabel="Username"
                  autoFocus={false}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  maxLength={20}
                  returnKeyType="next"
                  value={username}
                  onChangeText={setUsername}
                  placeholder="Username"
                  placeholderTextColor={AUTH_MUTED}
                  style={styles.input}
                />
              </View>

              {isSignup ? (
                <View style={styles.fieldWrap}>
                  <MaterialCommunityIcons name="email-outline" size={18} color={AUTH_MUTED} style={styles.fieldIcon} />
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
                    placeholder="Email address"
                    placeholderTextColor={AUTH_MUTED}
                    style={styles.input}
                  />
                </View>
              ) : null}

              <View style={styles.fieldWrap}>
                <MaterialCommunityIcons name="lock-outline" size={18} color={AUTH_MUTED} style={styles.fieldIcon} />
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  textContentType={isSignup ? 'newPassword' : 'password'}
                  secureTextEntry={!passwordVisible}
                  maxLength={128}
                  returnKeyType="go"
                  onSubmitEditing={() => { if (!busy) void submit(); }}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor={AUTH_MUTED}
                  style={styles.passwordInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                  accessibilityState={{ selected: passwordVisible }}
                  onPress={() => setPasswordVisible((visible) => !visible)}
                  style={styles.passwordToggle}
                >
                  <MaterialCommunityIcons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={18} color={AUTH_MUTED} />
                </Pressable>
              </View>

              {!isSignup ? (
                <View style={styles.loginMeta}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: rememberMe }}
                    onPress={() => setRememberMe((value) => !value)}
                    style={styles.rememberRow}
                  >
                    <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                      {rememberMe ? <View style={styles.checkboxInner} /> : null}
                    </View>
                    <Text style={styles.rememberText}>Remember me</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => switchMode('recover')} style={styles.forgotButton}>
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <Text style={styles.requirements}>Username: 3–20 letters, numbers or underscores. Password: at least 8 characters.</Text>
                  <View style={styles.termsRow}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: agreedToTerms }}
                      accessibilityLabel="I agree to the Terms of Service and Community Guidelines"
                      onPress={() => setAgreedToTerms((value) => !value)}
                      style={styles.termsCheckbox}
                    >
                      <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                        {agreedToTerms ? <View style={styles.checkboxInner} /> : null}
                      </View>
                    </Pressable>
                    <Text style={styles.termsText}>
                      I agree to the{' '}
                      <Text accessibilityRole="link" style={styles.termsLink} onPress={() => void Linking.openURL(LEGAL_LINKS.terms)}>Terms of Service</Text>
                      {' '}and{' '}
                      <Text accessibilityRole="link" style={styles.termsLink} onPress={() => void Linking.openURL(LEGAL_LINKS.guidelines)}>Community Guidelines</Text>
                      . Abusive or objectionable content and behaviour aren’t tolerated. See how we use your data in the{' '}
                      <Text accessibilityRole="link" style={styles.termsLink} onPress={() => void Linking.openURL(LEGAL_LINKS.privacy)}>Privacy Policy</Text>.
                    </Text>
                  </View>
                </>
              )}

              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void submit()}
                style={({ pressed }) => [styles.primaryButton, pressed && !busy && styles.primaryButtonPressed, busy && styles.buttonDisabled]}
              >
                {busy ? <ActivityIndicator color={AUTH_TEXT} /> : <Text style={styles.primaryButtonText}>{isSignup ? 'Create account' : 'Log in'}</Text>}
              </Pressable>

              {isSignup ? (
                <Pressable accessibilityRole="button" onPress={() => switchMode('login')} style={styles.createAccountButton}>
                  <Text style={styles.createAccountText}>Back to log in</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable accessibilityRole="button" onPress={() => switchMode('signup')} style={styles.createAccountButton}>
                    <Text style={styles.createAccountText}>Create account</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : mode === 'recover' ? (
            <View style={styles.form}>
              <View style={styles.fieldWrap}>
                <MaterialCommunityIcons name="email-outline" size={18} color={AUTH_MUTED} style={styles.fieldIcon} />
                <TextInput
                  accessibilityLabel="Email address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  keyboardType="email-address"
                  maxLength={254}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Account email"
                  placeholderTextColor={AUTH_MUTED}
                  style={styles.input}
                />
              </View>
              <Text style={styles.requirements}>For privacy, the response is the same whether or not an account exists.</Text>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={styles.primaryButton}>
                {busy ? <ActivityIndicator color={AUTH_TEXT} /> : <Text style={styles.primaryButtonText}>Send reset link</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => switchMode('login')} style={styles.createAccountButton}><Text style={styles.createAccountText}>Back to log in</Text></Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              <View style={styles.fieldWrap}>
                <MaterialCommunityIcons name="lock-outline" size={18} color={AUTH_MUTED} style={styles.fieldIcon} />
                <TextInput
                  accessibilityLabel="Password reset code"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={resetToken}
                  onChangeText={setResetToken}
                  placeholder="Reset code"
                  placeholderTextColor={AUTH_MUTED}
                  style={styles.input}
                />
              </View>
              <View style={styles.fieldWrap}>
                <MaterialCommunityIcons name="lock-outline" size={18} color={AUTH_MUTED} style={styles.fieldIcon} />
                <TextInput
                  accessibilityLabel="New password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!passwordVisible}
                  maxLength={128}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="New password"
                  placeholderTextColor={AUTH_MUTED}
                  style={styles.passwordInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                  onPress={() => setPasswordVisible((visible) => !visible)}
                  style={styles.passwordToggle}
                >
                  <MaterialCommunityIcons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={18} color={AUTH_MUTED} />
                </Pressable>
              </View>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={styles.primaryButton}>
                {busy ? <ActivityIndicator color={AUTH_TEXT} /> : <Text style={styles.primaryButtonText}>Reset password</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => switchMode('login')} style={styles.createAccountButton}><Text style={styles.createAccountText}>Back to log in</Text></Pressable>
            </View>
          )}

          <Text style={styles.footerTagline}>RIDE TOGETHER. STAY CONNECTED.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

function AuthSplash(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <ImageBackground source={{ uri: AUTH_HERO_IMAGE }} style={styles.splash} imageStyle={styles.backgroundImage}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <View style={styles.splashShade} />
      <View style={[styles.splashCenter, { paddingTop: insets.top + 70 }]}>
        <Text style={styles.splashMark}>R</Text>
        <Text style={styles.splashName}>RIDER COMMS</Text>
        <Text style={styles.splashMotto}>{'RIDE TOGETHER\nSTAY CONNECTED'}</Text>
      </View>
      <Text style={[styles.splashFooter, { bottom: insets.bottom + 58 }]}>{'A SAFER, STRONGER\nRIDING COMMUNITY'}</Text>
      <View style={[styles.splashProgress, { bottom: insets.bottom + 20 }]}><View style={styles.splashProgressFill} /></View>
    </ImageBackground>
  );
}

/** Shown once to accounts created before the current Terms, or after they
 * change: posting, chat and voice stay locked until the rider agrees. */
function TermsAgreementScreen({ client, knownVersion, onAccepted, onLogOut }: {
  client: RiderCommsClient;
  knownVersion: string | null;
  onAccepted: () => void;
  onLogOut: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const agree = async () => {
    setBusy(true);
    setError(null);
    try {
      const version = knownVersion ?? (await client.getMe()).termsVersion;
      if (!version) throw new Error('missing terms version');
      await client.acceptTerms(version);
      onAccepted();
    } catch {
      setError('Couldn’t save your agreement. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.termsGate, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.title}>Updated terms</Text>
      <Text style={styles.subtitle}>
        To keep riding with others on Rider Comms, please read and agree to our Terms of Service and Community Guidelines.
        Abusive or objectionable content and behaviour aren’t tolerated, and anyone can report or block another rider.
      </Text>
      <View style={styles.termsGateLinks}>
        <Text accessibilityRole="link" style={styles.termsLink} onPress={() => void Linking.openURL(LEGAL_LINKS.terms)}>Terms of Service</Text>
        <Text accessibilityRole="link" style={styles.termsLink} onPress={() => void Linking.openURL(LEGAL_LINKS.guidelines)}>Community Guidelines</Text>
        <Text accessibilityRole="link" style={styles.termsLink} onPress={() => void Linking.openURL(LEGAL_LINKS.privacy)}>Privacy Policy</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void agree()} style={[styles.primaryButton, busy && styles.buttonDisabled]}>
        {busy ? <ActivityIndicator color={AUTH_TEXT} /> : <Text style={styles.primaryButtonText}>I agree</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onLogOut} style={styles.createAccountButton}>
        <Text style={styles.createAccountText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = React.useState<StoredSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = React.useState(0);
  const [termsVersion, setTermsVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const splashStartedAt = Date.now();
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
        const refreshed = { ...cached, emailVerified: me.emailVerified, termsAccepted: me.termsAccepted ?? true };
        if (me.termsVersion) setTermsVersion(me.termsVersion);
        await SecureStore.setItemAsync(KEY, JSON.stringify(refreshed));
        if (!cancelled) setSession(refreshed);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await SecureStore.deleteItemAsync(KEY);
        } else if (!cancelled) {
          setRestoreError('We could not restore your saved session. You can retry or sign in again.');
        }
      } finally {
        const remainingSplashMs = Math.max(0, 900 - (Date.now() - splashStartedAt));
        if (remainingSplashMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingSplashMs));
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [restoreAttempt]);

  const onAuthenticated = React.useCallback(async (nextSession: StoredSession, remember = true) => {
    if (remember) await SecureStore.setItemAsync(KEY, JSON.stringify(nextSession));
    else await SecureStore.deleteItemAsync(KEY);
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

  if (loading) return <AuthSplash />;
  if (value && session?.termsAccepted === false) {
    return (
      <TermsAgreementScreen
        client={value.client}
        knownVersion={termsVersion}
        onAccepted={() => void onAuthenticated({ ...session, termsAccepted: true })}
        onLogOut={() => void value.logOut()}
      />
    );
  }
  if (!value) return <AuthScreen onAuthenticated={onAuthenticated} restoreError={restoreError} onRetryRestore={() => setRestoreAttempt((attempt) => attempt + 1)} />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error('useAuth() must be called within AuthProvider');
  return value;
}

