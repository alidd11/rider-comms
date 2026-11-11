import * as React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import type { RootStackParamList } from '../navigation';
import { useSettings } from '../settings/SettingsContext';
import { PLAN_INFO } from '../settings/plans';
import { RiderAvatar } from '../components/RiderAvatar';
import { colors, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Menu'>;

function MenuRow({ icon, label, detail, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  detail?: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, detail].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Ionicons name={icon} size={26} color={colors.textPrimary} />
      <Text style={styles.rowLabel}>{label}</Text>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

/**
 * Everything that isn't a main tab (Map, Ride, Friends): opened from the
 * rider's avatar on the map. Rows replace this screen
 * with their destination so Back returns to the map.
 */
export function MenuScreen({ navigation }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { avatarId, displayName, handle, zoneTier } = useSettings();
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.close, pressed && styles.rowPressed]}
          testID="close-menu"
        >
          <Ionicons name="close" size={26} color={colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.lg }]} showsVerticalScrollIndicator={false}>
        <View style={styles.profile}>
          <RiderAvatar avatarId={avatarId} size={84} />
          <View style={styles.profileCopy}>
            <Text numberOfLines={1} style={styles.name}>{displayName}</Text>
            <Text numberOfLines={1} style={styles.handle}>{handle}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View profile"
              onPress={() => navigation.replace('SettingsPage', { page: 'myProfile' })}
              style={({ pressed }) => [styles.profileButton, pressed && styles.rowPressed]}
            >
              <Text style={styles.profileButtonText}>View profile</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.divider} />

        <MenuRow icon="flag-outline" label="Routes" onPress={() => navigation.replace('Routes')} />
        <MenuRow icon="card-outline" label="Your plan" detail={PLAN_INFO[zoneTier].name} onPress={() => navigation.replace('Billing')} />
        <MenuRow icon="settings-outline" label="Settings" onPress={() => navigation.replace('Settings')} />
        <MenuRow icon="help-circle-outline" label="Help & Support" onPress={() => navigation.replace('SettingsPage', { page: 'help' })} />

        <Text style={styles.version}>Rider Comms v{appVersion}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.md },
  close: { width: MIN_TOUCH_TARGET + 4, height: MIN_TOUCH_TARGET + 4, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg },
  profile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  profileCopy: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  name: { ...type.title, color: colors.textPrimary, fontSize: 26, lineHeight: 30 },
  handle: { ...type.body, color: colors.textSecondary, marginTop: 2 },
  profileButton: { marginTop: spacing.sm, minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radii.pill, justifyContent: 'center', backgroundColor: colors.surfaceRaised },
  profileButtonText: { ...type.button, color: colors.accentInk, fontSize: 16 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.lg, paddingHorizontal: spacing.xs },
  rowPressed: { opacity: 0.7 },
  rowLabel: { ...type.body, flex: 1, color: colors.textPrimary, fontSize: 19, lineHeight: 24, fontWeight: '500' },
  rowDetail: { ...type.caption, color: colors.textSecondary, fontSize: 14 },
  version: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: 'auto', paddingTop: spacing.xl },
});
