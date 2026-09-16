import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { VehicleCategory } from '@rider-comms/shared';
import { colors, radii, spacing, type } from '../theme';
import { CuratedRouteBrowser } from '../routes/CuratedRouteBrowser';
import { ScreenHeader } from '../components/ScreenHeader';

const VEHICLE_FILTERS: Array<{ value: VehicleCategory | null; label: string }> = [
  { value: null, label: 'All bikes' },
  { value: 'motorcycle_small', label: '125cc & small' },
  { value: 'motorcycle_large', label: 'Larger bikes' },
  { value: 'scooter', label: 'Scooters' },
];

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function ScenicRoutesScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [vehicleFilter, setVehicleFilter] = React.useState<VehicleCategory | null>(null);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Routes" subtitle="Curated motorbike-first roads across the UK." />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          accessibilityRole="tablist"
        >
          {VEHICLE_FILTERS.map((filter) => (
            <FilterChip
              key={filter.label}
              label={filter.label}
              active={vehicleFilter === filter.value}
              onPress={() => setVehicleFilter(filter.value)}
            />
          ))}
        </ScrollView>

        <CuratedRouteBrowser vehicleFilter={vehicleFilter} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  filterRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.accent },
  chipPressed: { opacity: 0.78 },
  chipText: { ...type.body, color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  chipTextActive: { color: colors.accentText },
});
