// Pure, presentational map markers used by MapScreen. Split out because
// they have no dependency on MapScreen's own state/hooks -- each takes its
// data as props and owns nothing beyond its own animation refs.
import * as React from 'react';
import { View, StyleSheet } from 'react-native';
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
  const size = selected ? 32 : 26;
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
 * Maps/Waze/Apple Maps read even though their own underlying position
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
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
    >
      <RiderAvatar avatarId={avatarId} size={40} mapMarker status={status} />
    </Marker>
  );
}

const styles = StyleSheet.create({
  hazardMarker: { alignItems: 'center', justifyContent: 'center' },
  hazardMarkerSelected: {
    shadowColor: '#35D6FF',
    shadowOpacity: 0.9,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },
});
