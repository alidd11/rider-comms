// Pure, presentational map markers used by MapScreen. Split out because
// they have no dependency on MapScreen's own state/hooks -- each takes its
// data as props and owns nothing beyond its own animation refs.
import * as React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Marker } from 'react-native-maps';
import type { HazardReport } from '@rider-comms/shared';
import { RIDE_LOCATION_REFRESH_MS } from '../ride/RideContext';
import { RiderAvatar } from '../components/RiderAvatar';
import type { RiderAvatarStatus } from '../components/RiderAvatar';
import { HazardMarkerIcon } from '../components/HazardIcon';
import { HAZARD_TYPE_META } from './HazardReportSheet';

export function bearingDegrees(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const toDeg = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const deltaLon = toRad(to.lon - from.lon);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function HazardMarker({
  hazard,
  selected,
  onPress,
}: {
  hazard: HazardReport;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const meta = HAZARD_TYPE_META[hazard.type];
  const size = selected ? 44 : 36;
  return (
    <Marker
      coordinate={{ latitude: hazard.lat, longitude: hazard.lon }}
      title={meta.label}
      description="Reported by a nearby rider"
      onPress={onPress}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={selected}
      zIndex={selected ? 12 : 6}
    >
      <View style={[styles.hazardMarker, { width: size, height: size }, selected && styles.hazardMarkerSelected]}>
        <HazardMarkerIcon type={hazard.type} size={size} selected={selected} />
      </View>
    </Marker>
  );
}

/**
 * Both of the marker components below glide toward each new fix over
 * `RIDE_LOCATION_REFRESH_MS` instead of snapping straight to it -- these
 * markers only ever move on a `rideLocations` poll tick that infrequent, so
 * without this a rider at speed visibly teleports ~200-300m across the map
 * every refresh instead of appearing to move continuously, the way Google
 * map apps read even though their own underlying position
 * source is just as infrequent.
 *
 * `coordinate` is intentionally set only once, from the component's own
 * initial mount value (`React.useState`'s lazy initializer runs exactly
 * once) -- react-native-maps animates position changes made through the
 * marker ref's imperative `animateMarkerToCoordinate`, but changing the
 * declarative `coordinate` prop itself still snaps instantly, which would
 * undo the glide. Remounting (a new `key` from the caller) is the only way
 * to reset a marker's start position, same as it already was before this
 * component existed.
 */
export function SmoothSelfMarker({
  location,
  avatarId,
  displayName,
  shareRideLocation,
  status,
}: {
  location: { lat: number; lon: number };
  avatarId: string;
  displayName: string;
  shareRideLocation: boolean;
  status: RiderAvatarStatus;
}): React.JSX.Element {
  const markerRef = React.useRef<React.ElementRef<typeof Marker> | null>(null);
  const hasMounted = React.useRef(false);
  const [initialCoordinate] = React.useState(() => ({ latitude: location.lat, longitude: location.lon }));

  React.useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    markerRef.current?.animateMarkerToCoordinate(
      { latitude: location.lat, longitude: location.lon },
      RIDE_LOCATION_REFRESH_MS,
    );
  }, [location.lat, location.lon]);

  return (
    <Marker
      ref={markerRef}
      coordinate={initialCoordinate}
      title={displayName || 'Your location'}
      description={shareRideLocation ? 'Your live group-ride location' : 'Your location'}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
    >
      <RiderAvatar avatarId={avatarId} size={44} mapMarker selected status={status} />
    </Marker>
  );
}

/**
 * The rider's own puck during turn-by-turn navigation. Each fix places it
 * (map-matched and predicted, see useInAppNavigation) and it glides to
 * where the rider will be when the next fix is due, so it keeps moving
 * between fixes instead of jumping.
 */
export function NavigationPuckMarker({
  now,
  target,
  glideMs,
  avatarId,
  displayName,
  description,
}: {
  now: { lat: number; lon: number };
  target: { lat: number; lon: number };
  glideMs: number;
  avatarId: string;
  displayName: string;
  description: string;
}): React.JSX.Element {
  const markerRef = React.useRef<React.ElementRef<typeof Marker> | null>(null);
  const [initialCoordinate] = React.useState(() => ({ latitude: now.lat, longitude: now.lon }));

  React.useEffect(() => {
    markerRef.current?.animateMarkerToCoordinate(
      { latitude: target.lat, longitude: target.lon },
      glideMs,
    );
  }, [glideMs, target.lat, target.lon]);

  return (
    <Marker
      ref={markerRef}
      coordinate={initialCoordinate}
      title={displayName || 'Your location'}
      description={description}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
    >
      <RiderAvatar avatarId={avatarId} size={64} mapMarker={false} selected status="none" />
    </Marker>
  );
}

// The pin's tail tip sits on the rider's location; the name hangs below it.
const MEMBER_AVATAR_HEIGHT = 40 * (72 / 64);
const MEMBER_LABEL_HEIGHT = 18;
const MEMBER_MARKER_ANCHOR = { x: 0.5, y: MEMBER_AVATAR_HEIGHT / (MEMBER_AVATAR_HEIGHT + 2 + MEMBER_LABEL_HEIGHT) };

export function SmoothRideMemberMarker({
  location,
  avatarId,
  displayName,
  status,
}: {
  location: { lat: number; lon: number };
  avatarId: string;
  displayName: string;
  status: RiderAvatarStatus;
}): React.JSX.Element {
  const markerRef = React.useRef<React.ElementRef<typeof Marker> | null>(null);
  const hasMounted = React.useRef(false);
  const [initialCoordinate] = React.useState(() => ({ latitude: location.lat, longitude: location.lon }));

  React.useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    markerRef.current?.animateMarkerToCoordinate(
      { latitude: location.lat, longitude: location.lon },
      RIDE_LOCATION_REFRESH_MS,
    );
  }, [location.lat, location.lon]);

  return (
    <Marker
      ref={markerRef}
      coordinate={initialCoordinate}
      title={displayName}
      description="Private ride member · live location"
      anchor={MEMBER_MARKER_ANCHOR}
      tracksViewChanges={false}
    >
      <View style={styles.memberMarker}>
        <RiderAvatar avatarId={avatarId} size={40} mapMarker status={status} groupRing />
        <View style={styles.memberLabel}>
          <Text style={styles.memberLabelText} numberOfLines={1}>{riderMapLabel(displayName)}</Text>
        </View>
      </View>
    </Marker>
  );
}

/** The name under a ride member's map marker (PWA: riderMapLabel). */
export function riderMapLabel(displayName: string): string {
  const first = String(displayName || '').trim().split(/\s+/)[0] || 'Rider';
  return first.length > 12 ? `${first.slice(0, 11)}…` : first;
}

const styles = StyleSheet.create({
  memberMarker: { alignItems: 'center' },
  memberLabel: {
    marginTop: 2,
    height: MEMBER_LABEL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(10,15,20,0.82)',
  },
  memberLabelText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  hazardMarker: { alignItems: 'center', justifyContent: 'center' },
  hazardMarkerSelected: {
    shadowColor: '#35D6FF',
    shadowOpacity: 0.9,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },
});
