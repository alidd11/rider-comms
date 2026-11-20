// The cards that rise from the bottom of the map (PWA: #destinationCard):
// a chosen place with its route, the ways there before Start, and
// "You’ve arrived" after a route.
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { NavigationTarget } from '../navigationLinks';
import { formatNavigationDistance, formatNavigationDuration } from '../navigationGuidance';
import type { UnitSystem } from '../settings/SettingsContext';
import { colors, pressedFeedback } from '../theme';
import { haptics } from '../haptics';
import { routeTrafficDelayText } from '@rider-comms/shared';
import { styles } from './MapScreen.styles';
import type { NavigationArrival, RoutePreview } from './useInAppNavigation';

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

/**
 * The ways there before Start, as in Google Maps and Waze (PWA:
 * #routePreview): one row per route with its time, tag (Fastest, Twisty,
 * +6 min), arrival, distance and main road; the map draws them all, and a
 * tap on a row or a line chooses it. Parked only: MapScreen starts the
 * shown route itself if Ride Safe locks.
 */
export function RoutePreviewSheet({ bottom, preview, unitSystem, onChoose, onStart, onClose }: {
  bottom: number;
  preview: RoutePreview;
  unitSystem: UnitSystem;
  onChoose: (index: number) => void;
  onStart: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const name = preview.target.label ?? 'Selected place';
  return (
    <View testID="route-preview" style={[styles.destinationCard, { bottom }]} accessibilityViewIsModal>
      <View style={styles.destinationCardHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the place"
          style={({ pressed }) => [styles.destinationCardDismiss, pressed && pressedFeedback]}
          onPress={onClose}
        >
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.destinationCardCopy}>
          <Text style={styles.destinationCardCoords}>Route to</Text>
          <Text numberOfLines={1} accessibilityRole="header" style={styles.destinationCardTitle}>{name}</Text>
        </View>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Routes" style={styles.routePreviewList}>
        {preview.choices.map((choice) => {
          const route = preview.routes[choice.index]!;
          const selected = choice.index === preview.index;
          const arrive = `Arrive ${arrivalClock(route.durationSeconds)}`;
          const distance = formatNavigationDistance(route.distanceMeters, unitSystem);
          const via = route.summary ? `via ${route.summary}` : '';
          const traffic = routeTrafficDelayText(route.durationSeconds, route.typicalDurationSeconds);
          const tag = [choice.tag, traffic].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={choice.index}
              testID={`route-preview-row-${choice.index}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={[choice.text, arrive.toLowerCase(), distance, via, traffic].filter(Boolean).join(', ')}
              onPress={() => { if (!selected) { haptics.select(); onChoose(choice.index); } }}
              style={({ pressed }) => [styles.routePreviewRow, selected && styles.routePreviewRowSelected, pressed && pressedFeedback]}
            >
              <View style={styles.routePreviewRowTop}>
                <Text style={styles.routePreviewTime}>{choice.time}</Text>
                <Text numberOfLines={1} style={styles.routePreviewTag}>{tag}</Text>
              </View>
              <Text numberOfLines={1} style={styles.routePreviewMeta}>{[arrive, distance, via].filter(Boolean).join(' · ')}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        testID="route-preview-start"
        style={({ pressed }) => [styles.destinationPrimaryAction, pressed && pressedFeedback]}
        accessibilityRole="button"
        accessibilityLabel={`Start route to ${name}`}
        onPress={() => { haptics.tap(); onStart(); }}
      >
        <Ionicons name="navigate" size={18} color={colors.accentText} />
        <Text style={styles.destinationPrimaryTitle}>Start</Text>
      </Pressable>
    </View>
  );
}
