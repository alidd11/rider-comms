// The cards that rise from the bottom of the map (PWA: #destinationCard):
// a chosen place with its route, the ways there before Start, and
// "You’ve arrived" after a route.
import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
 * where from and to, Back, and Avoid (tolls, ferries); under it the riding
 * styles, as in Calimoto and Scenic. Tapping the destination goes back to
 * search for another.
 */
export function RoutePreviewTopBar({ top, preview, avoidance, replanning = false, onBack, onChangeDestination, onStyle, onToggleAvoid }: {
  top: number;
  preview: RoutePreview;
  /** Settings → Map & navigation's avoid choices, changeable here too. */
  avoidance: RouteAvoidance;
  /** Asking Google again: the chips wait. */
  replanning?: boolean;
  onBack: () => void;
  onChangeDestination: () => void;
  onStyle: (style: RouteStyle) => void;
  onToggleAvoid: (key: 'tolls' | 'ferries') => void;
}): React.JSX.Element {
  const [avoidOpen, setAvoidOpen] = React.useState(false);
  const avoiding = AVOID_CHIPS.filter(({ key }) => avoidance[key]).length;
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
        <Pressable
          testID="route-preview-avoid"
          accessibilityRole="button"
          accessibilityLabel={avoiding ? `Avoid tolls or ferries, ${avoiding} on` : 'Avoid tolls or ferries'}
          accessibilityState={{ expanded: avoidOpen }}
          onPress={() => { haptics.select(); setAvoidOpen((open) => !open); }}
          style={({ pressed }) => [styles.routePreviewAvoidButton, avoidOpen && styles.routePreviewAvoidButtonOpen, pressed && pressedFeedback]}
        >
          <Ionicons name="options-outline" size={21} color={colors.textPrimary} />
          {avoiding ? <Text style={styles.routePreviewAvoidCount}>{avoiding}</Text> : null}
        </Pressable>
      </View>
      {avoidOpen ? (
        <View style={styles.routePreviewAvoidMenu} accessibilityLabel="Avoid">
          {AVOID_CHIPS.map(({ key, label }) => (
            <Pressable
              key={key}
              testID={`route-preview-avoid-${key}`}
              accessibilityRole="switch"
              accessibilityLabel={`Avoid ${label.toLowerCase()}`}
              accessibilityState={{ checked: avoidance[key], disabled: replanning }}
              disabled={replanning}
              onPress={() => { haptics.select(); onToggleAvoid(key); }}
              style={({ pressed }) => [styles.routePreviewChip, avoidance[key] && styles.routePreviewChipOn, pressed && pressedFeedback]}
            >
              <Text style={[styles.routePreviewChipText, avoidance[key] && styles.routePreviewChipTextOn]}>{avoidance[key] ? `✓ ${label}` : label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.routePreviewStyles} accessibilityLabel="How to get there">
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
              onPress={() => { if (!on) { haptics.select(); onStyle(style); } }}
              style={({ pressed }) => [styles.routePreviewStyleChip, on && styles.routePreviewStyleChipOn, replanning && styles.routePreviewBusy, pressed && pressedFeedback]}
            >
              <MaterialCommunityIcons name={icon} size={17} color={on ? colors.background : colors.textPrimary} />
              <Text style={[styles.routePreviewStyleText, on && styles.routePreviewStyleTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * The card for the chosen way before Start (PWA: #routePreview), as in
 * Google Maps: big time (amber when traffic adds to it), distance, arrival,
 * main road and a traffic note, with Start, Steps and Share; in a group ride,
 * who's in it and Share route. It opens up to list every way (a tap chooses
 * one, as on the map) and the turns. Parked only: MapScreen starts the shown
 * route itself if Ride Safe locks.
 */
export function RoutePreviewSheet({ bottom, preview, unitSystem, replanning = false, ride, onChoose, onStart, onShare }: {
  bottom: number;
  preview: RoutePreview;
  unitSystem: UnitSystem;
  /** Asking Google again after a style or avoid change. */
  replanning?: boolean;
  /** In a group ride: up to three riders' avatars and how many there are. */
  ride?: { count: number; avatars: React.ReactNode[] } | null;
  onChoose: (index: number) => void;
  onStart: () => void;
  onShare: () => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const name = preview.target.label ?? 'Selected place';
  const choice = preview.choices.find((item) => item.index === preview.index) ?? preview.choices[0];
  const route = preview.routes[preview.index] ?? preview.routes[0]!;
  const traffic = routeTrafficDelayText(route.durationSeconds, route.typicalDurationSeconds);
  const note = routeTrafficNote(route.durationSeconds, route.typicalDurationSeconds, choice?.label === 'Fastest');
  const others = preview.choices.length - 1;
  const meta = [`Arrive ${arrivalClock(route.durationSeconds)}`, route.summary ? `via ${route.summary}` : ''].filter(Boolean).join(' · ');
  return (
    <View testID="route-preview" style={[styles.routePreviewSheet, { bottom }]} accessibilityViewIsModal>
      <Pressable
        testID="route-preview-handle"
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Show less' : 'Show every route and the turns'}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((open) => !open)}
        style={styles.routePreviewHandle}
      >
        <View style={styles.routePreviewHandleBar} />
      </Pressable>
      <ScrollView style={expanded ? styles.routePreviewScrollOpen : undefined} scrollEnabled={expanded} showsVerticalScrollIndicator={false}>
        <View style={[styles.routePreviewSummary, replanning && styles.routePreviewBusy]} accessibilityLabel={[choice?.text ?? '', formatNavigationDistance(route.distanceMeters, unitSystem), meta, note].filter(Boolean).join(', ')}>
          <Text style={[styles.routePreviewBigTime, traffic ? styles.routePreviewTimeTraffic : null]}>{choice?.time ?? formatNavigationDuration(route.durationSeconds)}</Text>
          <Text style={styles.routePreviewDistance}>{formatNavigationDistance(route.distanceMeters, unitSystem)}</Text>
          {choice && choice.label !== 'Alternative' ? <Text style={styles.routePreviewTagPill}>{choice.label}</Text> : null}
        </View>
        <Text style={styles.routePreviewMetaLine} numberOfLines={1}>{meta}</Text>
        {note ? (
          <View style={styles.routePreviewNote}>
            <Ionicons name="time-outline" size={16} color={traffic ? colors.warning : colors.textSecondary} />
            <Text style={[styles.routePreviewNoteText, traffic ? styles.routePreviewNoteTraffic : null]}>{note}</Text>
          </View>
        ) : null}
        {ride ? (
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
          <Pressable accessibilityRole="button" accessibilityLabel="Steps" onPress={() => setExpanded(true)} style={({ pressed }) => [styles.routePreviewSecondary, pressed && pressedFeedback]}>
            <Ionicons name="list" size={19} color={colors.textPrimary} />
            <Text style={styles.routePreviewSecondaryText}>Steps</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share route" onPress={onShare} style={({ pressed }) => [styles.routePreviewSecondary, styles.routePreviewRound, pressed && pressedFeedback]}>
            <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
          </Pressable>
        </View>
        {others > 0 || expanded ? (
          <Pressable
            testID="route-preview-more"
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((open) => !open)}
            style={styles.routePreviewMore}
          >
            <Text style={styles.routePreviewMoreText}>{expanded ? 'Fewer details' : others === 1 ? '1 other route' : `${others} other routes`}</Text>
            <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={18} color={colors.accentInk} />
          </Pressable>
        ) : null}
        {expanded ? (
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
                return (
                  <Pressable
                    key={item.index}
                    testID={`route-preview-row-${item.index}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={[item.text, arrive.toLowerCase(), distance, via, delay].filter(Boolean).join(', ')}
                    onPress={() => { if (!selected) { haptics.select(); onChoose(item.index); } }}
                    style={({ pressed }) => [styles.routePreviewRow, selected && styles.routePreviewRowSelected, pressed && pressedFeedback]}
                  >
                    <View style={styles.routePreviewRowTop}>
                      <Text style={[styles.routePreviewTime, delay ? styles.routePreviewTimeTraffic : styles.routePreviewTimeClear]}>{item.time}</Text>
                      <Text numberOfLines={1} style={styles.routePreviewTag}>{item.tag.toUpperCase()}</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.routePreviewMeta}>{[arrive, distance, via, delay].filter(Boolean).join(' · ')}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.routePreviewHeading} accessibilityRole="header">{choice && choice.label !== 'Alternative' ? `Steps on the ${choice.label.toLowerCase()}` : 'Steps'}</Text>
            {route.steps.map((step, index) => (
              <View key={`${index}-${step.instruction}`} style={[styles.routePreviewStep, index > 0 && styles.routePreviewStepDivided]}>
                <Text style={styles.routePreviewStepText}>{step.instruction}</Text>
                <Text style={styles.routePreviewStepDistance}>{formatNavigationDistance(step.distanceMeters, unitSystem)}</Text>
              </View>
            ))}
            <View style={[styles.routePreviewStep, route.steps.length > 0 && styles.routePreviewStepDivided]}>
              <Text style={[styles.routePreviewStepText, styles.routePreviewStepArrive]}>{`Arrive at ${name}`}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
