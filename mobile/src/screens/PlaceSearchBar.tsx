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
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, elevation, pressedFeedback } from '../theme';
import { styles } from './PlaceSearchBar.styles';
import { distanceBetweenMeters, formatPlaceDistance, isSearchQueryValid, newPlaceSearchSession, placeDetails, PLACE_SEARCH_DEBOUNCE_MS, PLACE_SUGGEST_DEBOUNCE_MS, searchNearbyPlaces, suggestPlaces } from '../api/places';
import type { PlaceResult, PlaceSearchFailure, PlaceSuggestion } from '../api/places';
import { nearbySearchCacheKey, PlacesCache, wrapPlacesSearchWithCache } from '../api/placesCache';
import { useAuth } from '../auth/AuthContext';
import { addRecentPlace, parseRecentPlaces, recentPlacesStorageKey } from '../search/recentPlaces';
import { SAVED_PLACE_LABELS } from '../search/savedPlaces';
import type { SavedPlaceSlot } from '../search/savedPlaces';
import { useSettings } from '../settings/SettingsContext';

// Module-level so the cache survives across searches within a session
// (retyping, re-toggling a category chip) without persisting between app
// launches.
const placesCache = new PlacesCache();
const cachedSearchNearbyPlaces = wrapPlacesSearchWithCache(searchNearbyPlaces, placesCache, nearbySearchCacheKey);

const CATEGORIES = [
  { label: 'Petrol', types: ['gas_station'], icon: 'gas-station-outline' },
  { label: 'Parking', types: ['parking'], icon: 'parking' },
  { label: 'Restaurants', types: ['restaurant'], icon: 'silverware-fork-knife' },
  { label: 'Coffee', types: ['cafe', 'coffee_shop'], icon: 'coffee-outline' },
  { label: 'Repair', types: ['car_repair'], icon: 'wrench-outline' },
] as const;

export type SearchCategoryLabel = (typeof CATEGORIES)[number]['label'];

/** Opens search from elsewhere: on a category, or to choose Home or Work. */
export interface PlaceSearchHandle {
  open: (options?: { category?: SearchCategoryLabel; saveAs?: SavedPlaceSlot; current?: PlaceResult }) => void;
}

export const PlaceSearchBar = React.forwardRef<PlaceSearchHandle, {
  near: { lat: number; lon: number } | null;
  onSelect: (place: PlaceResult) => void;
  onRequestLocation: () => Promise<void>;
  /** A place chosen (or null: removed) while search was choosing Home or Work. */
  onSave?: (slot: SavedPlaceSlot, place: PlaceResult | null) => void;
  /** False hides the Where to? bar, for search opened only from code (Settings). */
  showBar?: boolean;
}>(function PlaceSearchBar({ near, onSelect, onRequestLocation, onSave, showBar = true }, ref): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { client, riderId } = useAuth();
  const { unitSystem } = useSettings();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeCategory, setActiveCategory] = React.useState<string | null>(null);
  const [saveAs, setSaveAs] = React.useState<SavedPlaceSlot | null>(null);
  const [savedCurrent, setSavedCurrent] = React.useState<PlaceResult | null>(null);
  const [results, setResults] = React.useState<PlaceResult[]>([]);
  // Typing: suggestions within one search session; picking one fetches its
  // details, which ends the session.
  const [suggestions, setSuggestions] = React.useState<PlaceSuggestion[]>([]);
  const [pickingId, setPickingId] = React.useState<string | null>(null);
  const sessionRef = React.useRef<string | null>(null);
  // Bumped when search closes, so a lookup still in flight then is ignored.
  const pickRef = React.useRef(0);
  const [recentPlaces, setRecentPlaces] = React.useState<PlaceResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searchError, setSearchError] = React.useState<PlaceSearchFailure | null>(null);
  const [retryToken, setRetryToken] = React.useState(0);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = React.useRef(0);

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
    if ((!activeCategory && !isSearchQueryValid(query)) || !near) {
      setResults([]);
      setSuggestions([]);
      setSearchError(null);
      setLoading(false);
      return;
    }
    setSearchError(null);
    setLoading(true);
    const category = CATEGORIES.find((item) => item.label === activeCategory);
    debounceRef.current = setTimeout(() => {
      if (category) {
        cachedSearchNearbyPlaces({ includedTypes: category.types }, near, client)
          .then((result) => {
            if (requestId !== requestRef.current) return;
            setResults(result.places);
            setSearchError(result.status === 'ok' ? null : result.status);
          })
          .finally(() => {
            if (requestId === requestRef.current) setLoading(false);
          });
        return;
      }
      sessionRef.current ??= newPlaceSearchSession();
      suggestPlaces(query, near, sessionRef.current, client)
        .then((result) => {
          if (requestId !== requestRef.current) return;
          setSuggestions(result.suggestions);
          setSearchError(result.status === 'ok' ? null : result.status);
        })
        .finally(() => {
          if (requestId === requestRef.current) setLoading(false);
        });
    }, category ? PLACE_SEARCH_DEBOUNCE_MS : PLACE_SUGGEST_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, activeCategory, near, client, retryToken]);

  React.useImperativeHandle(ref, () => ({
    open: (options) => {
      setSaveAs(options?.saveAs ?? null);
      setSavedCurrent(options?.saveAs ? options.current ?? null : null);
      if (options?.category) {
        setActiveCategory(options.category);
        setQuery(options.category);
      }
      setOpen(true);
      if (!near) void onRequestLocation();
    },
  }), [near, onRequestLocation]);

  async function chooseSuggestion(suggestion: PlaceSuggestion): Promise<void> {
    if (pickingId) return;
    const token = sessionRef.current ?? newPlaceSearchSession();
    // The details call ends this session; the next search starts a new one.
    sessionRef.current = null;
    setPickingId(suggestion.id);
    const pick = pickRef.current;
    const result = await placeDetails(suggestion.id, token, near, client);
    if (pick !== pickRef.current) return;
    setPickingId(null);
    if (result.status === 'ok') {
      choose(result.place);
      return;
    }
    // The error state shows in place of the list; Try again searches anew.
    setSuggestions([]);
    setSearchError(result.status);
  }

  function choose(place: PlaceResult): void {
    if (saveAs) onSave?.(saveAs, place);
    onSelect(place);
    void rememberPlace(place);
    close();
  }

  function close(): void {
    requestRef.current += 1;
    setOpen(false);
    setSaveAs(null);
    setSavedCurrent(null);
    setQuery('');
    setActiveCategory(null);
    setResults([]);
    setSuggestions([]);
    setPickingId(null);
    sessionRef.current = null;
    pickRef.current += 1;
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
      {showBar ? (
        <Pressable accessibilityRole="button"
          style={({ pressed }) => [styles.collapsed, elevation.raised, pressed && styles.pressed]}
          onPress={() => {
            setOpen(true);
            if (!near) void onRequestLocation();
          }}
          accessibilityLabel="Where to?"
        >
          <Ionicons name="search" size={19} color={colors.textMuted} />
          <Text style={styles.collapsedText}>Where to?</Text>
        </Pressable>
      ) : null}

      <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
        <KeyboardAvoidingView
          style={[styles.screen, { paddingTop: insets.top }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <Pressable accessibilityRole="button" style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={close} accessibilityLabel="Back to map">
              <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
            </Pressable>
            <View style={styles.inputShell}>
              <Ionicons name="search" size={19} color={colors.textMuted} />
              <TextInput
                style={styles.input}
                accessibilityLabel={saveAs ? `Search for your ${SAVED_PLACE_LABELS[saveAs].toLowerCase()} address` : 'Search for a place'}
                value={query}
                onChangeText={updateQuery}
                placeholder={saveAs ? `Your ${SAVED_PLACE_LABELS[saveAs].toLowerCase()} address` : 'Search for a place'}
                placeholderTextColor={colors.textMuted}
                autoFocus
                returnKeyType="search"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
              {loading ? <ActivityIndicator size="small" color={colors.accent} /> : null}
              {Platform.OS !== 'ios' && query ? (
                <Pressable accessibilityRole="button" onPress={() => updateQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
          </View>

          {saveAs ? (
            <Text style={styles.saveBanner} accessibilityRole="header">Choose your {SAVED_PLACE_LABELS[saveAs]}</Text>
          ) : null}
          {saveAs && savedCurrent ? (
            <View style={styles.saveCurrent}>
              <Text style={styles.saveCurrentText} numberOfLines={1}>Now: {savedCurrent.name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${SAVED_PLACE_LABELS[saveAs]}`}
                hitSlop={8}
                onPress={() => { onSave?.(saveAs, null); close(); }}
              >
                <Text style={styles.saveRemove}>Remove</Text>
              </Pressable>
            </View>
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.categories}
            style={saveAs ? styles.hidden : undefined}
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
                  <MaterialCommunityIcons name={category.icon} size={17} color={active ? colors.accentText : colors.textSecondary} />
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
                    accessibilityHint="Removes saved recent places from this device"
                    hitSlop={8}
                    onPress={() => void clearRecentPlaces()}
                  >
                    <Text style={styles.clearRecent}>Clear</Text>
                  </Pressable>
                </View>
              }
              renderItem={({ item }) => (
                <Pressable accessibilityRole="button"
                  style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
                  onPress={() => choose(item)}
                  accessibilityLabel={`Recent place: ${item.name}, ${item.address}${near ? `, ${formatPlaceDistance(item.distanceMeters, unitSystem)} away` : ''}`}
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
          ) : !near ? (
            <SearchState
              icon="location-outline"
              title="Location needed"
              copy="Allow location to search nearby. Your position is not shared with other riders unless you turn sharing on."
              actionLabel="Try location again"
              onAction={() => void onRequestLocation()}
            />
          ) : !query ? (
            saveAs ? (
              <SearchState icon={saveAs === 'home' ? 'home-outline' : 'briefcase-outline'} title={`Search for your ${SAVED_PLACE_LABELS[saveAs].toLowerCase()} address`} copy={`${SAVED_PLACE_LABELS[saveAs]} stays one tap away in Where to. Press and hold it there to change it.`} />
            ) : (
              <SearchState icon="navigate-outline" title="Where do you want to go?" copy="Search by place or address, or choose a nearby category above." />
            )
          ) : (
            <FlatList
              data={activeCategory ? results : suggestions}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.resultsContent}
              ListHeaderComponent={
                <View style={styles.resultsHeader}>
                  <View>
                    <Text style={styles.resultsEyebrow}>{activeCategory ? 'Nearby' : 'Search results'}</Text>
                    <Text style={styles.resultsTitle}>{activeCategory ?? 'Places and addresses'}</Text>
                  </View>
                  {!loading && activeCategory && results.length ? <Text style={styles.resultsCount}>{results.length} closest</Text> : null}
                </View>
              }
              ListEmptyComponent={
                loading ? (
                  <SearchState compact icon="search-outline" title="Searching…" copy="Looking for nearby places." />
                ) : searchError ? (
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
                ) : undefined
              }
              renderItem={({ item }) => {
                const picking = pickingId === item.id;
                const distance = item.distanceMeters;
                return (
                  <Pressable accessibilityRole="button"
                    style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
                    onPress={() => { if (isPlaceResult(item)) choose(item); else void chooseSuggestion(item); }}
                    disabled={Boolean(pickingId)}
                    accessibilityState={{ busy: picking, disabled: Boolean(pickingId) && !picking }}
                    accessibilityLabel={`${item.name}${item.address ? `, ${item.address}` : ''}`}
                  >
                    <View style={styles.resultIcon}>
                      <Ionicons name="location-outline" size={19} color={colors.accent} />
                    </View>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                      {item.address ? <Text style={styles.resultAddress} numberOfLines={1}>{item.address}</Text> : null}
                    </View>
                    <View style={styles.resultTrailing}>
                      {picking ? <ActivityIndicator size="small" color={colors.accent} /> : distance !== undefined ? (
                        <Text style={styles.resultDistance}>{formatPlaceDistance(distance, unitSystem)}</Text>
                      ) : null}
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </View>
                  </Pressable>
                );
              }}
            />
          )}

          <Text style={[styles.attribution, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>Place data from Google Maps</Text>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
});

/** A full place (category search) rather than a suggestion still to look up. */
function isPlaceResult(item: PlaceResult | PlaceSuggestion): item is PlaceResult {
  return typeof (item as PlaceResult).lat === 'number';
}

function searchFailureCopy(failure: PlaceSearchFailure): { title: string; copy: string } {
  if (failure === 'rate-limited') {
    return { title: 'Search is busy', copy: 'The place service is receiving too many requests. Wait a moment and try again.' };
  }
  if (failure === 'network-error') {
    return { title: 'Can’t reach place search', copy: 'Check your connection and try again.' };
  }
  if (failure === 'unavailable') {
    return { title: 'Search unavailable', copy: 'Place search isn’t available right now. Try again later.' };
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
          style={({ pressed }) => [styles.stateAction, pressed && pressedFeedback]}
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
