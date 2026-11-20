import * as React from 'react';
import { Linking, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import type { RootStackParamList } from '../navigation';
import { useSettings } from '../settings/SettingsContext';
import { PLAN_INFO } from '../settings/plans';
import { RiderAvatar } from '../components/RiderAvatar';
import { useRide } from '../ride/RideContext';
import { useFriends } from '../friends/FriendsContext';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { RIDER_SOCIAL_URL } from '@rider-comms/shared';
import { colors, elevation, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';
import { useRideHistory } from '../ride/rideHistory';
import type { RideHistoryEntry } from '@rider-comms/shared';

type Props = NativeStackScreenProps<RootStackParamList, 'Menu'>;

/** Totals over the rides kept on this device (PWA: renderMenuRideStats). */
export function menuRideStats(history: readonly RideHistoryEntry[], unit: 'mi' | 'km'): { rides: string; time: string; distance: string; distanceLabel: string } {
  const minutes = Math.round(history.reduce((sum, entry) => sum + entry.durationMs, 0) / 60_000);
  const metres = history.reduce((sum, entry) => sum + (entry.distanceMeters ?? 0), 0);
  return {
    rides: String(history.length),
    time: minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
    distance: (metres / (unit === 'km' ? 1000 : 1609.344)).toFixed(metres > 0 ? 1 : 0),
    distanceLabel: unit === 'km' ? 'Kilometres' : 'Miles',
  };
}

/** The last Rider Social access answer for each signed-in client. */
const socialAccess = new WeakMap<object, boolean>();

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
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={22} color={colors.accentInk} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

/**
 * Opened from the rider's avatar on the map (PWA: #appMenu). Ride and
 * Friends go back to the tabs; the other rows replace this screen with
 * their destination so Back returns to the map.
 */
export function MenuScreen({ navigation }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { avatarId, displayName, handle, zoneTier, unitSystem } = useSettings();
  const { riderId } = useAuth();
  const stats = menuRideStats(useRideHistory(riderId), unitSystem);
  const appVersion = Constants.expoConfig?.version ?? '0.1.0';
  const { activeRide } = useRide();
  const { incomingRequests, unreadMessageCount } = useFriends();
  const friendsCount = incomingRequests.length + unreadMessageCount;
  const { client } = useAuth();
  // Rider Social is listed only for riders the server lets in. The last
  // answer for this session shows straight away, so the row doesn't flicker
  // while the check runs; a refusal removes it, a lost connection doesn't.
  const [socialAllowed, setSocialAllowed] = React.useState(() => socialAccess.get(client) === true);
  React.useEffect(() => {
    let live = true;
    client.getSocialBootstrap().then(() => {
      socialAccess.set(client, true);
      if (live) setSocialAllowed(true);
    }, (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      socialAccess.delete(client);
      if (live) setSocialAllowed(false);
    });
    return () => { live = false; };
  }, [client]);

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

        <View style={styles.stats} accessibilityLabel="Your recent rides" testID="menu-ride-stats">
          {[[stats.rides, 'Rides'], [stats.time, 'Ride time'], [stats.distance, stats.distanceLabel]].map(([value, label]) => (
            <View key={label} style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
              <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
            </View>
          ))}
        </View>

        <MenuRow icon="bicycle-outline" label="Ride" detail={activeRide ? 'Live' : undefined} onPress={() => navigation.navigate('Tabs', { screen: 'Map', params: { segment: 'host', at: Date.now() } })} />
        <MenuRow icon="people-outline" label="Friends" detail={friendsCount > 0 ? `${friendsCount > 99 ? '99+' : friendsCount} new` : undefined} onPress={() => navigation.navigate('Tabs', { screen: 'Friends' })} />
        <MenuRow icon="flag-outline" label="Routes" onPress={() => navigation.replace('Routes')} />
        {socialAllowed ? <MenuRow icon="camera-outline" label="Rider Social" detail="Beta" onPress={() => void Linking.openURL(RIDER_SOCIAL_URL)} /> : null}
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
  stats: { flexDirection: 'row', gap: 10, marginTop: spacing.sm, marginBottom: spacing.md },
  stat: { flex: 1, minWidth: 0, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radii.lg, backgroundColor: colors.surface, ...elevation.raised },
  statValue: { ...type.heading, color: colors.textPrimary, fontSize: 22, lineHeight: 26, fontWeight: '800' },
  statLabel: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.md, paddingHorizontal: spacing.sm },
  rowPressed: { opacity: 0.7 },
  rowLabel: { ...type.body, flex: 1, color: colors.textPrimary, fontSize: 18, lineHeight: 23, fontWeight: '600' },
  rowDetail: { ...type.caption, color: colors.textSecondary, fontSize: 14 },
  version: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: 'auto', paddingTop: spacing.xl },
});
