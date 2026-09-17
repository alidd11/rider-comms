import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { colors, MIN_TOUCH_TARGET, spacing, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Legal'>;

const sections = [
  { title: 'Privacy', text: 'Rider Comms stores its private session token in your device secure store. Profile settings, friendships, messages, rides, hideouts and optional social usernames are sent to the test API. Public nearby-rider location starts only after you enable sharing and go live. Private-ride location is a separate, optional choice for each ride and is removed when you switch it off, leave, are removed or the ride ends.' },
  { title: 'Your choices', text: 'Location sharing starts off. Instagram and TikTok usernames each have Public, Friends only or Private visibility. You can delete your account and prototype data from Settings.' },
  { title: 'Rider safety and conduct', text: 'Harassment, threats, sexual exploitation, dangerous content, spam and impersonation are not allowed. Direct-message screens include Report and Block controls. Blocking removes the friendship and prevents further messages or requests.' },
  { title: 'Riding safety', text: 'Do not operate messaging, profile or billing controls while moving. Stop somewhere safe before using visual or touch controls.' },
  { title: 'Test-build notice', text: 'This is a pre-alpha test build backed by a test API and database. A published privacy policy, support contact, documented retention schedule, tested deletion process and staffed moderation operation are still required before public store release.' },
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
