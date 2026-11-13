import React, { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import { SOCIAL_TERMS_URL, SOCIAL_GUIDELINES_URL } from './authClient';

const PRIVACY_URL = 'https://alidd11.github.io/rider-comms/privacy.html';

function PolicyLink({ label, url }: { label: string; url: string }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={label}
    onPress={() => void Linking.openURL(url)}
    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      minHeight: 50, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border }}>
    <Text style={{ color: C.ink, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    <Ionicons name="open-outline" color={C.muted} size={18}/>
  </Pressable>;
}

export function SocialSettings({ username, emailVerified, onClose, onClearDrafts, onSignOut }: {
  username: string;
  emailVerified: boolean;
  onClose: () => void;
  onClearDrafts: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState('');
  async function clear() {
    if (clearing) return;
    setClearing(true);
    setNotice('');
    try {
      await onClearDrafts();
      setConfirmClear(false);
      setNotice('Device-only drafts cleared.');
    } catch {
      setNotice('Drafts weren’t cleared. Try again.');
    } finally {
      setClearing(false);
    }
  }

  return <View testID="social-settings" style={{ gap: 22, paddingBottom: 30 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to profile"
        onPress={onClose} style={{ width: 43, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="chevron-back" size={25} color={C.ink}/>
      </Pressable>
      <Text style={s.title}>Settings & privacy</Text>
    </View>

    <View style={{ gap: 8 }}>
      <Text style={s.cardHeading}>Rider Comms account</Text>
      <Text style={s.body}>@{username.replace(/^@/, '')}</Text>
      <Text style={s.small}>
        {emailVerified ? 'Email verified' : 'Email verification needed for messaging'}
      </Text>
      <Text style={s.small}>One account for Rider Comms and Social. Signing out here ends this device’s Social session.</Text>
    </View>

    <View style={{ gap: 7 }}>
      <Text style={s.cardHeading}>Privacy on this device</Text>
      <Text style={[s.small, { lineHeight: 19 }]}>
        Your Social profile edits, garage notes and unpublished text drafts stay on this device.
        They aren’t public posts or synced to Rider Comms.
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Clear local Social drafts"
        onPress={() => { setConfirmClear(true); setNotice(''); }} style={{
          minHeight: 48, flexDirection: 'row', alignItems: 'center',
          justifyContent: 'space-between', borderBottomWidth: 1, borderColor: C.border,
        }}>
        <Text style={{ color: C.ink, fontSize: 14 }}>Clear local drafts</Text>
        <Ionicons name="trash-outline" color={C.muted} size={19}/>
      </Pressable>
      {confirmClear ? <View testID="confirm-clear-social-drafts" style={{
        borderLeftWidth: 2, borderLeftColor: '#D5A0A7', paddingLeft: 12, gap: 12 }}>
        <Text style={[s.body, { lineHeight: 21 }]}>
          Delete your local Social profile edits, garage notes and text drafts from this device?
          Your Rider Comms account, friends and messages won’t be changed.
        </Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Keep local drafts"
            onPress={() => setConfirmClear(false)} style={[s.ghost, { flex: 1, minHeight: 44 }]}>
            <Text style={s.ghostText}>Keep drafts</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Confirm clear local drafts"
            disabled={clearing} onPress={() => void clear()}
            style={[s.ghost, { flex: 1, minHeight: 44, opacity: clearing ? 0.6 : 1 }]}>
            <Text style={[s.ghostText, { color: '#F1B7BE' }]}>
              {clearing ? 'Clearing…' : 'Delete drafts'}
            </Text>
          </Pressable>
        </View>
      </View> : null}
      {notice ? <Text accessibilityRole="alert" style={[s.small,
        { color: notice.includes('cleared') ? C.accent : '#F1B7BE' }]}>{notice}</Text> : null}
    </View>

    <View style={{ gap: 4 }}>
      <Text style={s.cardHeading}>Legal & policies</Text>
      <PolicyLink label="Privacy policy" url={PRIVACY_URL}/>
      <PolicyLink label="Terms of service" url={SOCIAL_TERMS_URL}/>
      <PolicyLink label="Community guidelines" url={SOCIAL_GUIDELINES_URL}/>
      <Text style={[s.small, { paddingTop: 6, lineHeight: 18 }]}>
        These are the current Rider Comms documents. Social-specific publishing and commercial terms
        must be approved before those features launch.
      </Text>
    </View>

    <Pressable accessibilityRole="button" accessibilityLabel="Sign out of Social"
      style={{ borderTopWidth: 1, borderColor: C.border, paddingVertical: 14, minHeight: 48 }}
      onPress={() => void onSignOut()}>
      <Text style={{ color: '#F2B5BE', fontWeight: '800', fontSize: 14 }}>Sign out</Text>
    </Pressable>
  </View>;
}
