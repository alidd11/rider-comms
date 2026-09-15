import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { colors, MIN_TOUCH_TARGET, spacing, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Legal'>;

const sections = [
  { title: 'Privacy', text: 'Rider Comms uses a random Rider ID and stores its private session token in your device secure store. Profile settings, friendships, messages, rides, hideouts and optional social usernames are sent to the prototype API. Foreground location is sent only after you enable location sharing and join the local channel; leaving removes your active presence.' },
  { title: 'Your choices', text: 'Location sharing starts off. Instagram and TikTok usernames each have Public, Friends only or Private visibility. You can delete your account and prototype data from Settings.' },
  { title: 'Community safety', text: 'Harassment, threats, sexual exploitation, dangerous content, spam and impersonation are not allowed. Direct-message screens include Report and Block controls. Blocking removes the friendship and prevents further messages or requests.' },
  { title: 'Riding safety', text: 'Do not operate messaging, profile, billing or future video features while moving. Stop somewhere safe before using visual or touch controls. The planned video feed must lock interaction whenever movement is detected.' },
  { title: 'Test-build notice', text: 'This is a pre-alpha test build. Server data is currently held in memory and can disappear on restart. A published privacy-policy URL, support contact, durable storage and staffed moderation process are required before public store release.' },
];

export function LegalScreen({ navigation }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return <View style={styles.container}>
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={styles.back}><Ionicons name="chevron-back" size={24} color={colors.textPrimary}/></Pressable>
      <Text style={styles.title}>Privacy, safety & terms</Text><View style={styles.spacer}/>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      {sections.map((section) => <View key={section.title} style={styles.section}><Text style={styles.heading}>{section.title}</Text><Text style={styles.body}>{section.text}</Text></View>)}
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
});
