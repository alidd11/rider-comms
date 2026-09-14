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
import * as React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Rect, Circle, Line, Defs, RadialGradient, Stop } from 'react-native-svg';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';
import { RiderCommsClient } from '../api/client';
import { API_BASE_URL } from '../config';
import { colors, spacing, radii, type, elevation } from '../theme';
import { RideBar } from '../ride/RideBar';
import { useSettings } from '../settings/SettingsContext';

const PRESENCE_UPDATE_INTERVAL_MS = 8000; // per spec Section 8: every 5-10s
const MAP_SIZE = 320;
const CENTER = MAP_SIZE / 2;

// TODO(native): replace with expo-location's getCurrentPositionAsync().
async function getCurrentLocation(): Promise<{ lat: number; lon: number }> {
  throw new Error('getCurrentLocation() requires expo-location (not available in this sandbox)');
}

function ridersOnCircle(riders: string[]): Array<{ id: string; x: number; y: number }> {
  const orbitRadius = CENTER * 0.6;
  return riders.map((id, index) => {
    const angle = (index / Math.max(riders.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { id, x: CENTER + orbitRadius * Math.cos(angle), y: CENTER + orbitRadius * Math.sin(angle) };
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

export function MapScreen(): React.JSX.Element {
  const { zoneTier: tier } = useSettings();
  const [ridersInZone, setRidersInZone] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedRider, setSelectedRider] = React.useState<string | null>(null);

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

  const pins = ridersOnCircle(ridersInZone);

  function toggleSelected(id: string) {
    setSelectedRider((current) => (current === id ? null : id));
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="road-variant" size={20} color={colors.accent} />
        <Text style={styles.title}>Zone radius: {TIER_RADIUS_MILES[tier]} mi</Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={[styles.mapWrap, elevation.raised]}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}>
          <Defs>
            <RadialGradient id="ground" cx="50%" cy="45%" r="75%">
              <Stop offset="0%" stopColor={colors.surfaceRaised} />
              <Stop offset="100%" stopColor={colors.asphalt} />
            </RadialGradient>
          </Defs>
          <Rect width={MAP_SIZE} height={MAP_SIZE} fill="url(#ground)" />
          {/* Open road, not a city grid — this is a touring app, not a taxi app. */}
          <Line x1={-20} y1={MAP_SIZE * 0.72} x2={MAP_SIZE + 20} y2={MAP_SIZE * 0.2} stroke={colors.border} strokeWidth={46} strokeLinecap="round" />
          <Line
            x1={-20}
            y1={MAP_SIZE * 0.72}
            x2={MAP_SIZE + 20}
            y2={MAP_SIZE * 0.2}
            stroke={colors.laneLine}
            strokeWidth={2}
            strokeDasharray="10 12"
          />
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={CENTER * 0.85}
            fill="none"
            stroke={colors.accent}
            strokeWidth={1.5}
            strokeDasharray="5 6"
            opacity={0.5}
          />
        </Svg>

        <MapPin x={CENTER} y={CENTER} you />
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

      <View style={styles.rosterHeader}>
        <Text style={styles.rosterLabel}>{ridersInZone.length} nearby</Text>
      </View>
      {ridersInZone.length === 0 ? (
        <Text style={styles.emptyText}>No one in your zone right now.</Text>
      ) : (
        ridersInZone.map((id) => (
          <Pressable
            key={id}
            style={[styles.riderRow, selectedRider === id && styles.riderRowSelected]}
            onPress={() => toggleSelected(id)}
          >
            <View style={[styles.riderAvatar, selectedRider === id && styles.riderAvatarSelected]}>
              <MaterialCommunityIcons
                name="motorbike"
                size={16}
                color={selectedRider === id ? colors.accentText : colors.textPrimary}
              />
            </View>
            <Text style={styles.riderName}>{id}</Text>
          </Pressable>
        ))
      )}

      <View style={styles.rideBarSlot}>
        <RideBar />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  title: { ...type.heading },
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
  mapWrap: {
    height: 260,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    backgroundColor: colors.asphalt,
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
  rosterHeader: { marginBottom: spacing.sm },
  rosterLabel: { ...type.caption },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  riderRowSelected: { backgroundColor: colors.surfaceRaised, borderBottomColor: colors.surfaceRaised },
  riderAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderAvatarSelected: { backgroundColor: colors.accent },
  riderName: { ...type.body, color: colors.textPrimary },
  emptyText: { ...type.caption, textAlign: 'center', marginTop: spacing.lg },
  rideBarSlot: { marginTop: 'auto' },
});
