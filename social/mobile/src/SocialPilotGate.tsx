import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AccountApiError } from './authClient';
import type { AccountIdentity, RiderAccountClient } from './authClient';
import { clearLocalDemo } from './demoStorage';
import { clearAccountTextDraft } from './textDraftStorage';
import { SocialSettings } from './SocialSettings';

type Phase = 'checking' | 'allowed' | 'denied' | 'unavailable';
const ink = '#F4F7FB', muted = '#91A4B5', accent = '#5CE4C1', bg = '#080D13';

export function SocialPilotGate({ identity, client, onSignOut, onDeleteAccount, children }: {
  identity: AccountIdentity; client: RiderAccountClient;
  onSignOut: () => Promise<void>; onDeleteAccount: () => Promise<void>;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const riderId = identity.riderId;
  const [access, setAccess] = useState<{ riderId: string; phase: Phase } | null>(null);
  const [retry, setRetry] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setAccess({ riderId, phase: 'checking' });
    void client.socialBootstrap().then(() => {
      if (live) setAccess({ riderId, phase: 'allowed' });
    }).catch(error => {
      if (!live) return;
      const denied = error instanceof AccountApiError &&
        error.status === 403 && error.code === 'social_beta_not_enabled';
      setAccess({ riderId, phase: denied ? 'denied' : 'unavailable' });
    });
    return () => { live = false; };
  }, [client, riderId, retry]);
  // An account switch cannot reuse even one frame of the previous rider's access.
  const phase: Phase = access?.riderId === riderId ? access.phase : 'checking';
  if (phase === 'allowed') return <>{children}</>;
  return <View testID="social-pilot-gate" style={{ flex: 1, backgroundColor: bg }}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 23,
        paddingTop: Platform.OS === 'web' ? 30 : Math.max(28, insets.top + 18),
        paddingBottom: Platform.OS === 'web' ? 35 : Math.max(35, insets.bottom + 25) }}>
      <View style={{ width: '100%', maxWidth: 430, alignSelf: 'center', gap: 18 }}>
        {settingsOpen ? <SocialSettings username={identity.username} emailVerified={identity.emailVerified}
          onClose={() => setSettingsOpen(false)}
          onClearDrafts={async () => { await Promise.all([
            clearLocalDemo(riderId), clearAccountTextDraft(riderId),
          ]); }}
          onSignOut={onSignOut} onDeleteAccount={onDeleteAccount}/> : <>
          <Text style={{ color: ink, fontSize: 29, fontWeight: '900' }}>
            Social<Text style={{ color: accent }}>.</Text>
          </Text>
          {phase === 'checking' ? <>
            <ActivityIndicator accessibilityLabel="Checking Social beta access" color={accent}/>
            <Text style={{ color: ink, fontSize: 18, fontWeight: '700' }}>Checking your access…</Text>
          </> : <>
            <Text style={{ color: ink, fontSize: 20, lineHeight: 27, fontWeight: '800' }}>
              {phase === 'denied' ? 'Social is currently invite-only' : 'Social is temporarily unavailable'}
            </Text>
            <Text accessibilityRole="alert" style={{ color: muted, fontSize: 15, lineHeight: 22 }}>
              {phase === 'denied'
                ? 'This account has not been invited to the private Social test. Your Rider Comms account, friends and messages are unchanged.'
                : 'We couldn’t confirm your Social access. Check your connection and try again. Your Rider Comms account is unchanged.'}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry Social access check"
              onPress={() => { setAccess({ riderId, phase: 'checking' }); setRetry(n => n + 1); }}
              style={{ minHeight: 50, backgroundColor: accent, borderRadius: 13,
                alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: bg, fontWeight: '800', fontSize: 15 }}>Try again</Text>
            </Pressable>
          </>}
          <Pressable accessibilityRole="button" accessibilityLabel="Account settings"
            onPress={() => setSettingsOpen(true)}
            style={{ minHeight: 50, borderRadius: 13, borderWidth: 1, borderColor: '#23303C',
              alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: ink, fontSize: 14, fontWeight: '700' }}>Account settings & deletion</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Sign out of Social"
            onPress={() => void onSignOut()} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: muted, textAlign: 'center', fontWeight: '700' }}>Sign out</Text>
          </Pressable>
        </>}
      </View>
    </ScrollView>
  </View>;
}
