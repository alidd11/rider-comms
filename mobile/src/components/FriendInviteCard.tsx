// Shown under a short friends list so the screen isn't bare (PWA:
// #friendInvite): share your handle, or add a rider by theirs.
import * as React from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, MIN_TOUCH_TARGET, pressedFeedback, radii, spacing, type } from '../theme';

export function FriendInviteCard({ handle, onAdd }: { handle: string; onAdd: () => void }): React.JSX.Element {
  return (
    <View style={styles.card} testID="friend-invite">
      <View style={styles.head}>
        <View style={styles.icon}><Ionicons name="person-add-outline" size={22} color={colors.accentInk} /></View>
        <View style={styles.copy}>
          <Text style={styles.title}>Ride with more friends</Text>
          <Text style={styles.text}>Share your handle <Text style={styles.handle}>{handle}</Text> so riders can add you, or add theirs.</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void Share.share({ message: `Add me on Rider Comms: ${handle}` }).catch(() => {})}
          style={({ pressed }) => [styles.primary, pressed && pressedFeedback]}
        >
          <Text style={styles.primaryText}>Share handle</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onAdd} style={({ pressed }) => [styles.secondary, pressed && pressedFeedback]}>
          <Text style={styles.secondaryText}>Add a rider</Text>
        </Pressable>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  card: { marginTop: spacing.md, marginHorizontal: spacing.md, padding: spacing.md, gap: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, ...elevation.raised },
  head: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  copy: { flex: 1, minWidth: 0 },
  title: { ...type.subheading, color: colors.textPrimary, fontSize: 16 },
  text: { ...type.caption, color: colors.textSecondary, fontSize: 14, lineHeight: 19, marginTop: 4 },
  handle: { fontWeight: '800', color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: 10 },
  primary: { flex: 1, minHeight: MIN_TOUCH_TARGET - 2, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  primaryText: { ...type.button, color: colors.accentText },
  secondary: { flex: 1, minHeight: MIN_TOUCH_TARGET - 2, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  secondaryText: { ...type.button, color: colors.textPrimary },
});
