// See src/api/places.ts's header note: this is the search half of POI
// search only. Selecting a result can't yet pan/route on a real map — this
// screen's map is still the illustrative SVG described in MapScreen.tsx's
// header note, not a real geo-referenced map. Selecting a result here just
// confirms the search itself works end-to-end against the real Places API
// when a key is configured; wiring a selection into an actual pan/route is
// part of the native-map-SDK work, not this file.
import * as React from 'react';
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { GOOGLE_PLACES_API_KEY } from '../config';
import { searchPlaces, isSearchQueryValid } from '../api/places';
import type { PlaceResult } from '../api/places';

const SEARCH_DEBOUNCE_MS = 350;

export function PlaceSearchBar({
  near,
  onSelect,
}: {
  near: { lat: number; lon: number } | null;
  onSelect: (place: PlaceResult) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<PlaceResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchUnavailable = !GOOGLE_PLACES_API_KEY;

  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isSearchQueryValid(query) || !near || searchUnavailable) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      searchPlaces(query, near, GOOGLE_PLACES_API_KEY)
        .then(setResults)
        .finally(() => setLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, near, searchUnavailable]);

  function close() {
    setOpen(false);
    setQuery('');
    setResults([]);
  }

  if (!open) {
    return (
      <Pressable style={[styles.collapsed, elevation.raised]} onPress={() => setOpen(true)} accessibilityLabel="Search for a place">
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <Text style={styles.collapsedText}>Search for a place</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.expanded, elevation.raised]}>
      <View style={styles.inputRow}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a place"
          placeholderTextColor={colors.textMuted}
          autoFocus
          returnKeyType="search"
        />
        {loading && <ActivityIndicator size="small" color={colors.accent} />}
        <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close search">
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {searchUnavailable ? (
        <Text style={styles.unavailableText}>
          Place search isn't configured for this build yet — see Settings for map status.
        </Text>
      ) : !near ? (
        <Text style={styles.unavailableText}>Turn on location to search nearby.</Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          style={styles.resultsList}
          ListEmptyComponent={
            !loading && isSearchQueryValid(query) ? <Text style={styles.emptyText}>No places found.</Text> : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowPressed]}
              onPress={() => {
                onSelect(item);
                close();
              }}
            >
              <Ionicons name="location-outline" size={18} color={colors.accent} />
              <View style={styles.resultInfo}>
                <Text style={styles.resultName}>{item.name}</Text>
                {item.address ? <Text style={styles.resultAddress}>{item.address}</Text> : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  collapsedText: { ...type.body, color: colors.textMuted },
  expanded: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 320,
    overflow: 'hidden',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  input: { flex: 1, ...type.body, color: colors.textPrimary },
  unavailableText: { ...type.caption, padding: spacing.md },
  emptyText: { ...type.caption, padding: spacing.md },
  resultsList: { flexGrow: 0 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultRowPressed: { backgroundColor: colors.surfaceRaised },
  resultInfo: { flex: 1, gap: spacing.xs },
  resultName: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  resultAddress: { ...type.caption },
});
