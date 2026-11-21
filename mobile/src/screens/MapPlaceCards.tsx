// The cards that rise from the bottom of the map (PWA: #destinationCard):
// a chosen place with its route, the ways there before Start, and
// "You’ve arrived" after a route.
import * as React from 'react';
import { PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { NavigationTarget } from '../navigationLinks';
import { formatNavigationDistance, formatNavigationDuration } from '../navigationGuidance';
import type { UnitSystem } from '../settings/SettingsContext';
import { colors, pressedFeedback } from '../theme';
import { haptics } from '../haptics';
import { routeTrafficDelayText, routeTrafficNote, type RouteStyle } from '@rider-comms/shared';
import { styles } from './MapScreen.styles';
import type { NavigationArrival, RoutePreview } from './useInAppNavigation';
import type { RouteAvoidance } from '../routeOptionsPreference';
import type { HazardReport } from '@rider-comms/shared';
import { routeHazardStrip, routeHazards, routeHazardsSummary, type RouteHazardMarker } from '../navigationRoadEvents';
import { HazardNavigationIcon } from '../components/HazardIcon';

export function ArrivalCard({ bottom, arrival, unitSystem, onDone }: {
  bottom: number;
  arrival: NavigationArrival;
  unitSystem: UnitSystem;
  onDone: () => void;
}): React.JSX.Element {
  return (
    <View testID="navigation-arrival" style={[styles.destinationCard, { bottom }]} accessibilityLiveRegion="polite">
      <View style={styles.destinationCardHead}>
        <View style={styles.destinationCardIcon}>
          <MaterialCommunityIcons name="flag-checkered" size={20} color={colors.accent} />
        </View>
        <View style={styles.destinationCardCopy}>
          <Text style={styles.destinationCardTitle}>You’ve arrived</Text>
          {arrival.label ? (
            <Text numberOfLines={2} style={styles.destinationCardCoords}>{arrival.label}</Text>
          ) : null}
        </View>
      </View>
      <Text style={styles.arrivalStats}>
        {`${formatNavigationDuration(arrival.seconds)} · ${formatNavigationDistance(arrival.distanceMeters, unitSystem)}`}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.destinationPrimaryAction, pressed && pressedFeedback]}
        accessibilityRole="button"
        onPress={onDone}
      >
        <Text style={styles.destinationPrimaryTitle}>Done</Text>
      </Pressable>
    </View>
  );
}

export function DestinationCard({
  bottom,
  destination,
  subtitle,
  isRegroup,
  eta,
  unitSystem,
  providerLabel,
  loading,
  isHost,
  regroupSaving,
  regroupError,
  onDismiss,
  onStartRoute,
  onToggleRegroup,
}: {
  bottom: number;
  destination: NavigationTarget;
  subtitle: string;
  isRegroup: boolean;
  eta: { distanceMeters: number; durationSeconds: number } | null;
  unitSystem: UnitSystem;
  providerLabel: string;
  loading: boolean;
  /** The ride host gets "Regroup here" / "Clear regroup point". */
  isHost: boolean;
  regroupSaving: boolean;
  regroupError: boolean;
  onDismiss: () => void;
  onStartRoute: () => void;
  onToggleRegroup: () => void;
}): React.JSX.Element {
  const name = destination.label ?? 'Selected place';
  return (
    <View style={[styles.destinationCard, { bottom }]} accessibilityLiveRegion="polite">
      <View style={styles.destinationCardHead}>
        <View style={styles.destinationCardIcon}>
          <Ionicons name={isRegroup ? 'flag' : 'location'} size={20} color={colors.accent} />
        </View>
        <View style={styles.destinationCardCopy}>
          <Text numberOfLines={2} style={styles.destinationCardTitle}>{name}</Text>
          <Text numberOfLines={2} style={styles.destinationCardCoords}>{subtitle}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss destination"
          style={({ pressed }) => [styles.destinationCardDismiss, pressed && pressedFeedback]}
          onPress={onDismiss}
        >
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.destinationCardEta}>
        <Ionicons name="map-outline" size={15} color={colors.accent} />
        <Text style={styles.destinationCardEtaText}>
          {eta
            ? `${formatNavigationDistance(eta.distanceMeters, unitSystem)} · ${formatNavigationDuration(eta.durationSeconds)}`
            : 'Calculating route…'}
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.destinationPrimaryAction, pressed && pressedFeedback]}
        accessibilityRole="button"
        accessibilityLabel={loading
          ? `Starting route to ${destination.label ?? 'selected place'}`
          : `Start route to ${destination.label ?? 'selected place'}`}
        accessibilityState={{ disabled: loading, busy: loading }}
        onPress={onStartRoute}
        disabled={loading}
      >
        <Ionicons name="navigate" size={18} color={colors.accentText} />
        <View>
          <Text style={styles.destinationPrimaryTitle}>{loading ? 'Starting…' : 'Start route'}</Text>
          <Text style={styles.destinationPrimarySubtitle}>{providerLabel}</Text>
        </View>
      </Pressable>
      {isHost ? (
        <Pressable
          testID="regroup-action"
          style={({ pressed }) => [styles.destinationSecondaryAction, pressed && pressedFeedback]}
          accessibilityRole="button"
          accessibilityLabel={isRegroup ? 'Clear the regroup point' : `Ask the group to regroup at ${destination.label ?? 'this place'}`}
          accessibilityState={{ disabled: regroupSaving, busy: regroupSaving }}
          disabled={regroupSaving}
          onPress={onToggleRegroup}
        >
          <Ionicons name={isRegroup ? 'close' : 'flag'} size={18} color={colors.textPrimary} />
          <Text style={styles.destinationSecondaryTitle}>{isRegroup ? 'Clear regroup point' : 'Regroup here'}</Text>
        </Pressable>
      ) : null}
      {isHost && regroupError ? (
        <Text style={styles.destinationActionError} accessibilityLiveRegion="polite">
          Couldn’t reach Rider Comms. Check your connection and try again.
        </Text>
      ) : null}
    </View>
  );
}

function arrivalClock(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const STYLE_CHIPS: ReadonlyArray<{ style: RouteStyle; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }> = [
  { style: 'fastest', label: 'Fastest', icon: 'lightning-bolt-outline' },
  { style: 'twisty', label: 'Twisty', icon: 'chart-bell-curve-cumulative' },
  { style: 'no_motorways', label: 'No motorways', icon: 'cancel' },
];

const AVOID_CHIPS: ReadonlyArray<{ key: 'tolls' | 'ferries'; label: string }> = [
  { key: 'tolls', label: 'Tolls' },
  { key: 'ferries', label: 'Ferries' },
];

/**
 * The top of the route preview (PWA: #routePreviewTop), as in Google Maps:
 * where from and to, Back, and Route options: how to get there (Fastest,
 * Twisty, No motorways, as in Calimoto and Scenic) and Avoid (tolls,
 * ferries). Tapping the destination goes back to search for another.
 */
export function RoutePreviewTopBar({ top, preview, avoidance, replanning = false, onBack, onChangeDestination, onStyle, onToggleAvoid, onAddStop }: {
  top: number;
  preview: RoutePreview;
  /** Settings → Map & navigation's avoid choices, changeable here too. */
  avoidance: RouteAvoidance;
  /** Asking Google again: the options wait. */
  replanning?: boolean;
  onBack: () => void;
  onChangeDestination: () => void;
  onStyle: (style: RouteStyle) => void;
  onToggleAvoid: (key: 'tolls' | 'ferries') => void;
  /** Petrol, a café or food on the way (StopsOnTheWaySheet); one stop. */
  onAddStop?: () => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const avoiding = AVOID_CHIPS.filter(({ key }) => avoidance[key]).length;
  // The button counts what's changed from the plain fastest way.
  const changed = avoiding + (preview.style === 'fastest' ? 0 : 1);
  const styleName = STYLE_CHIPS.find(({ style }) => style === preview.style)?.label ?? 'Fastest';
  return (
    <View testID="route-preview-top" style={[styles.routePreviewTop, { top }]}>
      <View style={styles.routePreviewBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to the place" onPress={onBack} hitSlop={6} style={({ pressed }) => [styles.routePreviewBack, pressed && pressedFeedback]}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.routePreviewEnds}>
          <View style={styles.routePreviewEndRow}>
            <View style={styles.routePreviewDotFrom} />
            <Text style={[styles.routePreviewField, styles.routePreviewFieldMuted]} numberOfLines={1}>Your location</Text>
          </View>
          <View style={styles.routePreviewEndRow}>
            <Ionicons name="location" size={16} color="#E5484D" style={styles.routePreviewPin} />
            <Pressable accessibilityRole="button" accessibilityLabel={`Change destination, now ${preview.target.label ?? 'selected place'}`} onPress={onChangeDestination} style={({ pressed }) => [styles.routePreviewFieldButton, pressed && pressedFeedback]}>
              <Text style={styles.routePreviewField} numberOfLines={1}>{preview.target.label ?? 'Selected place'}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.routePreviewTools}>
          {onAddStop && !preview.stop ? (
            <Pressable
              testID="route-preview-add-stop"
              accessibilityRole="button"
              accessibilityLabel="Add a stop"
              accessibilityHint="Petrol, cafés or food on the way"
              accessibilityState={{ disabled: replanning }}
              disabled={replanning}
              onPress={() => { haptics.select(); onAddStop(); }}
              style={({ pressed }) => [styles.routePreviewAvoidButton, replanning && styles.routePreviewBusy, pressed && pressedFeedback]}
            >
              <Ionicons name="add" size={24} color={colors.textPrimary} />
            </Pressable>
          ) : null}
          <Pressable
            testID="route-preview-options"
            accessibilityRole="button"
            accessibilityLabel={`Route options, ${styleName}${avoiding ? ', avoiding tolls or ferries' : ''}`}
            accessibilityState={{ expanded: open }}
            onPress={() => { haptics.select(); setOpen((value) => !value); }}
            style={({ pressed }) => [styles.routePreviewAvoidButton, open && styles.routePreviewAvoidButtonOpen, pressed && pressedFeedback]}
          >
            <Ionicons name="options-outline" size={21} color={colors.textPrimary} />
            {changed ? <Text style={styles.routePreviewAvoidCount}>{changed}</Text> : null}
          </Pressable>
        </View>
      </View>
      {open ? (
        <View testID="route-preview-options-menu" style={[styles.routePreviewOptions, replanning && styles.routePreviewBusy]} accessibilityLabel="Route options">
          <Text style={styles.routePreviewOptionsTitle}>How to get there</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="How to get there" style={styles.routePreviewOptionsList}>
            {STYLE_CHIPS.map(({ style, label, icon }) => {
              const on = preview.style === style;
              return (
                <Pressable
                  key={style}
                  testID={`route-preview-style-${style}`}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: on, disabled: replanning }}
                  disabled={replanning}
                  onPress={() => {
                    if (on) return;
                    haptics.select();
                    setOpen(false);
                    onStyle(style);
                  }}
                  style={({ pressed }) => [styles.routePreviewOption, on && styles.routePreviewOptionOn, pressed && pressedFeedback]}
                >
                  <MaterialCommunityIcons name={icon} size={18} color={on ? colors.accentInk : colors.textPrimary} />
                  <Text style={[styles.routePreviewOptionText, on && styles.routePreviewOptionTextOn]}>{label}</Text>
                  {on ? <Ionicons name="checkmark" size={18} color={colors.accentInk} style={styles.routePreviewOptionCheck} /> : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.routePreviewOptionsTitle}>Avoid</Text>
          <View style={styles.routePreviewAvoidRow} accessibilityLabel="Avoid">
            {AVOID_CHIPS.map(({ key, label }) => (
              <Pressable
                key={key}
                testID={`route-preview-avoid-${key}`}
                accessibilityRole="switch"
                accessibilityLabel={`Avoid ${label.toLowerCase()}`}
                accessibilityState={{ checked: avoidance[key], disabled: replanning }}
                disabled={replanning}
                onPress={() => { haptics.select(); onToggleAvoid(key); }}
                style={({ pressed }) => [styles.routePreviewChip, styles.routePreviewAvoidChip, avoidance[key] && styles.routePreviewChipOn, pressed && pressedFeedback]}
              >
                <Text style={[styles.routePreviewChipText, avoidance[key] && styles.routePreviewChipTextOn]}>{avoidance[key] ? `✓ ${label}` : label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const ROUTE_HAZARD_CHIPS_SHOWN = 4;

/**
 * The reports on one of the other ways, small, under its row: the map pins'
 * glyphs, one per kind with how many, four at most then +N. The row reads
 * them out (PWA: routeHazardChipsMarkup).
 */
function RouteHazardChips({ summary }: { summary: NonNullable<ReturnType<typeof routeHazardsSummary>> }): React.JSX.Element {
  const more = summary.groups.length - ROUTE_HAZARD_CHIPS_SHOWN;
  return (
    <View style={[styles.routeHazardChips, styles.routePreviewRowHazards]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {summary.groups.slice(0, ROUTE_HAZARD_CHIPS_SHOWN).map(({ type, count, serious }) => (
        <View key={type} testID={`route-hazard-${type}`} style={[styles.routeHazardChip, serious && styles.routeHazardChipSerious]}>
          <HazardNavigationIcon type={type} size={18} />
          {count > 1 ? <Text style={styles.routeHazardChipCount}>{count}</Text> : null}
        </View>
      ))}
      {more > 0 ? (
        <View style={styles.routeHazardChip}>
          <Text style={[styles.routeHazardChipCount, styles.routeHazardChipMore]}>{`+${more}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The chosen way as a straight line from you to the destination with each
 * report where it is on it, as in Waze's trip overview; close ones share an
 * icon with a count, closures and accidents ringed red. Read out as one
 * sentence (PWA: routeHazardStripMarkup).
 */
function RouteHazardStrip({ markers, label, testID }: { markers: readonly RouteHazardMarker[]; label: string; testID?: string }): React.JSX.Element {
  return (
    <View testID={testID} style={styles.routeHazardStrip} accessible accessibilityRole="image" accessibilityLabel={label}>
      <View style={styles.routeHazardStripLine} />
      <View style={[styles.routeHazardStripEnd, styles.routeHazardStripStart]} />
      <View style={[styles.routeHazardStripEnd, styles.routeHazardStripDestination]} />
      <View style={styles.routeHazardStripTrack}>
        {markers.map(({ at, type, count, serious }) => (
          <View
            key={`${type}-${at}`}
            testID={`route-hazard-marker-${type}`}
            style={[styles.routeHazardMarker, serious && styles.routeHazardChipSerious, { left: `${Math.round(at * 1000) / 10}%` }]}
          >
            <HazardNavigationIcon type={type} size={24} />
            {count > 1 ? <Text style={styles.routeHazardMarkerCount}>{count}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

type SheetSize = 'min' | 'peek' | 'list';

/**
 * The card for the chosen way before Start (PWA: #routePreview), as in
 * Google Maps: big time (amber when traffic adds to it), distance, arrival,
 * main road and a traffic note, with Start and Share; in a group ride, who's
 * in it and Share route. Three sizes, swiped between or stepped with the
 * handle: small (time and Start), the chosen way, and every way (a tap
 * chooses one, as on the map). Parked only: MapScreen starts the shown route
 * itself if Ride Safe locks.
 */
export function RoutePreviewSheet({ bottom, preview, unitSystem, replanning = false, ride, hazards = [], onChoose, onStart, onShare, onRemoveStop }: {
  bottom: number;
  preview: RoutePreview;
  unitSystem: UnitSystem;
  /** Asking Google again after a style or avoid change. */
  replanning?: boolean;
  /** In a group ride: up to three riders' avatars and how many there are. */
  ride?: { count: number; avatars: React.ReactNode[] } | null;
  /** Riders' hazard reports: each way says what's been reported on it. */
  hazards?: readonly HazardReport[];
  onChoose: (index: number) => void;
  onStart: () => void;
  onShare: () => void;
  /** Takes out the stop added from the top bar's Add a stop. */
  onRemoveStop?: () => void;
}): React.JSX.Element {
  const [size, setSize] = React.useState<SheetSize>('peek');
  // The arrival time moves on while the card is open, as in Google Maps.
  const [, setClock] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setClock((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const name = preview.target.label ?? 'Selected place';
  const choice = preview.choices.find((item) => item.index === preview.index) ?? preview.choices[0];
  const route = preview.routes[preview.index] ?? preview.routes[0]!;
  const traffic = routeTrafficDelayText(route.durationSeconds, route.typicalDurationSeconds);
  // Twisty asked for, but the bendiest way Google had is also the quickest
  // (often so in town): say so, rather than seem to ignore it.
  const twistyIsFastest = preview.style === 'twisty' && choice?.label === 'Fastest';
  const note = twistyIsFastest
    ? 'Also the twistiest way Google found'
    : routeTrafficNote(route.durationSeconds, route.typicalDurationSeconds, choice?.label === 'Fastest');
  // What riders have reported on each way (PWA: routeHazards).
  const reported = React.useMemo(
    () => preview.routes.map((way) => routeHazards(way.coordinates, hazards)),
    [preview.routes, hazards],
  );
  const summaries = React.useMemo(() => reported.map(routeHazardsSummary), [reported]);
  const hazardSummary = summaries[preview.index] ?? null;
  const hazardMarkers = React.useMemo(
    () => routeHazardStrip(reported[preview.index] ?? [], preview.routes[preview.index]?.coordinates ?? []),
    [preview.index, preview.routes, reported],
  );
  const others = preview.choices.length - 1;
  const sizes: SheetSize[] = others > 0 ? ['min', 'peek', 'list'] : ['min', 'peek'];
  const step = React.useCallback((direction: 1 | -1) => {
    setSize((current) => {
      const at = Math.max(0, sizes.indexOf(current));
      const next = sizes[Math.min(sizes.length - 1, Math.max(0, at + direction))]!;
      if (next !== current) haptics.select();
      return next;
    });
  // sizes changes only with the number of ways.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others > 0]);
  // Swipe down to make the card smaller, up to make it bigger.
  const pan = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 12 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dy) >= 40) step(gesture.dy > 0 ? -1 : 1);
    },
  }), [step]);
  const meta = [`Arrive ${arrivalClock(route.durationSeconds)}`, route.summary ? `via ${route.summary}` : ''].filter(Boolean).join(' · ');
  const small = size === 'min';
  return (
    <View testID="route-preview" style={[styles.routePreviewSheet, { bottom }]} accessibilityViewIsModal>
      <View {...pan.panHandlers} testID="route-preview-drag">
        <Pressable
          testID="route-preview-handle"
          accessibilityRole="button"
          accessibilityLabel={small ? 'Show the route details' : size === 'list' ? 'Hide the other routes' : others ? 'Show the other routes' : 'Make the card smaller'}
          onPress={() => setSize(small ? 'peek' : size === 'list' ? 'peek' : others ? 'list' : 'min')}
          style={styles.routePreviewHandle}
        >
          <View style={styles.routePreviewHandleBar} />
        </Pressable>
        <View style={[styles.routePreviewSummary, replanning && styles.routePreviewBusy]} accessibilityLabel={[choice?.text ?? '', formatNavigationDistance(route.distanceMeters, unitSystem), meta, note, hazardSummary?.label ?? ''].filter(Boolean).join(', ')}>
          <Text style={[styles.routePreviewBigTime, traffic ? styles.routePreviewTimeTraffic : null]}>{choice?.time ?? formatNavigationDuration(route.durationSeconds)}</Text>
          <Text style={styles.routePreviewDistance}>{formatNavigationDistance(route.distanceMeters, unitSystem)}</Text>
          {choice && choice.label !== 'Alternative' ? <Text style={styles.routePreviewTagPill}>{choice.label}</Text> : null}
        </View>
        {small ? null : (
          <>
            <Text style={styles.routePreviewMetaLine} numberOfLines={1}>{meta}</Text>
            {note ? (
              <View style={styles.routePreviewNote}>
                <Ionicons name={twistyIsFastest ? 'information-circle-outline' : 'time-outline'} size={16} color={traffic && !twistyIsFastest ? colors.warning : colors.textSecondary} />
                <Text style={[styles.routePreviewNoteText, traffic && !twistyIsFastest ? styles.routePreviewNoteTraffic : null]}>{note}</Text>
              </View>
            ) : null}
            {hazardSummary ? (
              <RouteHazardStrip testID="route-preview-hazards" markers={hazardMarkers} label={hazardSummary.label} />
            ) : null}
          </>
        )}
      </View>
      <ScrollView style={size === 'list' ? styles.routePreviewScrollOpen : undefined} scrollEnabled={size === 'list'} showsVerticalScrollIndicator={false}>
        {preview.stop && !small ? (
          <View testID="route-preview-stop" style={styles.routePreviewRide}>
            <Ionicons name="flag-outline" size={18} color={colors.accentInk} />
            <Text style={styles.routePreviewRideText} numberOfLines={1}>{`Stop: ${preview.stop.label}`}</Text>
            {onRemoveStop ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove the stop at ${preview.stop.label}`} accessibilityState={{ disabled: replanning }} disabled={replanning} onPress={() => { haptics.select(); onRemoveStop(); }} hitSlop={6} style={({ pressed }) => [styles.routePreviewRideShare, pressed && pressedFeedback]}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {ride && !small ? (
          <View testID="route-preview-ride" style={styles.routePreviewRide}>
            <View style={styles.routePreviewRideAvatars}>{ride.avatars}</View>
            <Text style={styles.routePreviewRideText}>{`Group ride · ${ride.count} ${ride.count === 1 ? 'rider' : 'riders'}`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Share route with the group" onPress={onShare} hitSlop={6} style={({ pressed }) => [styles.routePreviewRideShare, pressed && pressedFeedback]}>
              <Text style={styles.routePreviewRideShareText}>Share route</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.routePreviewActions}>
          <Pressable
            testID="route-preview-start"
            style={({ pressed }) => [styles.routePreviewStart, replanning && styles.routePreviewBusy, pressed && pressedFeedback]}
            accessibilityRole="button"
            accessibilityLabel={`Start route to ${name}`}
            accessibilityState={{ disabled: replanning }}
            disabled={replanning}
            onPress={() => { haptics.tap(); onStart(); }}
          >
            <Ionicons name="navigate" size={19} color={colors.accentText} />
            <Text style={styles.routePreviewStartText}>Start</Text>
          </Pressable>
          {small ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel="Share route" onPress={onShare} style={({ pressed }) => [styles.routePreviewSecondary, styles.routePreviewRound, pressed && pressedFeedback]}>
              <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
            </Pressable>
          )}
        </View>
        {others > 0 && !small ? (
          <Pressable
            testID="route-preview-more"
            accessibilityRole="button"
            accessibilityState={{ expanded: size === 'list' }}
            onPress={() => setSize(size === 'list' ? 'peek' : 'list')}
            style={styles.routePreviewMore}
          >
            <Text style={styles.routePreviewMoreText}>{size === 'list' ? 'Hide other routes' : others === 1 ? '1 other route' : `${others} other routes`}</Text>
            <Ionicons name={size === 'list' ? 'chevron-down' : 'chevron-up'} size={18} color={colors.accentInk} />
          </Pressable>
        ) : null}
        {size === 'list' ? (
          <View testID="route-preview-details">
            <Text style={styles.routePreviewHeading} accessibilityRole="header">Routes</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Routes" style={styles.routePreviewList}>
              {preview.choices.map((item) => {
                const way = preview.routes[item.index]!;
                const selected = item.index === preview.index;
                const arrive = `Arrive ${arrivalClock(way.durationSeconds)}`;
                const distance = formatNavigationDistance(way.distanceMeters, unitSystem);
                const via = way.summary ? `via ${way.summary}` : '';
                const delay = routeTrafficDelayText(way.durationSeconds, way.typicalDurationSeconds);
                const hazardsOnWay = summaries[item.index] ?? null;
                return (
                  <Pressable
                    key={item.index}
                    testID={`route-preview-row-${item.index}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={[item.text, arrive.toLowerCase(), distance, via, delay, hazardsOnWay?.label.toLowerCase() ?? ''].filter(Boolean).join(', ')}
                    onPress={() => { if (!selected) { haptics.select(); onChoose(item.index); } }}
                    style={({ pressed }) => [styles.routePreviewRow, selected && styles.routePreviewRowSelected, pressed && pressedFeedback]}
                  >
                    <View style={styles.routePreviewRowTop}>
                      <Text style={[styles.routePreviewTime, delay ? styles.routePreviewTimeTraffic : styles.routePreviewTimeClear]}>{item.time}</Text>
                      <Text numberOfLines={1} style={styles.routePreviewTag}>{item.tag.toUpperCase()}</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.routePreviewMeta}>{[arrive, distance, via, delay].filter(Boolean).join(' · ')}</Text>
                    {hazardsOnWay ? <RouteHazardChips summary={hazardsOnWay} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
