import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { HazardType } from '@rider-comms/shared';
import { colors } from '../theme';
import { formatNavigationDistance, type NavigationUnit } from '../navigationGuidance';
import {
  navigationHazardLabel,
  type NavigationRouteHazard,
} from '../navigationRoadEvents';

const ROAD_ALERT_META: Record<HazardType, {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
}> = {
  police: { icon: 'police-badge', color: colors.accent },
  hidden_police: { icon: 'incognito', color: colors.accent },
  police_checkpoint: { icon: 'boom-gate', color: colors.accent },
  camera: { icon: 'camera', color: colors.accent },
  accident: { icon: 'car-emergency', color: colors.danger },
  hazard: { icon: 'car-tire-alert', color: colors.warning },
  road_closure: { icon: 'road-variant', color: colors.danger },
};

export function NavigationRoadAhead({
  alerts,
  unit,
}: {
  alerts: readonly NavigationRouteHazard[];
  unit: NavigationUnit;
}): React.JSX.Element | null {
  if (alerts.length === 0) return null;

  return (
    <View style={styles.container} accessibilityRole="summary">
      <Text style={styles.eyebrow}>Reports ahead</Text>
      <View style={styles.events}>
        {alerts.slice(0, 2).map((alert) => {
          const meta = ROAD_ALERT_META[alert.hazard.type];
          const label = navigationHazardLabel(alert.hazard.type);
          const displayLabel = label.replace(/ reported$/, '');
          const distance = formatNavigationDistance(alert.distanceAheadMeters, unit);
          return (
            <View
              key={alert.hazard.id}
              style={styles.event}
              accessible
              accessibilityLabel={`${label}, ${distance} ahead`}
            >
              <MaterialCommunityIcons
                accessible={false}
                name={meta.icon}
                size={17}
                color={meta.color}
              />
              <Text numberOfLines={1} style={styles.eventLabel}>{displayLabel}</Text>
              <Text numberOfLines={1} style={styles.distance}>{distance}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  eyebrow: {
    flexShrink: 0,
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  events: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  event: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    minHeight: 28,
    borderRadius: 9,
    backgroundColor: colors.surfaceRaised,
  },
  eventLabel: {
    minWidth: 0,
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  distance: {
    flexShrink: 0,
    color: colors.textPrimary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
});
