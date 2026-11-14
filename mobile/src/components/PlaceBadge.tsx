import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme';

/**
 * A filled icon on a colour per kind of place, so Home, Work and Petrol read
 * at a glance, as in Google Maps and Waze (PWA: .place-badge). Every colour
 * keeps at least 3:1 contrast with the white icon.
 */
export const PLACE_BADGES = {
  home: { icon: 'home', color: '#2f7fd3' },
  work: { icon: 'briefcase', color: '#8a5cd6' },
  fuel: { icon: 'gas-station', color: '#1f9d63' },
  parking: { icon: 'parking', color: '#3b5bdb' },
  food: { icon: 'silverware-fork-knife', color: '#d9480f' },
  coffee: { icon: 'coffee', color: '#8d5a3b' },
  repair: { icon: 'wrench', color: '#5f6b73' },
  moto: { icon: 'motorbike', color: '#c2410c' },
  ev: { icon: 'ev-station', color: '#0e7c86' },
  pin: { icon: 'map-marker', color: colors.accent },
  recent: { icon: 'clock-outline', color: colors.surfaceRaised },
} as const;

export type PlaceBadgeKind = keyof typeof PLACE_BADGES;

export function PlaceBadge({ kind, size = 32 }: { kind: PlaceBadgeKind; size?: number }): React.JSX.Element {
  const badge = PLACE_BADGES[kind];
  return (
    <View
      style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: badge.color }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`place-badge-${kind}`}
    >
      <MaterialCommunityIcons name={badge.icon} size={Math.round(size * 0.56)} color={kind === 'recent' ? colors.textSecondary : '#ffffff'} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
});
