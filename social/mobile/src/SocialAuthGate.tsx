import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RiderAccountClient, accountErrorMessage, RESET_SENT_TEXT, SOCIAL_TERMS_URL, SOCIAL_GUIDELINES_URL } from './authClient';
import type { AccountIdentity } from './authClient';
import { accountTokenStorage } from './authStorage';
import { ukPlanningPolicy } from './policy';

type Mode = 'login' | 'signup' | 'recover';
type SocialAccountContextValue = {
  identity: AccountIdentity;
  client: RiderAccountClient;
  logout(): Promise<void>;
  resendVerification(): Promise<void>;
};
const Context = React.createContext<SocialAccountContextValue | null>(null);
export function useSocialAccount(): SocialAccountContextValue {
  const context = React.useContext(Context);
  if (!context) throw new Error('Social account required');
  return context;
}
const accent = '#5CE4C1';
const ink = '#F4F7FB';
const muted = '#91A4B5';
const bg = '#080D13';
const panel = '#121E29';
const border = '#23303C';

function deviceName() {
  return Platform.OS === 'ios' ? 'Rider Social on iPhone'
    : Platform.OS === 'android' ? 'Rider Social on Android' : 'Rider Social on web';
}
function Action({ label, onPress, disabled = false }: {
  label: string; onPress: () => void; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    disabled={disabled} onPress={onPress} style={{
      borderRadius: 14, paddingVertical: 14, backgroundColor: disabled ? '#305248' : accent,
      alignItems: 'center', justifyContent: 'center', minHeight: 49,
    }}>
    <Text style={{ color: '#091814', fontSize: 15, fontWeight: '800' }}>{label}</Text>
  </Pressable>;
}
function Field({ label, value, onChangeText, secureTextEntry = false, keyboardType, autoComplete }: {
  label: string; value: string; onChangeText: (text: string) => void;
  secureTextEntry?: boolean; keyboardType?: 'email-address' | 'default';
  autoComplete?: 'email' | 'username' | 'password' | 'new-password';
}) {
  return <View style={{ gap: 7 }}>
    <Text style={{ color: ink, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
      autoCapitalize="none" autoCorrect={false} autoComplete={autoComplete}
      keyboardType={keyboardType ?? 'default'} secureTextEntry={secureTextEntry}
      placeholder={label} placeholderTextColor="#6A7A89"
      style={{ borderWidth: 1, borderColor: border, backgroundColor: panel,
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: ink,
        minHeight: 48, fontSize: 15 }}/>
  </View>;
}
/** Shared identity, independent device session. No Social password database. */
export function SocialAuthGate({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const client = React.useMemo(() => new RiderAccountClient(accountTokenStorage), []);
  const [identity, setIdentity] = React.useState<AccountIdentity | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>('login');
  const [username, setUsername] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [termsChecked, setTermsChecked] = React.useState(false);
  const [ageChecked, setAgeChecked] = React.useState(false);
  const [ageAcknowledged, setAgeAcknowledged] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let alive = true;
    client.setSessionExpiredHandler(() => {
      if (alive) {
        setIdentity(null);
        setAgeAcknowledged(false);
        setAgeChecked(false);
      }
    });
    void client.restore().then(result => {
      if (!alive) return;
      setIdentity(result);
      if (result && Platform.OS === 'web') {
        try {
          setAgeAcknowledged(window.sessionStorage.getItem('rider_social_age_ack_v1') === result.riderId);
        } catch { /* Protected browser mode requires re-acknowledgement. */ }
      }
    }).catch(() => { if (alive) setError('Could not verify your session. Check your connection and retry.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; client.setSessionExpiredHandler(null); };
  }, [client]);

  const signOut = async () => {
    setError('');
    try { await client.logout(); }
    catch { /* Local credentials are already cleared, even after network failure. */ }
    if (Platform.OS === 'web') {
      try { window.sessionStorage.removeItem('rider_social_age_ack_v1'); } catch { /* no storage */ }
    }
    setIdentity(null);
    setAgeAcknowledged(false);
    setAgeChecked(false);
    setPassword('');
    setNotice('');
  };
  const submit = async () => {
    if (busy) return;
    setError(''); setNotice('');
    if (!username.trim() && mode !== 'recover') { setError('Enter your Rider Comms username.'); return; }
    if (mode === 'signup' && !termsChecked) {
      setError('Please accept the Terms and Community Guidelines.'); return;
    }
    setBusy(true);
    try {
      if (mode === 'recover') {
        await client.requestPasswordReset(email);
        setNotice(RESET_SENT_TEXT);
      } else {
        const account = mode === 'signup'
          ? await client.signup(username, email, password, deviceName(), termsChecked)
          : await client.login(username, password, deviceName());
        setIdentity(account);
        setAgeAcknowledged(false);
        setAgeChecked(false);
        setPassword('');
      }
    } catch (cause) { setError(accountErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const acknowledgeAge = () => {
    if (!ageChecked || !identity) return;
    setAgeAcknowledged(true);
    if (Platform.OS === 'web') {
      try { window.sessionStorage.setItem('rider_social_age_ack_v1', identity.riderId); }
      catch { /* Session-only acknowledgment; no age or DOB is persisted. */ }
    }
  };
  const acceptTerms = async () => {
    if (!identity || !termsChecked || busy) return;
    setBusy(true); setError('');
    try { setIdentity(await client.acceptTerms(identity.termsVersion)); setTermsChecked(false); }
    catch (cause) { setError(accountErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  const retry = () => {
    setLoading(true); setError('');
    void client.restore().then(result => setIdentity(result))
      .catch(() => setError('Could not verify your session. Check your connection and retry.'))
      .finally(() => setLoading(false));
  };
  const resendVerification = () => client.resendVerification();
  if (loading) return <View testID="account-loading" style={{
    flex: 1, backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
  }}><ActivityIndicator color={accent} size="large"/></View>;

  if (identity && identity.termsAccepted && ageAcknowledged) {
    return <Context.Provider value={{ identity, client, logout: signOut, resendVerification }}>
      {children}
    </Context.Provider>;
  }

  const isTermsReview = Boolean(identity && !identity.termsAccepted);
  const isAgeReview = Boolean(identity && identity.termsAccepted && !ageAcknowledged);
  return <KeyboardAvoidingView testID="social-account-gate" style={{ flex: 1, backgroundColor: bg }}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center',
        paddingHorizontal: 23, paddingTop: Math.max(28, insets.top), paddingBottom: Math.max(20, insets.bottom) }}
      showsVerticalScrollIndicator={false}>
      <View style={{ width: '100%', maxWidth: 430, alignSelf: 'center', gap: 20 }}>
        <View style={{ gap: 5, paddingBottom: 5 }}>
          <Text style={{ fontSize: 26, color: ink, fontWeight: '900' }}>Social<Text style={{ color: accent }}>.</Text></Text>
          <Text style={{ fontSize: 15, color: muted, lineHeight: 23 }}>
            {isTermsReview ? 'Review the Rider Comms Terms'
              : isAgeReview ? 'One more thing'
                : mode === 'signup' ? 'Use one account across both apps.'
                : mode === 'recover' ? 'Reset your Rider Comms password'
                : 'Sign in with Rider Comms.'}
          </Text>
        </View>
        {error ? <View accessibilityRole="alert" style={{ backgroundColor: '#302022', padding: 12, borderRadius: 11 }}>
          <Text style={{ color: '#FFC3C3', lineHeight: 19 }}>{error}</Text>
          {mode === 'login' && error.includes('verify your session') ? <Pressable accessibilityRole="button"
            accessibilityLabel="Retry session check" onPress={retry}>
            <Text style={{ color: ink, paddingTop: 7 }}>Retry</Text>
          </Pressable> : null}
        </View> : null}
        {notice ? <Text accessibilityRole="alert" style={{ color: accent, lineHeight: 20 }}>{notice}</Text> : null}

        {isTermsReview ? <>
          <Text style={{ color: ink, lineHeight: 23 }}>
            Your Rider Comms account needs to accept the current Terms before you use Social.
          </Text>
          <Pressable accessibilityRole="link" accessibilityLabel="Read Rider Comms Terms"
            onPress={() => void Linking.openURL(SOCIAL_TERMS_URL)}>
            <Text style={{ color: accent, fontWeight: '700' }}>Read the Rider Comms Terms</Text>
          </Pressable>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: termsChecked }}
            accessibilityLabel="I agree to the current Terms"
            onPress={() => setTermsChecked(current => !current)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={termsChecked ? 'checkbox' : 'square-outline'} size={24} color={accent}/>
            <Text style={{ color: ink, flex: 1 }}>I agree to the current Terms</Text>
          </Pressable>
          <Action label="Continue" disabled={!termsChecked || busy} onPress={() => void acceptTerms()}/>
          <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={() => void signOut()}>
            <Text style={{ color: muted, textAlign: 'center' }}>Sign out</Text>
          </Pressable>
        </> : isAgeReview ? <>
          <Text style={{ color: ink, lineHeight: 23 }}>
            Social is for people aged {ukPlanningPolicy.minimumSocialAge} and over.
          </Text>
          <Text style={{ color: muted, lineHeight: 21, fontSize: 13 }}>
            Rider Comms does not currently verify age. This is a self-declaration for the development preview, not verified age assurance. Public posting and other restricted features remain unavailable.
          </Text>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: ageChecked }}
            accessibilityLabel="I confirm I am at least 16"
            onPress={() => setAgeChecked(v => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={ageChecked ? 'checkbox' : 'square-outline'} size={24} color={accent}/>
            <Text style={{ color: ink, flex: 1 }}>I am at least 16 years old</Text>
          </Pressable>
          <Action label="Enter Social preview" disabled={!ageChecked} onPress={acknowledgeAge}/>
          <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={() => void signOut()}>
            <Text style={{ color: muted, textAlign: 'center' }}>Sign out</Text>
          </Pressable>
        </> : <>
          {mode !== 'recover' ? <Field label="Username" value={username} onChangeText={setUsername}
            autoComplete="username"/> : null}
          {mode === 'signup' || mode === 'recover' ? <Field label="Email" value={email} onChangeText={setEmail}
            keyboardType="email-address" autoComplete="email"/> : null}
          {mode !== 'recover' ? <Field label="Password" value={password} onChangeText={setPassword}
            autoComplete={mode === 'signup' ? 'new-password' : 'password'} secureTextEntry/> : null}
          {mode === 'signup' ? <>
            <Pressable accessibilityRole="link" accessibilityLabel="Read Rider Comms Terms"
              onPress={() => void Linking.openURL(SOCIAL_TERMS_URL)}>
              <Text style={{ color: accent }}>Rider Comms Terms of Service</Text>
            </Pressable>
            <Pressable accessibilityRole="link" accessibilityLabel="Read Community Guidelines"
              onPress={() => void Linking.openURL(SOCIAL_GUIDELINES_URL)}>
              <Text style={{ color: accent }}>Community Guidelines</Text>
            </Pressable>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: termsChecked }}
              accessibilityLabel="Accept Terms and Guidelines"
              onPress={() => setTermsChecked(v => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name={termsChecked ? 'checkbox' : 'square-outline'} size={24} color={accent}/>
              <Text style={{ color: ink, flex: 1 }}>I agree to the Rider Comms Terms and Community Guidelines</Text>
            </Pressable>
          </> : null}
          <Action label={mode === 'signup' ? 'Create Rider Comms account'
            : mode === 'recover' ? 'Send reset link' : 'Sign in'}
            disabled={busy} onPress={() => void submit()}/>
          {mode === 'login' ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Create account"
              onPress={() => { setMode('signup'); setError(''); setNotice(''); setTermsChecked(false); }}>
              <Text style={{ textAlign: 'center', color: ink }}>New here? <Text style={{ color: accent, fontWeight: '800' }}>Create account</Text></Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Forgot password"
              onPress={() => { setMode('recover'); setError(''); setNotice(''); }}>
              <Text style={{ textAlign: 'center', color: muted }}>Forgot password?</Text>
            </Pressable>
          </> : <Pressable accessibilityRole="button" accessibilityLabel="Back to sign in"
            onPress={() => { setMode('login'); setError(''); setNotice(''); }}>
            <Text style={{ textAlign: 'center', color: accent }}>Back to sign in</Text>
          </Pressable>}
          <Text style={{ textAlign: 'center', color: muted, fontSize: 11, lineHeight: 17 }}>
            One Rider Comms account. Your Social profile, posts and garage remain separate.
          </Text>
        </>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
