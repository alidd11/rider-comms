import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HazardReport } from '@rider-comms/shared';
import { Ionicons } from '@expo/vector-icons';
import { colors, elevation, MIN_TOUCH_TARGET, spacing, type } from '../theme';
import { HazardMarkerIcon } from './HazardIcon';
import { HAZARD_TYPE_META } from '../screens/HazardReportSheet';

export function hazardAgeLabel(timestampMs: number, nowMs = Date.now()): string {
  const minutes = Math.max(0, Math.round((nowMs - timestampMs) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function HazardDetailCard({
  hazard,
  bottomInset,
  onDismiss,
  onVote,
}: {
  hazard: HazardReport;
  bottomInset: number;
  onDismiss: () => void;
  onVote: (hazardId: string, direction: 'confirm' | 'deny') => void | Promise<void>;
}): React.JSX.Element {
  const meta = HAZARD_TYPE_META[hazard.type];
  return (
    <View
      style={[styles.card, { bottom: bottomInset }]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${meta.label}. Reported ${hazardAgeLabel(hazard.createdAt)}.`}
    >
      <View style={styles.head}>
        <View style={styles.icon}>
          <HazardMarkerIcon type={hazard.type} size={32} selected />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.title}>{meta.label}</Text>
          <Text numberOfLines={1} style={styles.meta}>Reported {hazardAgeLabel(hazard.createdAt)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss road report"
          hitSlop={4}
          style={({ pressed }) => [styles.dismiss, pressed && styles.dismissPressed]}
          onPress={onDismiss}
        >
          <Ionicons name="close" size={19} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Still there, ${hazard.confirmations} confirmations`}
          style={({ pressed }) => [styles.voteButton, pressed && styles.votePressed]}
          onPress={() => void onVote(hazard.id, 'confirm')}
        >
          <Text style={styles.voteLabel}>Still there</Text>
          <View style={[styles.count, styles.confirmCount]}>
            <Text style={[styles.countText, { color: colors.accent }]}>{hazard.confirmations}</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Gone, ${hazard.denials} reports`}
          style={({ pressed }) => [styles.voteButton, pressed && styles.votePressed]}
          onPress={() => void onVote(hazard.id, 'deny')}
        >
          <Text style={styles.voteLabel}>Gone</Text>
          <View style={[styles.count, styles.denyCount]}>
            <Text style={[styles.countText, { color: colors.danger }]}>{hazard.denials}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 11,
    gap: 10,
    padding: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    ...elevation.raised,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.accentSoft,
  },
  copy: { minWidth: 0, flex: 1 },
  title: { ...type.subheading, color: colors.textPrimary, fontWeight: '800' },
  meta: { ...type.caption, color: colors.textSecondary, marginTop: 1 },
  dismiss: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  dismissPressed: { backgroundColor: colors.surfaceRaised },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  voteButton: {
    minWidth: 0,
    minHeight: MIN_TOUCH_TARGET,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  votePressed: { opacity: 0.78 },
  voteLabel: { ...type.caption, color: colors.textPrimary, fontWeight: '800' },
  count: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  confirmCount: { backgroundColor: colors.accentSoft },
  denyCount: { backgroundColor: colors.dangerSurface },
  countText: { ...type.caption, color: colors.textSecondary, fontWeight: '800', lineHeight: 17 },
});
