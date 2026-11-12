import * as React from 'react';
import { AccessibilityInfo, Alert, Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { PlaceResult } from '../api/places';
import { useAuth } from '../auth/AuthContext';
import { parseRecentPlaces, recentPlacesStorageKey } from '../search/recentPlaces';
import { SAVED_PLACE_LABELS, SAVED_PLACE_SLOTS } from '../search/savedPlaces';
import type { SavedPlaceSlot } from '../search/savedPlaces';
import { useSavedPlaces } from '../search/useSavedPlaces';
import { colors, MIN_TOUCH_TARGET, spacing, type, pressedFeedback } from '../theme';
import { PlaceSearchBar } from './PlaceSearchBar';
import type { PlaceSearchHandle } from './PlaceSearchBar';

/** How far a slide has to travel before the drawer opens or closes. */
const SLIDE_THRESHOLD = 30;
/** An open drawer stays open unless pulled down further than this. */
const CLOSE_THRESHOLD = 60;
/** The recent list's tallest; it scrolls beyond this. */
const RECENT_MAX_HEIGHT = 340;
const SETTLE_MS = 220;

export interface MapDrawerProps {
  near: { lat: number; lon: number } | null;
  onRequestLocation: () => Promise<void>;
  onSelectPlace: (place: PlaceResult) => void;
  /** A saved Home or Work: start the route there, like other map apps. */
  onRouteToPlace: (place: PlaceResult) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The drawer's resting height, so the map's controls can sit above it. */
  onPeekHeight: (height: number) => void;
  bottomInset: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The Where to drawer at the bottom of the map (PWA: #mapDrawer). At rest:
 * search and one-tap places: Home, Work and nearby petrol. Slide it up, or
 * tap its handle, for recent places. Ride, Friends and Routes are in the
 * menu behind the rider's avatar.
 */
export function MapDrawer({
  near, onRequestLocation, onSelectPlace, onRouteToPlace, open, onOpenChange, onPeekHeight, bottomInset, style,
}: MapDrawerProps): React.JSX.Element {
  const { riderId } = useAuth();
  const [recentPlaces, setRecentPlaces] = React.useState<PlaceResult[]>([]);
  const { savedPlaces, setSavedPlace: saveSavedPlace } = useSavedPlaces(riderId);
  const searchRef = React.useRef<PlaceSearchHandle>(null);

  // Home and Work: start the route, or choose the place the first time
  // (they can also be set in Settings, Map & navigation).
  const openSavedPlace = (slot: SavedPlaceSlot) => {
    const place = savedPlaces[slot];
    if (place) onRouteToPlace(place);
    else searchRef.current?.open({ saveAs: slot });
  };
  const editSavedPlace = (slot: SavedPlaceSlot) => {
    const label = SAVED_PLACE_LABELS[slot];
    const place = savedPlaces[slot];
    if (!place) {
      searchRef.current?.open({ saveAs: slot });
      return;
    }
    Alert.alert(label, `${place.name}${place.address ? `, ${place.address}` : ''}`, [
      { text: `Change ${label}`, onPress: () => searchRef.current?.open({ saveAs: slot, current: place }) },
      { text: `Remove ${label}`, style: 'destructive', onPress: () => saveSavedPlace(slot, null) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const openRef = React.useRef(open);
  openRef.current = open;
  // The recent list is always laid out, so its full height is known before
  // a slide starts; its visible height follows the finger, then settles.
  const [contentHeight, setContentHeight] = React.useState(0);
  const fullHeight = Math.min(contentHeight, RECENT_MAX_HEIGHT);
  const fullHeightRef = React.useRef(fullHeight);
  fullHeightRef.current = fullHeight;
  const visibleHeight = React.useRef(new Animated.Value(0)).current;
  const currentHeight = React.useRef(0);
  const reduceMotion = React.useRef(false);

  React.useEffect(() => {
    const listener = visibleHeight.addListener(({ value }) => { currentHeight.current = value; });
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { reduceMotion.current = enabled; }).catch(() => {});
    return () => visibleHeight.removeListener(listener);
  }, [visibleHeight]);

  const settleTo = React.useCallback((target: number) => {
    if (reduceMotion.current) {
      visibleHeight.setValue(target);
      return;
    }
    Animated.timing(visibleHeight, { toValue: target, duration: SETTLE_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: false }).start();
  }, [visibleHeight]);

  // Opened or closed from outside a slide (the handle, a shortcut, a place).
  React.useEffect(() => {
    settleTo(open ? fullHeight : 0);
  }, [open, fullHeight, settleTo]);

  React.useEffect(() => {
    if (!riderId) return;
    let cancelled = false;
    AsyncStorage.getItem(recentPlacesStorageKey(riderId))
      .then((raw) => { if (!cancelled) setRecentPlaces(parseRecentPlaces(raw)); })
      .catch(() => { if (!cancelled) setRecentPlaces([]); });
    return () => { cancelled = true; };
  }, [open, riderId]);

  // Only a real vertical slide claims the gesture, so taps still reach the
  // search field and the shortcut buttons.
  const dragStart = React.useRef(0);
  const panResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      visibleHeight.stopAnimation();
      dragStart.current = currentHeight.current;
    },
    onPanResponderMove: (_event, gesture) => {
      visibleHeight.setValue(Math.max(0, Math.min(fullHeightRef.current, dragStart.current - gesture.dy)));
    },
    onPanResponderRelease: (_event, gesture) => {
      const nextOpen = openRef.current ? gesture.dy < CLOSE_THRESHOLD : gesture.dy < -SLIDE_THRESHOLD;
      settleTo(nextOpen ? fullHeightRef.current : 0);
      if (nextOpen !== openRef.current) {
        // A light tick when a slide snaps the drawer to its other rest.
        void Haptics.selectionAsync().catch(() => {});
        onOpenChange(nextOpen);
      }
    },
    onPanResponderTerminate: () => settleTo(openRef.current ? fullHeightRef.current : 0),
  }), [onOpenChange, settleTo, visibleHeight]);

  const measurePeek = React.useCallback((event: LayoutChangeEvent) => {
    // Only the resting drawer sets the controls' height, never one mid-slide.
    if (!openRef.current && currentHeight.current < 1) onPeekHeight(event.nativeEvent.layout.height);
  }, [onPeekHeight]);

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
        style={({ pressed }) => [styles.handleButton, pressed && pressedFeedback]}
        testID="map-drawer-handle"
      >
        <View style={styles.handle} />
      </Pressable>

      <PlaceSearchBar ref={searchRef} near={near} onRequestLocation={onRequestLocation} onSelect={onSelectPlace} onSave={saveSavedPlace} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcuts} style={styles.shortcutsScroll}>
        {SAVED_PLACE_SLOTS.map((slot) => {
          const label = SAVED_PLACE_LABELS[slot];
          const place = savedPlaces[slot];
          return (
            <Pressable
              key={slot}
              accessibilityRole="button"
              accessibilityLabel={place ? `${label}, ${place.name}` : `Set ${label}`}
              accessibilityHint={place ? `Starts the route to ${label.toLowerCase()}. Press and hold to change it.` : `Choose your ${label.toLowerCase()} address`}
              accessibilityActions={place ? [{ name: 'longpress', label: `Change or remove ${label}` }] : undefined}
              onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'longpress') editSavedPlace(slot); }}
              onPress={() => openSavedPlace(slot)}
              onLongPress={() => editSavedPlace(slot)}
              style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
              testID={`drawer-${slot}`}
            >
              <Ionicons name={slot === 'home' ? 'home-outline' : 'briefcase-outline'} size={20} color={colors.accentInk} />
              <Text style={styles.shortcutText}>{label}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Petrol stations nearby"
          onPress={() => searchRef.current?.open({ category: 'Petrol' })}
          style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
          testID="drawer-petrol"
        >
          <MaterialCommunityIcons name="gas-station-outline" size={21} color={colors.accentInk} />
          <Text style={styles.shortcutText}>Petrol</Text>
        </Pressable>
      </ScrollView>

      <Animated.View
        style={[styles.recentClip, { height: visibleHeight }]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <View style={styles.recent} testID="map-drawer-recent" onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}>
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
      </Animated.View>
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
  // 32 tall plus the 8pt hit slop on each side meets the 48pt touch minimum.
  handleButton: { alignSelf: 'center', width: 88, height: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
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
  recentClip: { overflow: 'hidden' },
  recent: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: spacing.md },
  recentScroll: { maxHeight: RECENT_MAX_HEIGHT - 48 },
  recentTitle: { ...type.caption, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.xs },
  recentRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  recentCopy: { flex: 1, minWidth: 0 },
  recentName: { ...type.body, fontWeight: '600', color: colors.textPrimary },
  recentAddress: { ...type.caption, color: colors.textSecondary },
  empty: { ...type.body, color: colors.textSecondary, paddingVertical: spacing.sm },
});
