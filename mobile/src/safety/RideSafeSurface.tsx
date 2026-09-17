import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radii, type } from '../theme';
import { useMovementSafety } from './MovementSafetyContext';

export function RideSafeSurface(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { movementState, locationAccess, trackingError, requestLocationAccess, openLocationSettings } = useMovementSafety();
  const needsSettings = locationAccess === 'blocked' || locationAccess === 'services_disabled';
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.icon}>
        <MaterialCommunityIcons name="motorbike" size={42} color={colors.accent} />
      </View>
      <Text style={styles.title}>Controls locked while riding</Text>
      <Text style={styles.body}>
        {movementState === 'moving'
          ? 'Keep your eyes on the road. These controls unlock after you have safely stopped.'
          : 'Rider Comms cannot confirm that you are stationary. Open the Map and enable location, or stop safely and wait for a reliable fix.'}
      </Text>
      <View style={styles.status} accessibilityLiveRegion="polite">
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>{movementState === 'moving' ? 'Movement detected' : 'Movement status unavailable'}</Text>
      </View>
      {movementState !== 'moving' && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={needsSettings ? 'Open location settings' : 'Enable location'}
          style={({ pressed }) => [styles.enableButton, pressed && styles.enableButtonPressed]}
          onPress={() => void (needsSettings ? openLocationSettings() : requestLocationAccess())}
        >
          <MaterialCommunityIcons name={needsSettings ? 'cog-outline' : 'crosshairs-gps'} size={20} color={colors.accentText} />
          <Text style={styles.enableButtonText}>{needsSettings ? 'Open location settings' : 'Enable location'}</Text>
        </Pressable>
      )}
      {trackingError && <Text style={styles.errorText} accessibilityLiveRegion="polite">{trackingError}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.background,
  },
  icon: {
    width: 88,
    height: 88,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  title: { ...type.title, color: colors.textPrimary, textAlign: 'center' },
  body: { ...type.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, maxWidth: 420 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  statusText: { ...type.caption, color: colors.textPrimary, fontWeight: '700' },
  enableButton: { minHeight: 48, marginTop: spacing.lg, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.pill, backgroundColor: colors.accent },
  enableButtonPressed: { opacity: 0.82 },
  enableButtonText: { ...type.button, color: colors.accentText },
  errorText: { ...type.caption, color: colors.danger, textAlign: 'center', marginTop: spacing.sm, maxWidth: 420 },
});
