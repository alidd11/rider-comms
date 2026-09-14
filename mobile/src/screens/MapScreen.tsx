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
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Circle, Line } from 'react-native-svg';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';
import type { ZoneTier } from '@rider-comms/shared';
import { RiderCommsClient } from '../api/client';
import { API_BASE_URL } from '../config';
import { colors, spacing, radii, type } from '../theme';
import { RideBar } from '../ride/RideBar';

const PRESENCE_UPDATE_INTERVAL_MS = 8000; // per spec Section 8: every 5-10s
const MAP_SIZE = 320;
const CENTER = MAP_SIZE / 2;

// TODO(native): replace with expo-location's getCurrentPositionAsync().
async function getCurrentLocation(): Promise<{ lat: number; lon: number }> {
  throw new Error('getCurrentLocation() requires expo-location (not available in this sandbox)');
}

function ridersOnCircle(riders: string[]): Array<{ id: string; x: number; y: number }> {
  const orbitRadius = CENTER * 0.62;
  return riders.map((id, index) => {
    const angle = (index / Math.max(riders.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return { id, x: CENTER + orbitRadius * Math.cos(angle), y: CENTER + orbitRadius * Math.sin(angle) };
  });
}

function MapPin({ x, y, you = false }: { x: number; y: number; you?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.pinWrap, { left: x - 13, top: y - 30 }]}>
      <Ionicons name="location" size={30} color={you ? colors.accent : colors.textPrimary} />
    </View>
  );
}

export function MapScreen(): React.JSX.Element {
  const [tier, setTier] = React.useState<ZoneTier>('free');
  const [ridersInZone, setRidersInZone] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="radio" size={20} color={colors.accent} />
        <Text style={styles.title}>Zone radius: {TIER_RADIUS_MILES[tier]} mi</Text>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.mapWrap}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}>
          <Rect width={MAP_SIZE} height={MAP_SIZE} fill={colors.background} />
          <Line x1={0} y1={70} x2={MAP_SIZE} y2={55} stroke={colors.surfaceRaised} strokeWidth={10} />
          <Line x1={0} y1={180} x2={MAP_SIZE} y2={195} stroke={colors.surfaceRaised} strokeWidth={10} />
          <Line x1={0} y1={260} x2={MAP_SIZE} y2={275} stroke={colors.surfaceRaised} strokeWidth={10} />
          <Line x1={60} y1={0} x2={45} y2={MAP_SIZE} stroke={colors.surfaceRaised} strokeWidth={10} />
          <Line x1={215} y1={0} x2={230} y2={MAP_SIZE} stroke={colors.surfaceRaised} strokeWidth={10} />
          <Circle
            cx={CENTER}
            cy={CENTER}
            r={CENTER * 0.85}
            fill="none"
            stroke={colors.accent}
            strokeWidth={1.5}
            strokeDasharray="5 6"
            opacity={0.55}
          />
        </Svg>
        <MapPin x={CENTER} y={CENTER} you />
        {pins.map((pin) => (
          <MapPin key={pin.id} x={pin.x} y={pin.y} />
        ))}
      </View>

      <View style={styles.rosterHeader}>
        <Text style={styles.rosterLabel}>{ridersInZone.length} nearby</Text>
      </View>
      {ridersInZone.length === 0 ? (
        <Text style={styles.emptyText}>No one in your zone right now.</Text>
      ) : (
        ridersInZone.map((id) => (
          <View key={id} style={styles.riderRow}>
            <View style={styles.riderAvatar}>
              <Ionicons name="person" size={16} color={colors.textPrimary} />
            </View>
            <Text style={styles.riderName}>{id}</Text>
          </View>
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
  },
  pinWrap: { position: 'absolute' },
  rosterHeader: { marginBottom: spacing.sm },
  rosterLabel: { ...type.caption },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  riderAvatar: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderName: { ...type.body, color: colors.textPrimary },
  emptyText: { ...type.caption, textAlign: 'center', marginTop: spacing.lg },
  rideBarSlot: { marginTop: 'auto' },
});
