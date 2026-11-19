// Turn-by-turn navigation's screen furniture (PWA: #navBanner, #navSpeedBadge,
// #navSummary and the navigation control dock). MapScreen owns the state;
// these only draw it.
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import type { RouteChoice } from '@rider-comms/shared';
import type { UnitSystem } from '../settings/SettingsContext';
import { colors, darkColors, lightColors, pressedFeedback } from '../theme';
import { GLANCE_TEXT_MAX_SCALE, useNavigationPalette } from '../navigationTone';
import { NavigationManeuverGlyph } from '../components/NavigationManeuverGlyph';
import { NavigationRoadAhead } from '../components/NavigationRoadAhead';
import { styles } from './MapScreen.styles';
import { ROUTE_UPDATED_NOTICE } from './useInAppNavigation';
import { haptics } from '../haptics';

// The turn banner is the guidance colour day and night, with white type, as
// in Google Maps (PWA: .nav-banner); night only deepens it.
const guidance = StyleSheet.create({
  banner: { backgroundColor: lightColors.guidance, borderColor: 'transparent' },
  bannerNight: { backgroundColor: darkColors.guidance },
  strip: { backgroundColor: lightColors.guidanceStrip, borderTopColor: 'transparent' },
  stripNight: { backgroundColor: darkColors.guidanceStrip },
  text: { color: '#FFFFFF' },
  softText: { color: 'rgba(255,255,255,0.82)' },
});

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
}): React.JSX.Element {
  const { night: isNight, palette } = useNavigationPalette();
  return (
    <View testID="navigation-banner" style={[styles.navigationBanner, guidance.banner, isNight && guidance.bannerNight, { top }]} onLayout={measured(onHeight)}>
      <View style={styles.navigationBannerMain}>
        <View style={styles.navigationManeuver}>
          <NavigationManeuverGlyph
            maneuver={upcomingStep?.maneuver ?? 'arrive'}
            size={66}
            color="#FFFFFF"
            secondaryColor="rgba(255,255,255,0.55)"
          />
        </View>
        <View style={styles.navigationBannerCopy}>
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.navigationDistance, guidance.text]}>{formatNavigationDistance(distanceToStepEnd, unitSystem)}</Text>
          {/* As in Google and Apple Maps: the distance, then the road the
              turn leads onto in large type (the arrow shows the turn).
              Without a named road, the action and full instruction show. */}
          <Text
            numberOfLines={roadName ? 2 : 1}
            style={[styles.navigationInstruction, roadName ? styles.navigationRoad : null, guidance.text]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={guidanceInstruction}
          >
            {roadName ?? glanceAction}
          </Text>
          {roadName ? null : (
            <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} numberOfLines={2} accessible={false} style={[styles.navigationProviderInstruction, guidance.softText]}>
              {guidanceInstruction}
            </Text>
          )}
        </View>
      </View>
      {followingStep ? (
        <View style={[styles.navigationNextPreview, guidance.strip, isNight && guidance.stripNight]}>
          <View style={styles.navigationNextGlyph}>
            <NavigationManeuverGlyph
              maneuver={followingStep.maneuver}
              size={30}
              color="#FFFFFF"
              secondaryColor="rgba(255,255,255,0.55)"
            />
          </View>
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.navigationNextLabel, guidance.softText]}>Then</Text>
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} numberOfLines={1} style={[styles.navigationNextInstruction, guidance.text]} accessibilityLabel={followingStep.instruction}>{navigationInstructionRoad(followingStep.instruction) ?? followingStep.instruction}</Text>
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
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.navigationNotice, isNight && night.secondaryText]}>{notice}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Bottom-left above the trip card, as in Google Maps (PWA: #navSpeedBadge). */
export function NavigationSpeedBadge({ bottom, navigationSpeedMps, unitSystem }: {
  bottom: number;
  navigationSpeedMps: number | null;
  unitSystem: UnitSystem;
}): React.JSX.Element {
  const { night: isNight } = useNavigationPalette();
  return (
    <View
      style={[styles.navigationSpeedBadge, isNight && night.card, { bottom }]}
      accessible
      accessibilityLabel={navigationSpeedMps == null
        ? 'Current speed unavailable'
        : `Current speed ${formatNavigationSpeed(navigationSpeedMps, unitSystem)} ${navigationSpeedUnit(unitSystem)}`}
    >
      <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.navigationSpeedBadgeValue, isNight && night.primaryText]}>{formatNavigationSpeed(navigationSpeedMps, unitSystem)}</Text>
      <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.navigationSpeedBadgeUnit, isNight && night.mutedText]}>{navigationSpeedUnit(unitSystem)}</Text>
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
  routeChoices = [],
  chosenRouteIndex = -1,
  onChooseRoute,
  trafficText = '',
  onEnd,
  tripDetails,
}: {
  bottomPadding: number;
  arrivalLabel: string;
  remainingSeconds: number;
  remainingMeters: number;
  unitSystem: UnitSystem;
  onHeight: React.Dispatch<React.SetStateAction<number>>;
  /** Other ways there, offered while parked (PWA: #navRouteChoices). */
  routeChoices?: RouteChoice[];
  chosenRouteIndex?: number;
  onChooseRoute?: (index: number) => void;
  /** "+8 min traffic" when today's traffic is adding time. */
  trafficText?: string;
  /** End sits at the left of the trip card, away from the turn, as in Google Maps. */
  onEnd: () => void;
  /**
   * The card's expanded half (PWA: #navTripDetails): the turns left, Add
   * stop and Share ETA. Pass it only while parked; Ride Safe leaves it out,
   * which also folds the card away.
   */
  tripDetails?: {
    upcomingSteps: readonly Step[];
    destinationLabel: string;
    onAddStop: () => void;
    onShareEta: () => void;
  };
}): React.JSX.Element {
  const { night: isNight, palette } = useNavigationPalette();
  const [expanded, setExpanded] = React.useState(false);
  const open = expanded && Boolean(tripDetails);
  React.useEffect(() => { if (!tripDetails) setExpanded(false); }, [tripDetails]);
  const label = [styles.navigationSummaryLabel, isNight && night.mutedText];
  const value = [styles.navigationSummaryValue, isNight && night.primaryText];
  const divider = [styles.navigationSummaryDivider, isNight && night.divider];
  return (
    <View testID="navigation-summary" style={[styles.navigationSummary, isNight && night.card, { paddingBottom: bottomPadding }]} onLayout={measured(onHeight)}>
      {tripDetails ? (
        <Pressable
          testID="navigation-trip-toggle"
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? 'Hide trip details' : 'Show trip details'}
          hitSlop={{ top: 8, bottom: 8, left: 40, right: 40 }}
          onPress={() => { haptics.select(); setExpanded((value) => !value); }}
          style={styles.navigationSummaryHandleButton}
        >
          <View style={[styles.navigationSummaryHandle, isNight && night.handle]} />
        </Pressable>
      ) : (
        <View style={[styles.navigationSummaryHandle, isNight && night.handle]} />
      )}
      {open && tripDetails ? (
        <View testID="navigation-trip-details" style={styles.navigationTripDetails}>
          <View style={styles.navigationTripActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Add stop" onPress={() => { setExpanded(false); tripDetails.onAddStop(); }} style={({ pressed }) => [styles.navigationTripAction, isNight && night.endButton, pressed && pressedFeedback]}>
              <Ionicons name="add" size={22} color={palette.textPrimary} />
              <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.navigationTripActionText, isNight && night.primaryText]}>Add stop</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Share ETA" onPress={tripDetails.onShareEta} style={({ pressed }) => [styles.navigationTripAction, isNight && night.endButton, pressed && pressedFeedback]}>
              <Ionicons name="share-outline" size={22} color={palette.textPrimary} />
              <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.navigationTripActionText, isNight && night.primaryText]}>Share ETA</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="End navigation from trip details" onPress={() => { haptics.tap(); onEnd(); }} style={({ pressed }) => [styles.navigationTripAction, isNight && night.endButton, pressed && pressedFeedback]}>
              <Ionicons name="close" size={22} color={palette.danger} />
              <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.navigationTripActionText, { color: palette.danger }]}>End</Text>
            </Pressable>
          </View>
          <Text style={[styles.navigationTripHeading, isNight && night.mutedText]} accessibilityRole="header">Turns</Text>
          <ScrollView style={styles.navigationTripTurns} nestedScrollEnabled>
            {tripDetails.upcomingSteps.map((item, index) => (
              <View key={`${index}-${item.instruction}`} style={[styles.navigationTripTurn, index > 0 && styles.navigationTripTurnDivided]}>
                <Text style={[styles.navigationTripTurnText, isNight && night.primaryText]}>{item.instruction}</Text>
                <Text style={[styles.navigationTripTurnDistance, isNight && night.mutedText]}>{formatNavigationDistance(item.distanceMeters, unitSystem)}</Text>
              </View>
            ))}
            <View style={[styles.navigationTripTurn, tripDetails.upcomingSteps.length > 0 && styles.navigationTripTurnDivided]}>
              <Text style={[styles.navigationTripTurnText, styles.navigationTripArrive, isNight && night.primaryText]}>Arrive at {tripDetails.destinationLabel || 'your destination'}</Text>
            </View>
          </ScrollView>
        </View>
      ) : null}
      {routeChoices.length > 1 && onChooseRoute ? (
        <View style={styles.navigationRouteChoices} accessibilityRole="radiogroup" accessibilityLabel="Routes" testID="navigation-route-choices">
          {routeChoices.map((choice) => {
            const selected = choice.index === chosenRouteIndex;
            return (
              <Pressable
                key={choice.index}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={choice.text}
                onPress={() => onChooseRoute(choice.index)}
                style={({ pressed }) => [
                  styles.navigationRouteChoice,
                  isNight && night.card,
                  selected && styles.navigationRouteChoiceSelected,
                  pressed && styles.navigationRouteChoicePressed,
                ]}
              >
                <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} numberOfLines={2} style={[styles.navigationRouteChoiceText, isNight && night.primaryText, selected && styles.navigationRouteChoiceTextSelected]}>
                  {choice.text}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={styles.navigationSummaryContent}>
        <Pressable accessibilityRole="button" accessibilityLabel="End navigation" onPress={() => { haptics.tap(); onEnd(); }} style={({ pressed }) => [styles.navigationEndButton, isNight && night.endButton, pressed && pressedFeedback]}>
          <Ionicons name="close" size={24} color={palette.textPrimary} />
        </Pressable>
        <View style={styles.navigationSummaryPrimary}>
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={[styles.navigationArrival, isNight && night.arrival]}>{arrivalLabel}</Text>
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={label}>arrival</Text>
        </View>
        <View style={divider} />
        <View style={styles.navigationSummaryStat}>
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={value}>{formatNavigationDuration(remainingSeconds)}</Text>
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={label}>left</Text>
          {trafficText ? <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={styles.navigationTraffic} testID="navigation-traffic">{trafficText}</Text> : null}
        </View>
        <View style={divider} />
        <View style={styles.navigationSummaryStat}>
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={value}>{formatNavigationDistance(remainingMeters, unitSystem)}</Text>
          <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={label}>away</Text>
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
  onFindStops,
}: {
  bottom: number;
  canReport: boolean;
  muted: boolean;
  following: boolean;
  onReport: () => void;
  onToggleMute: () => void;
  onOverviewOrFollow: () => void;
  /** Petrol, cafés or food on the way; parked only, like reporting. */
  onFindStops?: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.navigationActions, { bottom }]}>
      {canReport && onFindStops && (
        <Pressable
          style={({ pressed }) => [styles.navigationActionButton, pressed && styles.navigationActionButtonPressed]}
          onPress={onFindStops}
          accessibilityRole="button"
          accessibilityLabel="Find petrol and stops on the way"
        >
          <MaterialCommunityIcons name="gas-station" size={24} color={colors.textPrimary} />
        </Pressable>
      )}
      {canReport && (
        <Pressable
          style={({ pressed }) => [styles.navigationActionButton, pressed && styles.navigationActionButtonPressed]}
          onPress={() => { haptics.tap(); onReport(); }}
          accessibilityRole="button"
          accessibilityLabel="Report on the road"
        >
          <MaterialCommunityIcons name="alert-plus" size={24} color={colors.textPrimary} />
        </Pressable>
      )}
      <Pressable
        style={({ pressed }) => [styles.navigationActionButton, muted && styles.navigationActionButtonActive, pressed && styles.navigationActionButtonPressed]}
        onPress={() => { haptics.select(); onToggleMute(); }}
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

/** Google Maps' Re-centre: shown once the rider has moved the map, where the
 * speedometer sits (PWA: #navRecentreBtn). */
export function NavigationRecentreButton({ bottom, onPress }: { bottom: number; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      testID="navigation-recentre"
      accessibilityRole="button"
      accessibilityLabel="Re-centre"
      accessibilityHint="Keeps the map centred on your ride"
      onPress={onPress}
      style={({ pressed }) => [styles.navigationRecentre, { bottom }, pressed && pressedFeedback]}
    >
      <Ionicons name="navigate" size={20} color={lightColors.guidance} />
      <Text maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE} style={styles.navigationRecentreText}>Re-centre</Text>
    </Pressable>
  );
}
