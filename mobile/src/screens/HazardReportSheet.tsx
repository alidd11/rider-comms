import * as React from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { HazardType } from '@rider-comms/shared';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';

export const HAZARD_TYPE_META: Record<HazardType, { label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; color: string }> = {
  police: { label: 'Police', icon: 'police-badge', color: colors.accent },
  accident: { label: 'Accident', icon: 'car-emergency', color: colors.danger },
  hazard: { label: 'Hazard', icon: 'alert', color: colors.warning },
  road_closure: { label: 'Road closure', icon: 'road-variant', color: colors.danger },
  camera: { label: 'Speed camera', icon: 'camera', color: colors.accent },
};

const HAZARD_TYPE_ORDER: HazardType[] = ['police', 'camera', 'accident', 'hazard', 'road_closure'];

export function HazardReportSheet({
  visible,
  onClose,
  onReport,
}: {
  visible: boolean;
  onClose: () => void;
  onReport: (type: HazardType) => void;
}): React.JSX.Element {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>Report on the road</Text>
          <Text style={styles.subtitle}>Let nearby riders know what's ahead. Reports fade out over time.</Text>
          <View style={styles.grid}>
            {HAZARD_TYPE_ORDER.map((type) => {
              const meta = HAZARD_TYPE_META[type];
              return (
                <Pressable
                  key={type}
                  style={({ pressed }) => [styles.typeButton, elevation.raised, pressed && styles.typeButtonPressed]}
                  onPress={() => onReport(type)}
                >
                  <View style={[styles.typeIconBadge, { backgroundColor: meta.color }]}>
                    <MaterialCommunityIcons name={meta.icon} size={22} color={colors.accentText} />
                  </View>
                  <Text style={styles.typeLabel}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={styles.cancelButton} onPress={onClose}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  handle: { width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  title: { ...type.heading, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { ...type.caption, textAlign: 'center', marginBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.md },
  typeButton: {
    width: '31%',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  typeButtonPressed: { opacity: 0.85 },
  typeIconBadge: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { ...type.caption, color: colors.textPrimary, textAlign: 'center', fontWeight: '700' },
  cancelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    marginTop: spacing.lg,
  },
  cancelText: { ...type.button, color: colors.textMuted },
});
