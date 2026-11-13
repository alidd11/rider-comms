// The group's regroup point (set by the ride host): a flag on the map and a
// chip that says where and how far, one tap from the route there.
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import type { RegroupPoint } from '@rider-comms/shared';
import { metersBetween } from '../api/directions';
import { formatNavigationDistance } from '../navigationGuidance';
import type { UnitSystem } from '../settings/SettingsContext';
import { colors, elevation, MIN_TOUCH_TARGET, pressedFeedback, spacing } from '../theme';

export const REGROUP_FALLBACK_LABEL = 'Regroup point';

/** What the chip and marker call the point: its place name, or a fallback. */
export function regroupTitle(point: RegroupPoint): string {
  return point.label || REGROUP_FALLBACK_LABEL;
}

/** Whether a selected place is the regroup point itself (within ~10 m). */
export function isRegroupSpot(point: RegroupPoint | null, place: { lat: number; lon: number } | null): boolean {
  if (!point || !place) return false;
  return metersBetween(point, place) < 10;
}

export function RegroupMarker({ point, onPress }: { point: RegroupPoint; onPress: () => void }): React.JSX.Element {
  return (
    <Marker
      coordinate={{ latitude: point.lat, longitude: point.lon }}
      title={`Regroup: ${regroupTitle(point)}`}
      description="Set by the ride host"
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={onPress}
      tracksViewChanges={false}
      zIndex={11}
      testID="regroup-marker"
    >
      <View style={styles.marker}>
        <Ionicons name="flag" size={20} color="#FFFFFF" />
      </View>
    </Marker>
  );
}

export function RegroupChip({
  point,
  from,
  unitSystem,
  top,
  onPress,
}: {
  point: RegroupPoint;
  from: { lat: number; lon: number } | null;
  unitSystem: UnitSystem;
  top: number;
  onPress: () => void;
}): React.JSX.Element {
  const title = regroupTitle(point);
  const distance = from ? formatNavigationDistance(metersBetween(from, point), unitSystem) : null;
  return (
    <Pressable
      testID="regroup-chip"
      style={({ pressed }) => [styles.chip, { top }, pressed && pressedFeedback]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Regroup at ${title}${distance ? `, ${distance} away` : ''}`}
      accessibilityHint="Shows the regroup point and the route there"
    >
      <View style={styles.chipIcon}>
        <Ionicons name="flag" size={15} color="#FFFFFF" />
      </View>
      <Text style={styles.chipText} numberOfLines={1}>
        <Text style={styles.chipLead}>Regroup</Text>
        {` · ${title}${distance ? ` · ${distance}` : ''}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  marker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warning,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    ...elevation.raised,
  },
  chip: {
    position: 'absolute',
    left: spacing.md,
    zIndex: 9,
    maxWidth: '80%',
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.raised,
  },
  chipIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warning,
  },
  chipText: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  chipLead: { fontWeight: '800', color: colors.textPrimary },
});
