// Turn-by-turn navigation's screen furniture (PWA: #navBanner, #navSpeedBadge,
// #navSummary and the navigation control dock). MapScreen owns the state;
// these only draw it.
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
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
import { colors, pressedFeedback } from '../theme';
import { NavigationManeuverGlyph } from '../components/NavigationManeuverGlyph';
import { NavigationRoadAhead } from '../components/NavigationRoadAhead';
import { styles } from './MapScreen.styles';
import { ROUTE_UPDATED_NOTICE } from './useInAppNavigation';

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
  return (
    <View testID="navigation-banner" style={[styles.navigationBanner, { top }]} onLayout={measured(onHeight)}>
      <View style={styles.navigationBannerMain}>
        <View style={styles.navigationManeuver}>
          <NavigationManeuverGlyph
            maneuver={upcomingStep?.maneuver ?? 'arrive'}
            size={66}
            color={colors.textPrimary}
            secondaryColor={colors.textMuted}
          />
        </View>
        <View style={styles.navigationBannerCopy}>
          <Text style={styles.navigationDistance}>{formatNavigationDistance(distanceToStepEnd, unitSystem)}</Text>
          {/* As in Google and Apple Maps: the distance, then the road the
              turn leads onto in large type (the arrow shows the turn).
              Without a named road, the action and full instruction show. */}
          <Text
            numberOfLines={roadName ? 2 : 1}
            style={[styles.navigationInstruction, roadName ? styles.navigationRoad : null]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={guidanceInstruction}
          >
            {roadName ?? glanceAction}
          </Text>
          {roadName ? null : (
            <Text numberOfLines={2} accessible={false} style={styles.navigationProviderInstruction}>
              {guidanceInstruction}
            </Text>
          )}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="End navigation" onPress={onEnd} style={({ pressed }) => [styles.navigationEndButton, pressed && pressedFeedback]}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </Pressable>
      </View>
      {followingStep ? (
        <View style={styles.navigationNextPreview}>
          <View style={styles.navigationNextGlyph}>
            <NavigationManeuverGlyph
              maneuver={followingStep.maneuver}
              size={30}
              color={colors.textSecondary}
              secondaryColor={colors.textMuted}
            />
          </View>
          <Text style={styles.navigationNextLabel}>Then</Text>
          <Text numberOfLines={1} style={styles.navigationNextInstruction} accessibilityLabel={followingStep.instruction}>{navigationInstructionRoad(followingStep.instruction) ?? followingStep.instruction}</Text>
        </View>
      ) : null}
      <NavigationRoadAhead alerts={roadAlerts} unit={unitSystem} />
      {notice ? (
        <View
          style={[styles.navigationNoticeRow, notice === ROUTE_UPDATED_NOTICE && styles.navigationNoticeRowInfo]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={notice}
        >
          <Ionicons
            name={notice === ROUTE_UPDATED_NOTICE ? 'checkmark-circle-outline' : 'warning-outline'}
            size={16}
            color={notice === ROUTE_UPDATED_NOTICE ? colors.accent : colors.warning}
          />
          <Text style={styles.navigationNotice}>{notice}</Text>
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
  return (
    <View
      style={[styles.navigationSpeedBadge, { top }]}
      accessible
      accessibilityLabel={navigationSpeedMps == null
        ? 'Current speed unavailable'
        : `Current speed ${formatNavigationSpeed(navigationSpeedMps, unitSystem)} ${navigationSpeedUnit(unitSystem)}`}
    >
      <Text style={styles.navigationSpeedBadgeValue}>{formatNavigationSpeed(navigationSpeedMps, unitSystem)}</Text>
      <Text style={styles.navigationSpeedBadgeUnit}>{navigationSpeedUnit(unitSystem)}</Text>
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
  return (
    <View testID="navigation-summary" style={[styles.navigationSummary, { paddingBottom: bottomPadding }]} onLayout={measured(onHeight)}>
      <View style={styles.navigationSummaryHandle} />
      <View style={styles.navigationSummaryContent}>
        <View style={styles.navigationSummaryPrimary}>
          <Text style={styles.navigationArrival}>{arrivalLabel}</Text>
          <Text style={styles.navigationSummaryLabel}>arrival</Text>
        </View>
        <View style={styles.navigationSummaryDivider} />
        <View style={styles.navigationSummaryStat}>
          <Text style={styles.navigationSummaryValue}>{formatNavigationDuration(remainingSeconds)}</Text>
          <Text style={styles.navigationSummaryLabel}>left</Text>
        </View>
        <View style={styles.navigationSummaryDivider} />
        <View style={styles.navigationSummaryStat}>
          <Text style={styles.navigationSummaryValue}>{formatNavigationDistance(remainingMeters, unitSystem)}</Text>
          <Text style={styles.navigationSummaryLabel}>away</Text>
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
