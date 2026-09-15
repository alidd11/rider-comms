// Unverified scaffold — see navigation/index.tsx header note.
//
// TODO(native): this screen needs `expo-location` (or the bare RN geolocation
// API) for real GPS, which isn't installed in this sandbox. It's wired here
// against a `getCurrentLocation()` stub so the polling/zone-membership logic
// is real and swapping in real GPS is a one-line change, not a rewrite.
//
// TODO(backend): the presence API only returns *who* is nearby, not *where*
// they are — so the pins below are laid out on a circle around "you" for
// legibility, not placed at real bearings/distances. A real live map (per
// spec section 8) needs the backend to return each rider's lat/lon too.
//
// Public and Host share this one screen via a segmented toggle instead of
// being separate tabs — once this has a real map SDK behind it, a second
// tab would mean a second mounted (and separately billed) map instance for
// no reason, since only one is ever visible at a time anyway. The bottom
// tab bar's "Group Ride" button isn't a second screen either — it redirects
// (see navigation/index.tsx's tabPress listener) to this same Map route with
// a `segment: 'host'` param, read below, instead of navigating to its own
// registered-but-never-actually-shown screen.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet, Animated, PanResponder } from 'react-native';
import type { GestureResponderEvent, PanResponderGestureState } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Rect, Line, Defs, RadialGradient, Stop } from 'react-native-svg';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';
import type { TabParamList } from '../navigation';
import { RiderCommsClient } from '../api/client';
import { API_BASE_URL } from '../config';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { RideBar } from '../ride/RideBar';
import { HostPanel } from '../ride/HostPanel';
import { useSettings } from '../settings/SettingsContext';

const PRESENCE_UPDATE_INTERVAL_MS = 8000; // per spec Section 8: every 5-10s
// SVG viewBox stays a fixed square — only the on-screen pins need to track the
// container's real (non-square, variable) size now that it's flex: 1.
const VIEWBOX_SIZE = 320;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.75;

type Segment = 'public' | 'host';
type LayoutSize = { width: number; height: number };

// TODO(native): replace with expo-location's getCurrentPositionAsync().
async function getCurrentLocation(): Promise<{ lat: number; lon: number }> {
  throw new Error('getCurrentLocation() requires expo-location (not available in this sandbox)');
}

function ridersOnCircle(riders: string[], size: LayoutSize): Array<{ id: string; x: number; y: number }> {
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  const orbitRadius = Math.min(size.width, size.height) * 0.3;
  return riders.map((id, index) => {
    const angle = (index / Math.max(riders.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { id, x: centerX + orbitRadius * Math.cos(angle), y: centerY + orbitRadius * Math.sin(angle) };
  });
}

function MapPin({
  x,
  y,
  you = false,
  selected = false,
  onPress,
}: {
  x: number;
  y: number;
  you?: boolean;
  selected?: boolean;
  onPress?: () => void;
}): React.JSX.Element {
  const size = you ? 34 : selected ? 32 : 26;
  return (
    <Pressable
      style={[styles.pinWrap, { left: x - size / 2, top: y - size / 2 }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View
        style={[
          styles.pinBadge,
          { width: size, height: size, borderRadius: size / 2 },
          you ? styles.pinBadgeYou : styles.pinBadgeRider,
          selected && styles.pinBadgeSelected,
        ]}
      >
        <MaterialCommunityIcons
          name="motorbike"
          size={size * 0.62}
          color={you ? colors.accentText : colors.textPrimary}
        />
      </View>
    </Pressable>
  );
}

/**
 * Icon-only Public/Host toggle, floated on the right edge instead of a
 * full-width pill at the top — keeps the map clear top-to-bottom instead
 * of pushing it down under a header bar.
 */
function SegmentToggle({
  segment,
  onChange,
  topInset,
}: {
  segment: Segment;
  onChange: (s: Segment) => void;
  topInset: number;
}): React.JSX.Element {
  return (
    <View style={[styles.sideToggle, { top: topInset + spacing.sm }]}>
      <Pressable
        style={[styles.sideToggleButton, segment === 'public' && styles.sideToggleButtonActive]}
        onPress={() => onChange('public')}
        hitSlop={8}
      >
        <Ionicons
          name="radio"
          size={20}
          color={segment === 'public' ? colors.accentText : colors.textPrimary}
        />
      </Pressable>
      <Pressable
        style={[styles.sideToggleButton, segment === 'host' && styles.sideToggleButtonActive]}
        onPress={() => onChange('host')}
        hitSlop={8}
      >
        <Ionicons
          name="people"
          size={20}
          color={segment === 'host' ? colors.accentText : colors.textPrimary}
        />
      </Pressable>
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function touchDistance(touches: Array<{ pageX: number; pageY: number }>): number {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/**
 * Pinch-to-zoom and pan for the map, plus +/- buttons for a gloved thumb
 * that can't reliably pinch at speed-zero. No gesture-handler/reanimated
 * dependency — this app's touch needs are simple enough that PanResponder
 * (already in React Native core) covers it without a new native module.
 */
function ZoomableMap({ size, children }: { size: LayoutSize; children: React.ReactNode }): React.JSX.Element {
  const scale = React.useRef(new Animated.Value(1)).current;
  const translateX = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(0)).current;

  const scaleValue = React.useRef(1);
  const translateValue = React.useRef({ x: 0, y: 0 });
  const pinchStartDistance = React.useRef(0);
  const pinchStartScale = React.useRef(1);
  const dragStart = React.useRef({ x: 0, y: 0 });
  const panStart = React.useRef({ x: 0, y: 0 });

  const maxPan = React.useCallback(
    (currentScale: number) => ({
      x: ((currentScale - 1) * size.width) / 2,
      y: ((currentScale - 1) * size.height) / 2,
    }),
    [size.width, size.height]
  );

  const applyPan = React.useCallback(
    (x: number, y: number, currentScale: number) => {
      const bounds = maxPan(currentScale);
      const next = { x: clamp(x, -bounds.x, bounds.x), y: clamp(y, -bounds.y, bounds.y) };
      translateValue.current = next;
      translateX.setValue(next.x);
      translateY.setValue(next.y);
    },
    [maxPan, translateX, translateY]
  );

  const setZoom = React.useCallback(
    (nextScale: number) => {
      const clamped = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
      scaleValue.current = clamped;
      Animated.timing(scale, { toValue: clamped, duration: 150, useNativeDriver: false }).start();
      applyPan(translateValue.current.x, translateValue.current.y, clamped);
    },
    [applyPan, scale]
  );

  const resetZoom = React.useCallback(() => {
    scaleValue.current = MIN_ZOOM;
    translateValue.current = { x: 0, y: 0 };
    Animated.parallel([
      Animated.timing(scale, { toValue: MIN_ZOOM, duration: 200, useNativeDriver: false }),
      Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: false }),
      Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: false }),
    ]).start();
  }, [scale, translateX, translateY]);

  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt: GestureResponderEvent) => evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponder: (evt: GestureResponderEvent, gesture: PanResponderGestureState) =>
        evt.nativeEvent.touches.length === 2 ||
        (scaleValue.current > MIN_ZOOM + 0.02 && (Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5)),
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          pinchStartDistance.current = touchDistance(touches);
          pinchStartScale.current = scaleValue.current;
        } else if (touches.length === 1) {
          dragStart.current = { x: touches[0].pageX, y: touches[0].pageY };
          panStart.current = { ...translateValue.current };
        }
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          const distance = touchDistance(touches);
          if (pinchStartDistance.current > 0) {
            const nextScale = clamp(
              pinchStartScale.current * (distance / pinchStartDistance.current),
              MIN_ZOOM,
              MAX_ZOOM
            );
            scaleValue.current = nextScale;
            scale.setValue(nextScale);
            applyPan(translateValue.current.x, translateValue.current.y, nextScale);
          }
        } else if (touches.length === 1 && scaleValue.current > MIN_ZOOM) {
          const dx = touches[0].pageX - dragStart.current.x;
          const dy = touches[0].pageY - dragStart.current.y;
          applyPan(panStart.current.x + dx, panStart.current.y + dy, scaleValue.current);
        }
      },
      onPanResponderRelease: () => {
        pinchStartDistance.current = 0;
        if (scaleValue.current <= MIN_ZOOM) {
          resetZoom();
        }
      },
      onPanResponderTerminate: () => {
        pinchStartDistance.current = 0;
      },
    })
  ).current;

  const [zoomedIn, setZoomedIn] = React.useState(false);
  React.useEffect(() => {
    const id = scale.addListener(({ value }) => setZoomedIn(value > MIN_ZOOM + 0.02));
    return () => scale.removeListener(id);
  }, [scale]);

  return (
    <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { transform: [{ translateX }, { translateY }, { scale }] },
        ]}
      >
        {children}
      </Animated.View>

      <View style={styles.zoomControls}>
        <Pressable
          style={styles.zoomButton}
          onPress={() => setZoom(scaleValue.current + ZOOM_STEP)}
          hitSlop={8}
        >
          <Ionicons name="add" size={20} color={colors.textPrimary} />
        </Pressable>
        <Pressable
          style={styles.zoomButton}
          onPress={() => setZoom(scaleValue.current - ZOOM_STEP)}
          hitSlop={8}
        >
          <Ionicons name="remove" size={20} color={colors.textPrimary} />
        </Pressable>
        {zoomedIn && (
          <Pressable style={styles.zoomButton} onPress={resetZoom} hitSlop={8}>
            <MaterialCommunityIcons name="crosshairs-gps" size={18} color={colors.accent} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function MapScreen(): React.JSX.Element {
  const { zoneTier: tier } = useSettings();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<TabParamList, 'Map'>>();
  const [segment, setSegment] = React.useState<Segment>(route.params?.segment ?? 'public');
  const [ridersInZone, setRidersInZone] = React.useState<string[]>([]);
  // "No location yet" (getCurrentLocation() failing — expected pre-GPS, see
  // the TODO on that stub above) is a normal, non-alarming state, not a
  // genuine error — kept separate from `error` so it renders with neutral
  // styling instead of the red/danger treatment reserved for real failures
  // (e.g. the presence API call itself failing below).
  const [locationUnavailable, setLocationUnavailable] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedRider, setSelectedRider] = React.useState<string | null>(null);
  const [mapSize, setMapSize] = React.useState<LayoutSize>({ width: VIEWBOX_SIZE, height: VIEWBOX_SIZE });

  React.useEffect(() => {
    const client = new RiderCommsClient(API_BASE_URL);
    let cancelled = false;

    async function tick() {
      let lat: number, lon: number;
      try {
        ({ lat, lon } = await getCurrentLocation());
      } catch {
        if (!cancelled) {
          setLocationUnavailable(true);
        }
        return;
      }
      try {
        const radiusMiles = TIER_RADIUS_MILES[tier];
        const { inZoneWith } = await client.updatePresence('me', lat, lon, radiusMiles);
        if (!cancelled) {
          setRidersInZone(inZoneWith);
          setLocationUnavailable(false);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLocationUnavailable(false);
          setError(err instanceof Error ? err.message : 'Could not update your zone.');
        }
      }
    }

    tick();
    const interval = setInterval(tick, PRESENCE_UPDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tier]);

  // Reacts to the "Group Ride" tab bar shortcut (see navigation/index.tsx),
  // which navigates here with a fresh `at` nonce each press so a repeat tap
  // back to the same segment still switches even if the user had since
  // flipped the in-screen toggle to something else.
  React.useEffect(() => {
    if (route.params?.segment) {
      setSegment(route.params.segment);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.at]);

  const pins = ridersOnCircle(ridersInZone, mapSize);
  const centerX = mapSize.width / 2;
  const centerY = mapSize.height / 2;

  function toggleSelected(id: string) {
    setSelectedRider((current) => (current === id ? null : id));
  }

  function handleMapLayout(event: { nativeEvent: { layout: LayoutSize } }) {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setMapSize({ width, height });
    }
  }

  return (
    <View style={styles.container}>
      {segment === 'public' ? (
        <View style={styles.mapFill} onLayout={handleMapLayout}>
          <ZoomableMap size={mapSize}>
            <Svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
              preserveAspectRatio="none"
            >
              <Defs>
                <RadialGradient id="ground" cx="50%" cy="45%" r="75%">
                  <Stop offset="0%" stopColor={colors.surfaceRaised} />
                  <Stop offset="100%" stopColor={colors.asphalt} />
                </RadialGradient>
              </Defs>
              <Rect width={VIEWBOX_SIZE} height={VIEWBOX_SIZE} fill="url(#ground)" />
              <Line x1={-20} y1={VIEWBOX_SIZE * 0.72} x2={VIEWBOX_SIZE + 20} y2={VIEWBOX_SIZE * 0.2} stroke={colors.border} strokeWidth={46} strokeLinecap="round" />
              <Line
                x1={-20}
                y1={VIEWBOX_SIZE * 0.72}
                x2={VIEWBOX_SIZE + 20}
                y2={VIEWBOX_SIZE * 0.2}
                stroke={colors.laneLine}
                strokeWidth={2}
                strokeDasharray="10 12"
              />
            </Svg>

            <MapPin x={centerX} y={centerY} you />
            {pins.map((pin) => (
              <MapPin
                key={pin.id}
                x={pin.x}
                y={pin.y}
                selected={selectedRider === pin.id}
                onPress={() => toggleSelected(pin.id)}
              />
            ))}
          </ZoomableMap>
        </View>
      ) : (
        <View style={[styles.hostFill, { paddingTop: insets.top + spacing.xxl }]}>
          <HostPanel />
        </View>
      )}

      {segment === 'public' && locationUnavailable && (
        <View style={[styles.errorOverlay, { top: insets.top + spacing.lg }]} pointerEvents="box-none">
          <View style={styles.noticeBox}>
            <Ionicons name="location-outline" size={18} color={colors.textMuted} />
            <Text style={styles.noticeText}>Location unavailable — see Settings to enable it</Text>
          </View>
        </View>
      )}

      {segment === 'public' && error && (
        <View style={[styles.errorOverlay, { top: insets.top + spacing.lg }]} pointerEvents="box-none">
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        </View>
      )}

      <SegmentToggle segment={segment} onChange={setSegment} topInset={insets.top} />

      <View style={styles.rideBarSlot} pointerEvents="box-none">
        <RideBar />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapFill: { flex: 1 },
  hostFill: { flex: 1, padding: spacing.lg, paddingTop: spacing.xxl },
  errorOverlay: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.xxl + spacing.md,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    ...elevation.raised,
  },
  errorText: { ...type.body, color: colors.danger, flex: 1 },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.raised,
  },
  noticeText: { ...type.body, color: colors.textMuted, flex: 1 },
  sideToggle: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.sm,
    gap: spacing.xs,
  },
  sideToggleButton: {
    width: MIN_TOUCH_TARGET * 0.7,
    height: MIN_TOUCH_TARGET * 0.7,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.raised,
  },
  sideToggleButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pinWrap: { position: 'absolute' },
  pinBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  pinBadgeYou: { backgroundColor: colors.accent },
  pinBadgeRider: { backgroundColor: colors.surfaceRaised },
  pinBadgeSelected: { borderColor: colors.accent, backgroundColor: colors.accentPressed },
  rideBarSlot: { marginTop: 'auto', paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  zoomControls: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    gap: spacing.xs,
  },
  zoomButton: {
    width: MIN_TOUCH_TARGET * 0.7,
    height: MIN_TOUCH_TARGET * 0.7,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
