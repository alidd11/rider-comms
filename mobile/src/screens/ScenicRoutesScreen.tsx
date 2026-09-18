import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, type } from '../theme';
import { CuratedRouteBrowser } from '../routes/CuratedRouteBrowser';
import { ScreenHeader } from '../components/ScreenHeader';
import { RIDE_WINDOWS, type RideWindow, type RiderCoordinate } from '../routes/routeDiscovery';
import type { CuratedRoute } from '../routes/curatedRoutes';
import type { TabParamList } from '../navigation';

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
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const [rideWindow, setRideWindow] = React.useState<RideWindow>('all');
  const [riderLocation, setRiderLocation] = React.useState<RiderCoordinate | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void Location.getForegroundPermissionsAsync().then(async (permission) => {
      if (!permission.granted || cancelled) return;
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) {
          setRiderLocation({ lat: position.coords.latitude, lon: position.coords.longitude });
        }
      } catch {
        // Discovery remains useful in editorial order when a location fix is unavailable.
      }
    });
    return () => { cancelled = true; };
  }, []);

  const guideToStart = React.useCallback((route: CuratedRoute) => {
    navigation.navigate('Map', {
      segment: 'public',
      at: Date.now(),
      lat: route.start.lat,
      lon: route.start.lon,
      label: `${route.name} start`,
    });
  }, [navigation]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title="Routes" subtitle="Pick a ride that fits the time you have." />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          accessibilityRole="tablist"
        >
          {RIDE_WINDOWS.map((filter) => (
            <FilterChip
              key={filter.value}
              label={filter.label}
              active={rideWindow === filter.value}
              onPress={() => setRideWindow(filter.value)}
            />
          ))}
        </ScrollView>

        <CuratedRouteBrowser
          rideWindow={rideWindow}
          riderLocation={riderLocation}
          onGuideToStart={guideToStart}
        />
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
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.accent },
  chipPressed: { opacity: 0.78 },
  chipText: { ...type.body, color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  chipTextActive: { color: colors.accentText },
});
