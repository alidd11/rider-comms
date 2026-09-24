import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { HazardNavigationIcon } from './HazardIcon';
import { formatNavigationDistance, type NavigationUnit } from '../navigationGuidance';
import {
  navigationHazardCompactLabel,
  navigationHazardLabel,
  type NavigationRouteHazard,
} from '../navigationRoadEvents';

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
          const label = navigationHazardLabel(alert.hazard.type);
          const displayLabel = navigationHazardCompactLabel(alert.hazard.type);
          const distance = formatNavigationDistance(alert.distanceAheadMeters, unit);
          return (
            <View
              key={alert.hazard.id}
              style={styles.event}
              accessible
              accessibilityLabel={`${label}, ${distance} ahead`}
            >
              <HazardNavigationIcon type={alert.hazard.type} size={22} />
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
    gap: 6,
    paddingHorizontal: 8,
    minHeight: 32,
    borderRadius: 9,
    backgroundColor: colors.surfaceRaised,
  },
  eventLabel: {
    minWidth: 0,
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
  },
  distance: {
    flexShrink: 0,
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
  },
});
