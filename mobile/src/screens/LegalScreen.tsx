import * as React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { colors, MIN_TOUCH_TARGET, spacing, type } from '../theme';
import { useMovementSafety } from '../safety/MovementSafetyContext';
import { RideSafeSurface } from '../safety/RideSafeSurface';
import { LEGAL_LINKS } from '../legalLinks';

type Props = NativeStackScreenProps<RootStackParamList, 'Legal'>;

const sections = [
  { title: 'Your privacy', text: 'Your sign-in is kept in your device’s secure storage. Location is shared only when you choose: going live on Nearby, or switching it on for a group ride. Voice is carried live and never recorded. You can delete your account and its data at any time in Settings.' },
  { title: 'Your choices', text: 'Location sharing starts off. Instagram and TikTok usernames each have Public, Friends only or Private visibility. You can review and undo blocks in Settings → Communication → Blocked riders.' },
  { title: 'Rider safety and conduct', text: 'Harassment, hate, sexual content, threats, stalking, spam and impersonation aren’t allowed. Report or block a rider from their profile, a chat, the ride roster, a friend request or the Nearby Voice rider list. Reports are reviewed within 24 hours.' },
  { title: 'Riding safety', text: 'Don’t look at or touch your phone while moving. Rider Comms locks distracting controls when it detects you’re riding. Stop somewhere safe first.' },
];

const links: Array<{ label: string; url: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { label: 'Privacy Policy', url: LEGAL_LINKS.privacy, icon: 'lock-closed-outline' },
  { label: 'Terms of Service', url: LEGAL_LINKS.terms, icon: 'document-text-outline' },
  { label: 'Community Guidelines', url: LEGAL_LINKS.guidelines, icon: 'people-outline' },
  { label: 'Contact support', url: LEGAL_LINKS.support, icon: 'help-buoy-outline' },
];

export function LegalScreen(props: Props): React.JSX.Element {
  const { lockedForSafety } = useMovementSafety();
  return lockedForSafety ? <RideSafeSurface /> : <LegalScreenContent {...props} />;
}

function LegalScreenContent({ navigation }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return <View style={styles.container}>
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={styles.back}><Ionicons name="chevron-back" size={24} color={colors.textPrimary}/></Pressable>
      <Text style={styles.title}>Privacy, safety & terms</Text><View style={styles.spacer}/>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {sections.map((section) => <View key={section.title} style={styles.section}><Text style={styles.heading}>{section.title}</Text><Text style={styles.body}>{section.text}</Text></View>)}
      <View style={styles.linkGroup}>
        {links.map((link) => (
          <Pressable
            key={link.label}
            accessibilityRole="link"
            onPress={() => { void Linking.openURL(link.url).catch(() => undefined); }}
            style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
          >
            <Ionicons name={link.icon} size={20} color={colors.textSecondary} />
            <Text style={styles.linkLabel}>{link.label}</Text>
            <Ionicons name="open-outline" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  spacer: { width: MIN_TOUCH_TARGET },
  title: { ...type.heading, flex: 1, textAlign: 'center', fontSize: 19 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  section: { gap: spacing.sm },
  heading: { ...type.subheading, color: colors.textPrimary },
  body: { ...type.body, color: colors.textSecondary, lineHeight: 22 },
  linkGroup: { borderTopWidth: 1, borderTopColor: colors.border },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: MIN_TOUCH_TARGET + 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  linkRowPressed: { opacity: 0.7 },
  linkLabel: { ...type.body, color: colors.textPrimary, flex: 1 },
});
