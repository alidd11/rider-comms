// Turn-by-turn navigation's screen furniture (PWA: #navBanner, #navSpeedBadge,
// #navSummary and the navigation control dock). MapScreen owns the state;
// these only draw it.
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { InAppNavigationRoute } from '../api/directions';
import type { NavigationRouteHazard } from '../navigationRoadEvents';
import {
  formatNavigationDistance,
  formatNavigationDuration,
  formatNavigationSpeed,
  navigationInstructionRoad,
  navigationSpeedUnit,
} from '../navigationGuidance';
import type { UnitSystem } from '../settings/SettingsContext';
import { colors, darkColors, pressedFeedback } from '../theme';
import { useNavigationPalette } from '../navigationTone';
import { NavigationManeuverGlyph } from '../components/NavigationManeuverGlyph';
import { NavigationRoadAhead } from '../components/NavigationRoadAhead';
import { styles } from './MapScreen.styles';
import { ROUTE_UPDATED_NOTICE } from './useInAppNavigation';

// The night look over a dark map while the phone is in light mode (see
// navigationTone.ts): the same shapes in the dark theme's colours.
const night = StyleSheet.create({
  card: { backgroundColor: darkColors.surface, borderColor: darkColors.border },
  distance: { color: darkColors.accentInk },
  primaryText: { color: darkColors.textPrimary },
  secondaryText: { color: darkColors.textSecondary },
  mutedText: { color: darkColors.textMuted },
  endButton: { backgroundColor: darkColors.surfaceRaised },
  nextPreview: { backgroundColor: darkColors.background, borderTopColor: darkColors.border },
  notice: { backgroundColor: darkColors.dangerSurface, borderTopColor: darkColors.border },
  noticeInfo: { backgroundColor: darkColors.surfaceRaised },
  handle: { backgroundColor: darkColors.textMuted },
  arrival: { color: darkColors.success },
  divider: { backgroundColor: darkColors.border },
});

type Step = InAppNavigationRoute['steps'][number];

/** Reports a measured height, ignoring sub-pixel jitter. */
function measured(onHeight: React.Dispatch<React.SetStateAction<number>>) {
  return (event: { nativeEvent: { layout: { height: number } } }) => {
    const height = Math.ceil(event.nativeEvent.layout.height);
    onHeight((current) => Math.abs(current - height) > 1 ? height : current);
  };
}

export function NavigationBanner({
  top,
  upcomingStep,
  followingStep,
  distanceToStepEnd,
  unitSystem,
  roadName,
  glanceAction,
  guidanceInstruction,
  roadAlerts,
  notice,
  onHeight,
  onEnd,
}: {
  top: number;
  upcomingStep: Step | null;
  followingStep: Step | null;
  distanceToStepEnd: number;
  unitSystem: UnitSystem;
  roadName: string | null;
  glanceAction: string;
  guidanceInstruction: string;
  roadAlerts: NavigationRouteHazard[];
  notice: string | null;
  onHeight: React.Dispatch<React.SetStateAction<number>>;
  onEnd: () => void;
}): React.JSX.Element {
  const { night: isNight, palette } = useNavigationPalette();
  return (
    <View testID="navigation-banner" style={[styles.navigationBanner, isNight && night.card, { top }]} onLayout={measured(onHeight)}>
      <View style={styles.navigationBannerMain}>
        <View style={styles.navigationManeuver}>
          <NavigationManeuverGlyph
            maneuver={upcomingStep?.maneuver ?? 'arrive'}
            size={66}
            color={palette.textPrimary}
            secondaryColor={palette.textMuted}
          />
        </View>
        <View style={styles.navigationBannerCopy}>
          <Text style={[styles.navigationDistance, isNight && night.distance]}>{formatNavigationDistance(distanceToStepEnd, unitSystem)}</Text>
          {/* As in Google and Apple Maps: the distance, then the road the
              turn leads onto in large type (the arrow shows the turn).
              Without a named road, the action and full instruction show. */}
          <Text
            numberOfLines={roadName ? 2 : 1}
            style={[styles.navigationInstruction, roadName ? styles.navigationRoad : null, isNight && night.primaryText]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={guidanceInstruction}
          >
            {roadName ?? glanceAction}
          </Text>
          {roadName ? null : (
            <Text numberOfLines={2} accessible={false} style={[styles.navigationProviderInstruction, isNight && night.secondaryText]}>
              {guidanceInstruction}
            </Text>
          )}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="End navigation" onPress={onEnd} style={({ pressed }) => [styles.navigationEndButton, isNight && night.endButton, pressed && pressedFeedback]}>
          <Ionicons name="close" size={24} color={palette.textPrimary} />
        </Pressable>
      </View>
      {followingStep ? (
        <View style={[styles.navigationNextPreview, isNight && night.nextPreview]}>
          <View style={styles.navigationNextGlyph}>
            <NavigationManeuverGlyph
              maneuver={followingStep.maneuver}
              size={30}
              color={palette.textSecondary}
              secondaryColor={palette.textMuted}
            />
          </View>
          <Text style={[styles.navigationNextLabel, isNight && night.mutedText]}>Then</Text>
          <Text numberOfLines={1} style={[styles.navigationNextInstruction, isNight && night.secondaryText]} accessibilityLabel={followingStep.instruction}>{navigationInstructionRoad(followingStep.instruction) ?? followingStep.instruction}</Text>
        </View>
      ) : null}
      <NavigationRoadAhead alerts={roadAlerts} unit={unitSystem} />
      {notice ? (
        <View
          style={[styles.navigationNoticeRow, isNight && night.notice, notice === ROUTE_UPDATED_NOTICE && styles.navigationNoticeRowInfo, isNight && notice === ROUTE_UPDATED_NOTICE && night.noticeInfo]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={notice}
        >
          <Ionicons
            name={notice === ROUTE_UPDATED_NOTICE ? 'checkmark-circle-outline' : 'warning-outline'}
            size={16}
            color={notice === ROUTE_UPDATED_NOTICE ? palette.accent : palette.warning}
          />
          <Text style={[styles.navigationNotice, isNight && night.secondaryText]}>{notice}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function NavigationSpeedBadge({ top, navigationSpeedMps, unitSystem }: {
  top: number;
  navigationSpeedMps: number | null;
  unitSystem: UnitSystem;
}): React.JSX.Element {
  const { night: isNight } = useNavigationPalette();
  return (
    <View
      style={[styles.navigationSpeedBadge, isNight && night.card, { top }]}
      accessible
      accessibilityLabel={navigationSpeedMps == null
        ? 'Current speed unavailable'
        : `Current speed ${formatNavigationSpeed(navigationSpeedMps, unitSystem)} ${navigationSpeedUnit(unitSystem)}`}
    >
      <Text style={[styles.navigationSpeedBadgeValue, isNight && night.primaryText]}>{formatNavigationSpeed(navigationSpeedMps, unitSystem)}</Text>
      <Text style={[styles.navigationSpeedBadgeUnit, isNight && night.mutedText]}>{navigationSpeedUnit(unitSystem)}</Text>
    </View>
  );
}

export function NavigationTripSummary({
  bottomPadding,
  arrivalLabel,
  remainingSeconds,
  remainingMeters,
  unitSystem,
  onHeight,
}: {
  bottomPadding: number;
  arrivalLabel: string;
  remainingSeconds: number;
  remainingMeters: number;
  unitSystem: UnitSystem;
  onHeight: React.Dispatch<React.SetStateAction<number>>;
}): React.JSX.Element {
  const { night: isNight } = useNavigationPalette();
  const label = [styles.navigationSummaryLabel, isNight && night.mutedText];
  const value = [styles.navigationSummaryValue, isNight && night.primaryText];
  const divider = [styles.navigationSummaryDivider, isNight && night.divider];
  return (
    <View testID="navigation-summary" style={[styles.navigationSummary, isNight && night.card, { paddingBottom: bottomPadding }]} onLayout={measured(onHeight)}>
      <View style={[styles.navigationSummaryHandle, isNight && night.handle]} />
      <View style={styles.navigationSummaryContent}>
        <View style={styles.navigationSummaryPrimary}>
          <Text style={[styles.navigationArrival, isNight && night.arrival]}>{arrivalLabel}</Text>
          <Text style={label}>arrival</Text>
        </View>
        <View style={divider} />
        <View style={styles.navigationSummaryStat}>
          <Text style={value}>{formatNavigationDuration(remainingSeconds)}</Text>
          <Text style={label}>left</Text>
        </View>
        <View style={divider} />
        <View style={styles.navigationSummaryStat}>
          <Text style={value}>{formatNavigationDistance(remainingMeters, unitSystem)}</Text>
          <Text style={label}>away</Text>
        </View>
      </View>
    </View>
  );
}

/** Report, mute and overview/follow, to the right above the trip summary. */
export function NavigationControls({
  bottom,
  canReport,
  muted,
  following,
  onReport,
  onToggleMute,
  onOverviewOrFollow,
}: {
  bottom: number;
  canReport: boolean;
  muted: boolean;
  following: boolean;
  onReport: () => void;
  onToggleMute: () => void;
  onOverviewOrFollow: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.navigationActions, { bottom }]}>
      {canReport && (
        <Pressable
          style={({ pressed }) => [styles.navigationActionButton, pressed && styles.navigationActionButtonPressed]}
          onPress={onReport}
          accessibilityRole="button"
          accessibilityLabel="Report on the road"
        >
          <MaterialCommunityIcons name="alert-plus" size={24} color={colors.textPrimary} />
        </Pressable>
      )}
      <Pressable
        style={({ pressed }) => [styles.navigationActionButton, muted && styles.navigationActionButtonActive, pressed && styles.navigationActionButtonPressed]}
        onPress={onToggleMute}
        accessibilityRole="button"
        accessibilityState={{ selected: muted }}
        accessibilityLabel={muted ? 'Unmute navigation guidance' : 'Mute navigation guidance'}
        accessibilityHint={muted ? 'Restores spoken turn instructions' : 'Silences spoken turn instructions'}
      >
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={24} color={muted ? colors.accentText : colors.textPrimary} />
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.navigationActionButton, !following && styles.navigationActionButtonActive, pressed && styles.navigationActionButtonPressed]}
        onPress={onOverviewOrFollow}
        accessibilityRole="button"
        accessibilityLabel={following ? 'Show route overview' : 'Resume navigation follow mode'}
        accessibilityHint={following ? 'Shows the full route on the map' : 'Keeps the map centred on your ride'}
      >
        <Ionicons
          name={following ? 'map-outline' : 'navigate'}
          size={24}
          color={following ? colors.textPrimary : colors.accentText}
        />
      </Pressable>
    </View>
  );
}
