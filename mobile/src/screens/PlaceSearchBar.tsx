// Search is intentionally list-first: category and text results stay in this
// focused surface until the rider chooses one place. Only that selected place
// is handed back to the map, avoiding a distracting cloud of map markers.
import * as React from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { GOOGLE_PLACES_API_KEY } from '../config';
import { distanceBetweenMeters, formatPlaceDistance, isSearchQueryValid, searchNearbyPlaces, searchPlaces } from '../api/places';
import type { PlaceResult, PlaceSearchFailure } from '../api/places';
import { useAuth } from '../auth/AuthContext';
import { addRecentPlace, parseRecentPlaces, recentPlacesStorageKey } from '../search/recentPlaces';
import { useSettings } from '../settings/SettingsContext';

const SEARCH_DEBOUNCE_MS = 300;

const CATEGORIES = [
  { label: 'Petrol', types: ['gas_station'], icon: 'gas-station-outline' },
  { label: 'Parking', types: ['parking'], icon: 'parking' },
  { label: 'Restaurants', types: ['restaurant'], icon: 'silverware-fork-knife' },
  { label: 'Coffee', types: ['cafe', 'coffee_shop'], icon: 'coffee-outline' },
  { label: 'Repair', types: ['car_repair'], icon: 'wrench-outline' },
] as const;

export function PlaceSearchBar({
  near,
  onSelect,
  onRequestLocation,
}: {
  near: { lat: number; lon: number } | null;
  onSelect: (place: PlaceResult) => void;
  onRequestLocation: () => Promise<void>;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { riderId } = useAuth();
  const { unitSystem } = useSettings();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<PlaceResult[]>([]);
  const [recentPlaces, setRecentPlaces] = React.useState<PlaceResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searchError, setSearchError] = React.useState<PlaceSearchFailure | null>(null);
  const [retryToken, setRetryToken] = React.useState(0);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = React.useRef(0);
  const searchUnavailable = !GOOGLE_PLACES_API_KEY;

  React.useEffect(() => {
    let cancelled = false;
    setRecentPlaces([]);
    AsyncStorage.getItem(recentPlacesStorageKey(riderId))
      .then((raw) => {
        if (!cancelled) setRecentPlaces(parseRecentPlaces(raw));
      })
      .catch(() => {
        if (!cancelled) setRecentPlaces([]);
      });
    return () => { cancelled = true; };
  }, [riderId]);

  async function rememberPlace(place: PlaceResult): Promise<void> {
    const next = addRecentPlace(recentPlaces, place);
    setRecentPlaces(next);
    try {
      await AsyncStorage.setItem(recentPlacesStorageKey(riderId), JSON.stringify(next));
    } catch {
      // Recent places are a convenience; selection must still work if local
      // storage is temporarily unavailable.
    }
  }

  async function clearRecentPlaces(): Promise<void> {
    setRecentPlaces([]);
    try {
      await AsyncStorage.removeItem(recentPlacesStorageKey(riderId));
    } catch {
      // In-memory history is already cleared for this session.
    }
  }

  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const requestId = ++requestRef.current;
    if ((!activeCategory && !isSearchQueryValid(query)) || !near || searchUnavailable) {
      setResults([]);
      setSearchError(null);
      setLoading(false);
      return;
    }
    setSearchError(null);
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const category = CATEGORIES.find((item) => item.label === activeCategory);
      const request = category
        ? searchNearbyPlaces({ includedTypes: category.types }, near, GOOGLE_PLACES_API_KEY)
        : searchPlaces(query, near, GOOGLE_PLACES_API_KEY);
      request
        .then((result) => {
          if (requestId !== requestRef.current) return;
          setResults(result.places);
          setSearchError(result.status === 'ok' ? null : result.status);
        })
        .finally(() => {
          if (requestId === requestRef.current) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, activeCategory, near, searchUnavailable, retryToken]);

  function close(): void {
    requestRef.current += 1;
    setOpen(false);
    setQuery('');
    setActiveCategory(null);
    setResults([]);
    setSearchError(null);
    setLoading(false);
  }

  function chooseCategory(category: (typeof CATEGORIES)[number]): void {
    if (activeCategory === category.label) {
      setActiveCategory(null);
      setQuery('');
      return;
    }
    setActiveCategory(category.label);
    setQuery(category.label);
  }

  function updateQuery(value: string): void {
    setActiveCategory(null);
    setQuery(value);
  }

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.collapsed, elevation.raised, pressed && styles.pressed]}
        onPress={() => {
          setOpen(true);
          if (!near) void onRequestLocation();
        }}
        accessibilityLabel="Search for a place"
      >
        <Ionicons name="search" size={19} color={colors.textMuted} />
        <Text style={styles.collapsedText}>Search for a place</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
        <KeyboardAvoidingView
          style={[styles.screen, { paddingTop: insets.top }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={close} accessibilityLabel="Back to map">
              <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
            </Pressable>
            <View style={styles.inputShell}>
              <Ionicons name="search" size={19} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                value={query}
                onChangeText={updateQuery}
                placeholder="Search for a place"
                placeholderTextColor={colors.textMuted}
                autoFocus
                returnKeyType="search"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              {loading ? <ActivityIndicator size="small" color={colors.accent} /> : null}
              {Platform.OS !== 'ios' && query ? (
                <Pressable onPress={() => updateQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.categories}
          >
            {CATEGORIES.map((category) => {
              const active = category.label === activeCategory;
              return (
                <Pressable
                  key={category.label}
                  style={({ pressed }) => [styles.category, active && styles.categoryActive, pressed && styles.pressed]}
                  onPress={() => chooseCategory(category)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <MaterialCommunityIcons name={category.icon} size={17} color={active ? '#FFFFFF' : colors.textSecondary} />
                  <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{category.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {!query && recentPlaces.length > 0 ? (
            <FlatList
              data={recentPlaces.map((place) => near
                ? { ...place, distanceMeters: distanceBetweenMeters(near, place) }
                : place)}
              keyExtractor={(item) => `recent-${item.id}`}
              contentContainerStyle={styles.resultsContent}
              ListHeaderComponent={
                <View style={styles.resultsHeader}>
                  <View>
                    <Text style={styles.resultsEyebrow}>History</Text>
                    <Text style={styles.resultsTitle}>Recent places</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear recent places"
                    onPress={() => void clearRecentPlaces()}
                  >
                    <Text style={styles.clearRecent}>Clear</Text>
                  </Pressable>
                </View>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
                  onPress={() => {
                    onSelect(item);
                    void rememberPlace(item);
                    close();
                  }}
                  accessibilityLabel={`Recent place: ${item.name}, ${item.address}`}
                >
                  <View style={styles.resultIcon}>
                    <Ionicons name="time-outline" size={19} color={colors.accent} />
                  </View>
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                    {item.address ? <Text style={styles.resultAddress} numberOfLines={1}>{item.address}</Text> : null}
                  </View>
                  <View style={styles.resultTrailing}>
                    {near ? <Text style={styles.resultDistance}>{formatPlaceDistance(item.distanceMeters, unitSystem)}</Text> : null}
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </View>
                </Pressable>
              )}
            />
          ) : searchUnavailable ? (
            <SearchState icon="cloud-offline-outline" title="Search unavailable" copy="Place search is not configured for this build yet." />
          ) : !near ? (
            <SearchState
              icon="location-outline"
              title="Location needed"
              copy="Allow location to search nearby. Your position is not shared with other riders unless you turn sharing on."
              actionLabel="Try location again"
              onAction={() => void onRequestLocation()}
            />
          ) : !query ? (
            <SearchState icon="navigate-outline" title="Where do you want to go?" copy="Search by place or address, or choose a nearby category above." />
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.resultsContent}
              ListHeaderComponent={
                <View style={styles.resultsHeader}>
                  <View>
                    <Text style={styles.resultsEyebrow}>{activeCategory ? 'Nearby' : 'Search results'}</Text>
                    <Text style={styles.resultsTitle}>{activeCategory ?? 'Places and addresses'}</Text>
                  </View>
                  {!loading && results.length ? <Text style={styles.resultsCount}>{results.length} closest</Text> : null}
                </View>
              }
              ListEmptyComponent={
                !loading && searchError ? (
                  <SearchState
                    compact
                    icon={searchError === 'network-error' ? 'cloud-offline-outline' : 'alert-circle-outline'}
                    title={searchFailureCopy(searchError).title}
                    copy={searchFailureCopy(searchError).copy}
                    actionLabel="Try again"
                    onAction={() => setRetryToken((current) => current + 1)}
                  />
                ) : !loading && isSearchQueryValid(query) ? (
                  <SearchState compact icon="search-outline" title="No matching places" copy="Check the spelling or try a broader place name." />
                ) : null
              }
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
                  onPress={() => {
                    onSelect(item);
                    void rememberPlace(item);
                    close();
                  }}
                  accessibilityLabel={`${item.name}, ${item.address}`}
                >
                  <View style={styles.resultIcon}>
                    <Ionicons name="location-outline" size={19} color={colors.accent} />
                  </View>
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                    {item.address ? <Text style={styles.resultAddress} numberOfLines={1}>{item.address}</Text> : null}
                  </View>
                  <View style={styles.resultTrailing}>
                    <Text style={styles.resultDistance}>{formatPlaceDistance(item.distanceMeters, unitSystem)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </View>
                </Pressable>
              )}
            />
          )}

          <Text style={[styles.attribution, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>Place data from Google Maps</Text>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function searchFailureCopy(failure: PlaceSearchFailure): { title: string; copy: string } {
  if (failure === 'rate-limited') {
    return { title: 'Search is busy', copy: 'The place service is receiving too many requests. Wait a moment and try again.' };
  }
  if (failure === 'network-error') {
    return { title: 'Can’t reach place search', copy: 'Check your connection and try again.' };
  }
  if (failure === 'unavailable') {
    return { title: 'Search unavailable', copy: 'Place search is not configured for this build yet.' };
  }
  return { title: 'Place search failed', copy: 'The place service could not complete this search. Try again shortly.' };
}

function SearchState({ icon, title, copy, compact = false, actionLabel, onAction }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  copy: string;
  compact?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <View style={[styles.state, compact && styles.stateCompact]}>
      <View style={styles.stateIcon}><Ionicons name={icon} size={23} color={colors.textSecondary} /></View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateCopy}>{copy}</Text>
      {actionLabel && onAction ? (
        <Pressable
          style={styles.stateAction}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.stateActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  collapsedText: { ...type.body, color: colors.textMuted },
  pressed: { opacity: 0.76 },
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10 },
  backButton: {
    width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  inputShell: {
    flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, ...elevation.raised,
  },
  input: { flex: 1, ...type.body, color: colors.textPrimary, paddingVertical: 0 },
  categories: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: 3, paddingBottom: 12 },
  category: {
    minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  categoryActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  categoryText: { ...type.caption, fontSize: 14, color: colors.textSecondary },
  categoryTextActive: { color: '#FFFFFF' },
  resultsContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  resultsHeader: {
    minHeight: 58, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 5, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  resultsEyebrow: { ...type.label, fontSize: 10 },
  resultsTitle: { ...type.subheading, fontSize: 16, marginTop: 2 },
  resultsCount: { ...type.caption, fontSize: 11 },
  clearRecent: { ...type.caption, color: colors.accent, fontWeight: '800', paddingVertical: spacing.sm },
  resultRow: {
    minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 5,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  resultRowPressed: { backgroundColor: colors.surfaceRaised },
  resultIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.accentSoft },
  resultInfo: { flex: 1, minWidth: 0 },
  resultName: { ...type.body, color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  resultAddress: { ...type.caption, marginTop: 3 },
  resultTrailing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  resultDistance: { ...type.caption, fontSize: 11 },
  state: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  stateCompact: { flex: 0, minHeight: 210 },
  stateIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: colors.surfaceRaised, marginBottom: spacing.md },
  stateTitle: { ...type.subheading, textAlign: 'center' },
  stateCopy: { ...type.caption, maxWidth: 310, marginTop: spacing.sm, textAlign: 'center', lineHeight: 20 },
  stateAction: {
    minHeight: 42, justifyContent: 'center', marginTop: spacing.md, paddingHorizontal: spacing.lg,
    borderRadius: radii.pill, backgroundColor: colors.accent,
  },
  stateActionText: { ...type.caption, color: '#FFFFFF', fontWeight: '800' },
  attribution: { ...type.caption, paddingHorizontal: 20, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.border, textAlign: 'right', fontSize: 11 },
});
