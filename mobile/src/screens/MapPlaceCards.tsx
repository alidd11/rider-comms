// The cards that rise from the bottom of the map (PWA: #destinationCard):
// a chosen place with its route, and "You’ve arrived" after a route.
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { NavigationTarget } from '../navigationLinks';
import { formatNavigationDistance, formatNavigationDuration } from '../navigationGuidance';
import type { UnitSystem } from '../settings/SettingsContext';
import { colors, pressedFeedback } from '../theme';
import { styles } from './MapScreen.styles';
import type { NavigationArrival } from './useInAppNavigation';

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
