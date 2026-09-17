import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radii, type } from '../theme';
import { useMovementSafety } from './MovementSafetyContext';

export function RideSafeSurface(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { movementState } = useMovementSafety();
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
});
