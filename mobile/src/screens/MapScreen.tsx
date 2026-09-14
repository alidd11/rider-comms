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
// Public and Host share this one screen via a segmented switcher instead of
// being separate tabs — once this has a real map SDK behind it, a second
// tab would mean a second mounted (and separately billed) map instance for
// no reason, since only one is ever visible at a time anyway.
import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Rect, Circle, Line, Defs, RadialGradient, Stop } from 'react-native-svg';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';
import { RiderCommsClient } from '../api/client';
import { API_BASE_URL } from '../config';
import { colors, spacing, radii, type, elevation } from '../theme';
import { RideBar } from '../ride/RideBar';
import { HostPanel } from '../ride/HostPanel';
import { useSettings } from '../settings/SettingsContext';

const PRESENCE_UPDATE_INTERVAL_MS = 8000; // per spec Section 8: every 5-10s
// SVG viewBox stays a fixed square — only the on-screen pins need to track the
// container's real (non-square, variable) size now that it's flex: 1.
const VIEWBOX_SIZE = 320;

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

function SegmentSwitcher({ segment, onChange }: { segment: Segment; onChange: (s: Segment) => void }): React.JSX.Element {
  return (
    <View style={styles.switcher}>
      <Pressable
        style={[styles.switcherOption, segment === 'public' && styles.switcherOptionActive]}
        onPress={() => onChange('public')}
      >
        <Ionicons
          name="radio"
          size={16}
          color={segment === 'public' ? colors.accentText : colors.textSecondary}
        />
        <Text style={[styles.switcherLabel, segment === 'public' && styles.switcherLabelActive]}>Public</Text>
      </Pressable>
      <Pressable
        style={[styles.switcherOption, segment === 'host' && styles.switcherOptionActive]}
        onPress={() => onChange('host')}
      >
        <Ionicons
          name="people"
          size={16}
          color={segment === 'host' ? colors.accentText : colors.textSecondary}
        />
        <Text style={[styles.switcherLabel, segment === 'host' && styles.switcherLabelActive]}>Host</Text>
      </Pressable>
    </View>
  );
}

export function MapScreen(): React.JSX.Element {
  const { zoneTier: tier } = useSettings();
  const [segment, setSegment] = React.useState<Segment>('public');
  const [ridersInZone, setRidersInZone] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedRider, setSelectedRider] = React.useState<string | null>(null);
  const [mapSize, setMapSize] = React.useState<LayoutSize>({ width: VIEWBOX_SIZE, height: VIEWBOX_SIZE });

  React.useEffect(() => {
    const client = new RiderCommsClient(API_BASE_URL);
    let cancelled = false;

    async function tick() {
      try {
        const { lat, lon } = await getCurrentLocation();
        const radiusMiles = TIER_RADIUS_MILES[tier];
        const { inZoneWith } = await client.updatePresence('me', lat, lon, radiusMiles);
        if (!cancelled) {
          setRidersInZone(inZoneWith);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
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
      <SegmentSwitcher segment={segment} onChange={setSegment} />

      {segment === 'public' ? (
        <>
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.zoneCaption}>
            <MaterialCommunityIcons name="road-variant" size={16} color={colors.accent} />
            <Text style={styles.zoneCaptionText}>
              Zone radius: {TIER_RADIUS_MILES[tier]} mi · {ridersInZone.length} nearby
            </Text>
          </View>

          <View style={[styles.mapWrap, elevation.raised]} onLayout={handleMapLayout}>
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
              <Circle
                cx={VIEWBOX_SIZE / 2}
                cy={VIEWBOX_SIZE / 2}
                r={VIEWBOX_SIZE * 0.425}
                fill="none"
                stroke={colors.accent}
                strokeWidth={1.5}
                strokeDasharray="5 6"
                opacity={0.5}
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
          </View>
        </>
      ) : (
        <HostPanel />
      )}

      <View style={styles.rideBarSlot}>
        <RideBar />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  switcher: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 4,
    gap: 4,
    marginBottom: spacing.md,
  },
  switcherOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  switcherOptionActive: { backgroundColor: colors.accent },
  switcherLabel: { ...type.caption, color: colors.textSecondary, fontWeight: '700' },
  switcherLabelActive: { color: colors.accentText },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSurface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { ...type.body, color: colors.danger, flex: 1 },
  zoneCaption: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  zoneCaptionText: { ...type.caption },
  mapWrap: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
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
  rideBarSlot: { marginTop: 'auto' },
});
