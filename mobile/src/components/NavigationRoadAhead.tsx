import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, darkColors } from '../theme';
import { GLANCE_TEXT_MAX_SCALE, useNavigationPalette } from '../navigationTone';
import { HazardNavigationIcon } from './HazardIcon';
import { formatNavigationDistance, type NavigationUnit } from '../navigationGuidance';
import {
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
  const { night: isNight } = useNavigationPalette();
  if (alerts.length === 0) return null;

  return (
    <View style={[styles.container, isNight && night.container]} accessibilityRole="summary">
      <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.eyebrow, isNight && night.eyebrow]}>Reports ahead</Text>
      <View style={styles.events}>
        {alerts.slice(0, 2).map((alert) => {
          const label = navigationHazardLabel(alert.hazard.type);
          const distance = formatNavigationDistance(alert.distanceAheadMeters, unit);
          return (
            <View
              key={alert.hazard.id}
              style={[styles.event, isNight && night.event]}
              accessible
              accessibilityLabel={`${label}, ${distance} ahead`}
            >
              <HazardNavigationIcon type={alert.hazard.type} size={22} />
              <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} numberOfLines={1} style={[styles.distance, isNight && night.distance]}>{distance}</Text>
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
  distance: {
    flexShrink: 0,
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '800',
  },
});

// Over the night map while the phone is in light mode (navigationTone.ts).
const night = StyleSheet.create({
  container: { borderTopColor: darkColors.border, backgroundColor: darkColors.background },
  eyebrow: { color: darkColors.textMuted },
  event: { backgroundColor: darkColors.surfaceRaised },
  distance: { color: darkColors.textPrimary },
});
