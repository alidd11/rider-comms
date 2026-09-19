import * as React from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HazardType } from '@rider-comms/shared';
import { colors, spacing, radii, type } from '../theme';

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
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Report on the road</Text>
              <Text style={styles.subtitle}>Let nearby riders know what's ahead. Reports fade out over time.</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close report sheet">
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.grid}>
            {HAZARD_TYPE_ORDER.map((type) => {
              const meta = HAZARD_TYPE_META[type];
              return (
                <Pressable
                  key={type}
                  style={({ pressed }) => [styles.typeButton, pressed && styles.typeButtonPressed]}
                  onPress={() => onReport(type)}
                >
                  <View style={[styles.typeIconBadge, { borderColor: meta.color }]}>
                    <MaterialCommunityIcons name={meta.icon} size={24} color={meta.color} />
                  </View>
                  <Text style={styles.typeLabel}>{meta.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: colors.border,
  },
  handle: { width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.lg },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { ...type.heading, textAlign: 'left', marginBottom: spacing.xs },
  subtitle: { ...type.caption, textAlign: 'left', lineHeight: 19 },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: spacing.sm, rowGap: spacing.sm },
  typeButton: {
    width: '31%',
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  typeButtonPressed: { opacity: 0.82 },
  typeIconBadge: { width: 38, height: 38, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  typeLabel: { ...type.caption, color: colors.textSecondary, textAlign: 'center', fontWeight: '700' },
});
