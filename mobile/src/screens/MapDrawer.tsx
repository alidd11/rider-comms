import * as React from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { PlaceResult } from '../api/places';
import { useAuth } from '../auth/AuthContext';
import { parseRecentPlaces, recentPlacesStorageKey } from '../search/recentPlaces';
import { colors, MIN_TOUCH_TARGET, radii, spacing, type } from '../theme';
import { PlaceSearchBar } from './PlaceSearchBar';

/** How far a slide has to travel before the drawer opens or closes. */
const SLIDE_THRESHOLD = 30;

export interface MapDrawerProps {
  near: { lat: number; lon: number } | null;
  onRequestLocation: () => Promise<void>;
  onSelectPlace: (place: PlaceResult) => void;
  onRide: () => void;
  onFriends: () => void;
  onRoutes: () => void;
  rideLive: boolean;
  /** Friend requests plus unread messages. */
  friendsCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The drawer's resting height, so the map's controls can sit above it. */
  onPeekHeight: (height: number) => void;
  bottomInset: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Where to drawer at the bottom of the map (PWA: #mapDrawer). At rest:
 * search and shortcuts to Ride, Friends and Routes. Slide it up, or tap its
 * handle, for recent places.
 */
export function MapDrawer({
  near, onRequestLocation, onSelectPlace, onRide, onFriends, onRoutes,
  rideLive, friendsCount, open, onOpenChange, onPeekHeight, bottomInset, style,
}: MapDrawerProps): React.JSX.Element {
  const { riderId } = useAuth();
  const [recentPlaces, setRecentPlaces] = React.useState<PlaceResult[]>([]);
  const openRef = React.useRef(open);
  openRef.current = open;

  React.useEffect(() => {
    if (!open || !riderId) return;
    let cancelled = false;
    AsyncStorage.getItem(recentPlacesStorageKey(riderId))
      .then((raw) => { if (!cancelled) setRecentPlaces(parseRecentPlaces(raw)); })
      .catch(() => { if (!cancelled) setRecentPlaces([]); });
    return () => { cancelled = true; };
  }, [open, riderId]);

  // Only a real vertical slide claims the gesture, so taps still reach the
  // search field and the shortcut buttons.
  const panResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy < -SLIDE_THRESHOLD) onOpenChange(true);
      else if (gesture.dy > SLIDE_THRESHOLD) onOpenChange(false);
    },
  }), [onOpenChange]);

  const measurePeek = React.useCallback((event: LayoutChangeEvent) => {
    if (!openRef.current) onPeekHeight(event.nativeEvent.layout.height);
  }, [onPeekHeight]);

  const friendsLabel = friendsCount > 0 ? `Friends, ${friendsCount} new` : 'Friends';
  return (
    <View
      style={[styles.drawer, { paddingBottom: bottomInset + spacing.md }, style]}
      onLayout={measurePeek}
      testID="map-drawer"
      accessibilityLabel="Where to"
      {...panResponder.panHandlers}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide recent places' : 'Show recent places'}
        accessibilityState={{ expanded: open }}
        onPress={() => onOpenChange(!open)}
        hitSlop={8}
        style={styles.handleButton}
        testID="map-drawer-handle"
      >
        <View style={styles.handle} />
      </Pressable>

      <PlaceSearchBar near={near} onRequestLocation={onRequestLocation} onSelect={onSelectPlace} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcuts} style={styles.shortcutsScroll}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rideLive ? 'Ride, live' : 'Ride'}
          onPress={onRide}
          style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
          testID="drawer-ride"
        >
          <MaterialCommunityIcons name="motorbike" size={21} color={colors.accentInk} />
          <Text style={styles.shortcutText}>Ride</Text>
          {rideLive ? (
            <View style={styles.live}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={friendsLabel}
          onPress={onFriends}
          style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
          testID="drawer-friends"
        >
          <MaterialCommunityIcons name="account-multiple-outline" size={21} color={colors.accentInk} />
          <Text style={styles.shortcutText}>Friends</Text>
          {friendsCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{friendsCount > 99 ? '99+' : friendsCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Routes"
          onPress={onRoutes}
          style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
          testID="drawer-routes"
        >
          <Ionicons name="flag-outline" size={20} color={colors.accentInk} />
          <Text style={styles.shortcutText}>Routes</Text>
        </Pressable>
      </ScrollView>

      {open ? (
        <View style={styles.recent} testID="map-drawer-recent">
          {recentPlaces.length === 0 ? (
            <Text style={styles.empty}>Places you search for show up here.</Text>
          ) : (
            <ScrollView style={styles.recentScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.recentTitle} accessibilityRole="header">Recent</Text>
              {recentPlaces.map((place) => (
                <Pressable
                  key={place.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Recent place: ${place.name}, ${place.address}`}
                  onPress={() => {
                    onOpenChange(false);
                    onSelectPlace(place);
                  }}
                  style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
                >
                  <Ionicons name="time-outline" size={20} color={colors.textMuted} />
                  <View style={styles.recentCopy}>
                    <Text numberOfLines={1} style={styles.recentName}>{place.name}</Text>
                    <Text numberOfLines={1} style={styles.recentAddress}>{place.address}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 12,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.md,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  handleButton: { alignSelf: 'center', width: 88, height: 24, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
  shortcutsScroll: { marginTop: spacing.md, marginHorizontal: -spacing.md },
  shortcuts: { gap: 10, paddingHorizontal: spacing.md },
  shortcut: {
    minHeight: MIN_TOUCH_TARGET + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  shortcutText: { ...type.body, fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  liveText: { ...type.caption, fontWeight: '700', color: colors.textPrimary },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  badgeText: { fontSize: 12, fontWeight: '800', color: colors.accentText },
  recent: { marginTop: spacing.md },
  recentScroll: { maxHeight: 320 },
  recentTitle: { ...type.caption, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.xs },
  recentRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  recentCopy: { flex: 1, minWidth: 0 },
  recentName: { ...type.body, fontWeight: '600', color: colors.textPrimary },
  recentAddress: { ...type.caption, color: colors.textSecondary },
  empty: { ...type.body, color: colors.textSecondary, paddingVertical: spacing.sm },
});
