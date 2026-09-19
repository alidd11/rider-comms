import * as React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, type } from '../theme';
import { CuratedRouteBrowser } from '../routes/CuratedRouteBrowser';
import { ScreenHeader } from '../components/ScreenHeader';
import { RIDE_WINDOWS, type RideWindow, type RiderCoordinate } from '../routes/routeDiscovery';
import type { CuratedRoute } from '../routes/curatedRoutes';
import type { TabParamList } from '../navigation';

export type RouteCategory = 'all' | 'scenic' | 'mountain' | 'coastal' | 'near';

const ROUTE_CATEGORIES: ReadonlyArray<{ value: RouteCategory; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'scenic', label: 'Scenic' },
  { value: 'mountain', label: 'Mountain' },
  { value: 'coastal', label: 'Coastal' },
  { value: 'near', label: 'Near me' },
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
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const [rideWindow, setRideWindow] = React.useState<RideWindow>('all');
  const [riderLocation, setRiderLocation] = React.useState<RiderCoordinate | null>(null);
  const [category, setCategory] = React.useState<RouteCategory>('all');
  const [query, setQuery] = React.useState('');
  const [toolsOpen, setToolsOpen] = React.useState(false);

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

  const selectCategory = React.useCallback(async (value: RouteCategory) => {
    if (value !== 'near' || riderLocation) {
      setCategory(value);
      return;
    }
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Location needed', 'Allow location to sort curated rides by distance from you.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setRiderLocation({ lat: position.coords.latitude, lon: position.coords.longitude });
      setCategory('near');
    } catch {
      Alert.alert('Location unavailable', 'Rider Comms could not get a current location fix.');
    }
  }, [riderLocation]);

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
        <ScreenHeader
          title="Routes"
          action={(
            <Pressable
              style={({ pressed }) => [styles.searchToggle, toolsOpen && styles.searchToggleActive, pressed && styles.searchTogglePressed]}
              onPress={() => setToolsOpen((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={toolsOpen ? 'Close route search and filters' : 'Search and filter routes'}
            >
              <Ionicons name={toolsOpen ? 'close' : 'search'} size={21} color={toolsOpen ? colors.accentText : colors.textPrimary} />
            </Pressable>
          )}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          accessibilityRole="tablist"
        >
          {ROUTE_CATEGORIES.map((filter) => (
            <FilterChip
              key={filter.value}
              label={filter.label}
              active={category === filter.value}
              onPress={() => void selectCategory(filter.value)}
            />
          ))}
        </ScrollView>

        {toolsOpen ? (
          <View style={styles.routeTools}>
            <View style={styles.routeSearch}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.routeSearchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search routes or regions"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={colors.textMuted} /></Pressable> : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.durationRow}>
              {RIDE_WINDOWS.map((filter) => (
                <FilterChip
                  key={filter.value}
                  label={filter.label}
                  active={rideWindow === filter.value}
                  onPress={() => setRideWindow(filter.value)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <CuratedRouteBrowser
          rideWindow={rideWindow}
          riderLocation={riderLocation}
          category={category}
          query={query}
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
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: 12,
  },
  filterRow: { gap: 6, paddingRight: spacing.md },
  searchToggle: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', borderWidth: 0 },
  searchToggleActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  searchTogglePressed: { opacity: 0.78 },
  routeTools: { gap: spacing.sm, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  routeSearch: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.md, backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  routeSearchInput: { ...type.body, flex: 1, minHeight: 44, color: colors.textPrimary, fontSize: 14 },
  durationRow: { gap: spacing.xs, paddingRight: spacing.sm },
  chip: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.accent },
  chipPressed: { opacity: 0.78 },
  chipText: { ...type.body, color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  chipTextActive: { color: colors.accentText },
});
