// The public presence response intentionally returns rider IDs, not other
// riders' exact coordinates. The map therefore plots only coordinates the
// current rider is allowed to know: their own fix, selected destinations and
// aggregate hazard reports. Nearby riders remain a count rather than being
// placed at invented bearings.
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
import { View, Text, Pressable, StyleSheet, Alert, Linking, Platform } from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { haversineMiles } from '@rider-comms/shared';
import type { HazardReport, HazardType } from '@rider-comms/shared';
import type { TabParamList } from '../navigation';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { RideBar } from '../ride/RideBar';
import { HostPanel } from '../ride/HostPanel';
import { useSettings } from '../settings/SettingsContext';
import { PlaceSearchBar } from './PlaceSearchBar';
import type { PlaceResult } from '../api/places';
import { HazardReportSheet, HAZARD_TYPE_META } from './HazardReportSheet';
import { buildExternalNavigationUrl, navigationTargetFromValues } from '../navigationLinks';
import type { NavigationTarget } from '../navigationLinks';
import { useMovementSafety } from '../safety/MovementSafetyContext';

const PRESENCE_UPDATE_INTERVAL_MS = 8000; // per spec Section 8: every 5-10s
const DEFAULT_REGION = {
  latitude: 51.5074,
  longitude: -0.1278,
  latitudeDelta: 0.16,
  longitudeDelta: 0.16,
};
const FOCUSED_REGION_DELTA = 0.025;

type Segment = 'public' | 'host';

function HazardMarker({
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
      tracksViewChanges={selected}
    >
      <View style={[styles.hazardBadge, { width: size, height: size, borderRadius: size / 2, backgroundColor: meta.color }, selected && styles.pinBadgeSelected]}>
        <MaterialCommunityIcons name={meta.icon} size={size * 0.6} color={colors.accentText} />
      </View>
    </Marker>
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

export function MapScreen(): React.JSX.Element {
  const { client } = useAuth();
  const { shareLocation } = useSettings();
  const { lockedForSafety, movementState, locationAccess, requestLocationAccess, openLocationSettings, refreshTracking } = useMovementSafety();
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
  const [currentLocation, setCurrentLocation] = React.useState<{ lat: number; lon: number } | null>(null);
  const [selectedPlace, setSelectedPlace] = React.useState<PlaceResult | null>(null);
  const [hazards, setHazards] = React.useState<HazardReport[]>([]);
  const [selectedHazardId, setSelectedHazardId] = React.useState<string | null>(null);
  const [reportSheetOpen, setReportSheetOpen] = React.useState(false);
  const [navigationTarget, setNavigationTarget] = React.useState<NavigationTarget | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const mapRef = React.useRef<MapView | null>(null);
  const centredOnFirstFix = React.useRef(false);

  const focusCoordinate = React.useCallback((target: { lat: number; lon: number }, delta = FOCUSED_REGION_DELTA) => {
    mapRef.current?.animateToRegion({
      latitude: target.lat,
      longitude: target.lon,
      latitudeDelta: delta,
      longitudeDelta: delta,
    }, 450);
  }, []);

  const requestCurrentLocation = React.useCallback(async (showSettingsPrompt = true): Promise<{ lat: number; lon: number; accuracyMeters: number; recordedAt: number } | null> => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationUnavailable(true);
        if (!permission.canAskAgain && showSettingsPrompt) {
          Alert.alert(
            'Location is blocked',
            'Allow location in your device settings to search nearby and use location-based map tools. Your position stays private unless sharing is enabled.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => void Linking.openSettings() },
            ]
          );
        }
        return null;
      }
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const next = {
        lat: result.coords.latitude,
        lon: result.coords.longitude,
        accuracyMeters: result.coords.accuracy ?? Number.POSITIVE_INFINITY,
        recordedAt: result.timestamp,
      };
      setCurrentLocation(next);
      await refreshTracking();
      setLocationUnavailable(false);
      return next;
    } catch {
      setLocationUnavailable(true);
      return null;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void Location.getForegroundPermissionsAsync().then((permission) => {
      if (!cancelled && permission.granted) void requestCurrentLocation(false);
    });
    return () => { cancelled = true; };
  }, [requestCurrentLocation]);

  React.useEffect(() => {
    if (!mapReady || segment !== 'public' || !currentLocation || centredOnFirstFix.current || navigationTarget || selectedPlace) return;
    centredOnFirstFix.current = true;
    focusCoordinate(currentLocation);
  }, [currentLocation, focusCoordinate, mapReady, navigationTarget, segment, selectedPlace]);

  React.useEffect(() => {
    if (!shareLocation) {
      setRidersInZone([]);
      void client.leavePresence();
      return;
    }
    let cancelled = false;

    async function tick() {
      const location = await requestCurrentLocation(false);
      if (!location || cancelled) return;
      const { lat, lon, accuracyMeters, recordedAt } = location;
      try {
        const { inZoneWith } = await client.updatePresence(lat, lon, accuracyMeters, recordedAt);
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
      void client.leavePresence();
    };
  }, [client, requestCurrentLocation, shareLocation]);

  // Nearby hazard reports poll independently of the presence tick above —
  // they're visible whether or not the rider is sharing their own location
  // publicly (shareLocation only gates *being seen*, not *seeing others'
  // reports*), so this only needs a location fix to exist, not shareLocation.
  React.useEffect(() => {
    if (!currentLocation) { setHazards([]); return; }
    let cancelled = false;
    async function fetchHazards() {
      try {
        const { hazards: fetched } = await client.getNearbyHazards(currentLocation!.lat, currentLocation!.lon);
        if (!cancelled) setHazards(fetched);
      } catch {
        // Nearby hazards are a secondary layer on top of the core map —
        // a failure here doesn't need its own error banner.
      }
    }
    fetchHazards();
    const interval = setInterval(fetchHazards, PRESENCE_UPDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [client, currentLocation]);

  async function handleReport(hazardType: HazardType) {
    setReportSheetOpen(false);
    if (!currentLocation) return;
    try {
      const created = await client.createHazard(hazardType, currentLocation.lat, currentLocation.lon);
      setHazards((current) => [...current, created]);
    } catch {
      // Reporting is best-effort from the rider's point of view — a failed
      // report simply doesn't appear, no separate error UI for this yet.
    }
  }

  async function handleVote(hazardId: string, direction: 'confirm' | 'deny') {
    try {
      if (direction === 'confirm') await client.confirmHazard(hazardId);
      else await client.denyHazard(hazardId);
      setHazards((current) =>
        current.map((h) =>
          h.id === hazardId
            ? { ...h, confirmations: h.confirmations + (direction === 'confirm' ? 1 : 0), denials: h.denials + (direction === 'deny' ? 1 : 0) }
            : h
        )
      );
    } catch {
      // Best-effort, same as handleReport above.
    }
    setSelectedHazardId(null);
  }

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

  React.useEffect(() => {
    const target = navigationTargetFromValues(
      route.params?.lat,
      route.params?.lon,
      route.params?.label
    );
    setNavigationTarget(target);
    if (target) {
      setSegment('public');
      setSelectedPlace(null);
    }
  }, [route.params?.at, route.params?.label, route.params?.lat, route.params?.lon]);

  React.useEffect(() => {
    if (!mapReady || segment !== 'public') return;
    const target = navigationTarget ?? selectedPlace;
    if (target) focusCoordinate(target);
  }, [focusCoordinate, mapReady, navigationTarget, segment, selectedPlace]);

  const selectedHazard = hazards.find((h) => h.id === selectedHazardId) ?? null;

  async function centreOnCurrentLocation(): Promise<void> {
    const location = currentLocation ?? await requestCurrentLocation(true);
    if (location) focusCoordinate(location);
  }

  function selectPlace(place: PlaceResult): void {
    setNavigationTarget(null);
    setSelectedHazardId(null);
    setSelectedPlace(place);
    focusCoordinate(place);
  }

  async function openReportSheet(): Promise<void> {
    const location = currentLocation ?? await requestCurrentLocation(true);
    if (!location) {
      Alert.alert('Location needed', 'Allow location while using Rider Comms before reporting a road hazard.');
      return;
    }
    setReportSheetOpen(true);
  }

  async function openDirections(target: NavigationTarget): Promise<void> {
    const url = buildExternalNavigationUrl(target, Platform.OS === 'ios' ? 'ios' : 'android');
    if (!url) {
      Alert.alert('Location unavailable', 'This destination has invalid coordinates.');
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Couldn’t open directions', 'No compatible maps or navigation app could open this destination.');
    }
  }

  return (
    <View style={styles.container}>
      {segment === 'public' || lockedForSafety ? (
        <View style={styles.mapFill}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={DEFAULT_REGION}
            loadingEnabled
            loadingBackgroundColor={colors.background}
            loadingIndicatorColor={colors.accent}
            showsCompass={false}
            showsMyLocationButton={false}
            toolbarEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            onMapReady={() => setMapReady(true)}
          >
            {currentLocation && (
              <Marker
                coordinate={{ latitude: currentLocation.lat, longitude: currentLocation.lon }}
                title="Your location"
                pinColor={colors.accent}
              />
            )}
            {navigationTarget && (
              <Marker
                coordinate={{ latitude: navigationTarget.lat, longitude: navigationTarget.lon }}
                title={navigationTarget.label ?? 'Shared destination'}
                pinColor={colors.accent}
              />
            )}
            {selectedPlace && (
              <Marker
                coordinate={{ latitude: selectedPlace.lat, longitude: selectedPlace.lon }}
                title={selectedPlace.name}
                description={selectedPlace.address}
                pinColor={colors.accent}
              />
            )}
            {hazards.map((hazard) => (
              <HazardMarker
                key={hazard.id}
                hazard={hazard}
                selected={selectedHazardId === hazard.id}
                onPress={() => setSelectedHazardId((current) => (current === hazard.id ? null : hazard.id))}
              />
            ))}
          </MapView>
        </View>
      ) : (
        <View style={[styles.hostFill, { paddingTop: insets.top + spacing.xxl }]}>
          <HostPanel />
        </View>
      )}

      {segment === 'public' && !lockedForSafety && (
        <View style={[styles.searchSlot, { top: insets.top + spacing.sm }]}>
          <PlaceSearchBar
            near={currentLocation}
            onRequestLocation={async () => { await requestCurrentLocation(true); }}
            onSelect={selectPlace}
          />
        </View>
      )}

      {segment === 'public' && ridersInZone.length > 0 && !selectedPlace && !selectedHazard && !locationUnavailable && !error && (
        <View style={[styles.nearbyCount, { top: insets.top + spacing.sm + MIN_TOUCH_TARGET + spacing.sm }]}>
          <MaterialCommunityIcons name="account-multiple" size={16} color={colors.accent} />
          <Text style={styles.nearbyCountText}>
            {ridersInZone.length} {ridersInZone.length === 1 ? 'rider' : 'riders'} nearby · exact locations private
          </Text>
        </View>
      )}

      {segment === 'public' && selectedPlace && (
        <View style={[styles.errorOverlay, { top: insets.top + spacing.sm + MIN_TOUCH_TARGET * 0.8 + spacing.sm }]} pointerEvents="box-none">
          <View style={styles.noticeBox}>
            <Ionicons name="location" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedPlaceName}>{selectedPlace.name}</Text>
              <Text numberOfLines={1} style={styles.noticeSubtext}>{selectedPlace.address}</Text>
              <Pressable
                style={styles.directionsButton}
                onPress={() => void openDirections({ lat: selectedPlace.lat, lon: selectedPlace.lon, label: selectedPlace.name })}
                accessibilityRole="button"
                accessibilityLabel={`Get directions to ${selectedPlace.name}`}
              >
                <Ionicons name="navigate" size={15} color="#FFFFFF" />
                <Text style={styles.directionsButtonText}>Open directions</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setSelectedPlace(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
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

      {segment === 'public' && selectedHazard && !lockedForSafety && (
        <View style={[styles.errorOverlay, { top: insets.top + spacing.sm + MIN_TOUCH_TARGET * 0.8 + spacing.sm }]} pointerEvents="box-none">
          <View style={styles.noticeBox}>
            <MaterialCommunityIcons
              name={HAZARD_TYPE_META[selectedHazard.type].icon}
              size={18}
              color={HAZARD_TYPE_META[selectedHazard.type].color}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedPlaceName}>{HAZARD_TYPE_META[selectedHazard.type].label}</Text>
              <Text style={styles.noticeSubtext}>
                {currentLocation
                  ? `${haversineMiles(currentLocation, { lat: selectedHazard.lat, lon: selectedHazard.lon }).toFixed(1)} mi away`
                  : 'Reported by a nearby rider'}
              </Text>
              <View style={styles.hazardCardRow}>
                <Pressable style={styles.hazardVoteButton} onPress={() => handleVote(selectedHazard.id, 'confirm')}>
                  <Ionicons name="checkmark" size={14} color={colors.success} />
                  <Text style={styles.hazardVoteText}>Still there ({selectedHazard.confirmations})</Text>
                </Pressable>
                <Pressable style={styles.hazardVoteButton} onPress={() => handleVote(selectedHazard.id, 'deny')}>
                  <Ionicons name="close" size={14} color={colors.danger} />
                  <Text style={styles.hazardVoteText}>Gone ({selectedHazard.denials})</Text>
                </Pressable>
              </View>
            </View>
            <Pressable onPress={() => setSelectedHazardId(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
      )}

      {segment === 'public' && !navigationTarget && (
        <View style={[styles.mapActions, { bottom: insets.bottom + spacing.sm }]}>
          <Pressable
            style={styles.mapActionButton}
            onPress={() => void centreOnCurrentLocation()}
            accessibilityRole="button"
            accessibilityLabel="Centre map on my location"
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={22} color={colors.accent} />
          </Pressable>
          {!lockedForSafety && <Pressable
            style={styles.mapActionButton}
            onPress={() => void openReportSheet()}
            accessibilityRole="button"
            accessibilityLabel="Report on the road"
          >
            <MaterialCommunityIcons name="alert-plus" size={22} color={colors.textPrimary} />
          </Pressable>}
        </View>
      )}

      <HazardReportSheet visible={reportSheetOpen} onClose={() => setReportSheetOpen(false)} onReport={handleReport} />

      {segment === 'public' && navigationTarget && (
        <View style={styles.destinationCard} accessibilityLiveRegion="polite">
          <View style={styles.destinationCardIcon}>
            <Ionicons name="navigate" size={18} color={colors.accent} />
          </View>
          <View style={styles.destinationCardCopy}>
            <Text numberOfLines={1} style={styles.destinationCardTitle}>
              {navigationTarget.label ?? 'Shared destination'}
            </Text>
            <Text style={styles.destinationCardCoords}>
              {navigationTarget.lat.toFixed(5)}, {navigationTarget.lon.toFixed(5)}
            </Text>
          </View>
          <Pressable
            style={styles.destinationStartButton}
            accessibilityRole="button"
            accessibilityLabel={`Get directions to ${navigationTarget.label ?? 'shared destination'}`}
            onPress={() => void openDirections(navigationTarget)}
          >
            <Ionicons name="navigate" size={16} color="#FFFFFF" />
            <Text style={styles.destinationStartText}>Directions</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss shared destination"
            hitSlop={8}
            onPress={() => setNavigationTarget(null)}
          >
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}

      {!lockedForSafety && <SegmentToggle segment={segment} onChange={setSegment} topInset={insets.top} />}

      {lockedForSafety && (
        <View style={[styles.safetyBanner, { top: insets.top + spacing.sm }]} accessibilityLiveRegion="polite">
          <MaterialCommunityIcons name="motorbike" size={20} color={colors.accent} />
          <View style={styles.safetyBannerCopy}>
            <Text style={styles.safetyBannerTitle}>Ride-safe mode</Text>
            <Text style={styles.safetyBannerText}>
              {movementState === 'moving' ? 'Distracting controls are locked until you stop.' : 'Waiting for a reliable stationary location fix.'}
            </Text>
          </View>
          {movementState !== 'moving' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={locationAccess === 'blocked' || locationAccess === 'services_disabled' ? 'Open location settings' : 'Enable location'}
              style={styles.safetyEnableButton}
              onPress={() => void (locationAccess === 'blocked' || locationAccess === 'services_disabled' ? openLocationSettings() : requestLocationAccess())}
            >
              <Text style={styles.safetyEnableText}>{locationAccess === 'blocked' || locationAccess === 'services_disabled' ? 'Settings' : 'Enable'}</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.rideBarSlot} pointerEvents="box-none">
        <RideBar />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapFill: { flex: 1 },
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
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
  selectedPlaceName: { ...type.body, color: colors.textPrimary, fontWeight: '700' },
  noticeSubtext: { ...type.caption, marginTop: spacing.xs },
  directionsButton: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    minHeight: 36, marginTop: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: radii.pill, backgroundColor: colors.accent,
  },
  directionsButtonText: { ...type.caption, color: '#FFFFFF', fontWeight: '800' },
  searchSlot: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.xxl + spacing.md,
    zIndex: 9,
  },
  sideToggle: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.sm,
    gap: spacing.xs,
  },
  sideToggleButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.raised,
  },
  sideToggleButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pinBadgeSelected: { borderColor: colors.accent, backgroundColor: colors.accentPressed },
  hazardBadge: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.background },
  mapActions: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    gap: spacing.sm,
  },
  mapActionButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...elevation.raised,
  },
  nearbyCount: {
    position: 'absolute',
    left: spacing.lg,
    maxWidth: '72%',
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...elevation.raised,
  },
  nearbyCountText: { ...type.caption, color: colors.textSecondary, fontWeight: '700', flexShrink: 1 },
  hazardCardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  hazardVoteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
  },
  hazardVoteText: { ...type.caption, color: colors.textPrimary, fontWeight: '700' },
  destinationCard: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...elevation.raised,
  },
  destinationCardIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  destinationCardCopy: { minWidth: 0, flex: 1 },
  destinationCardTitle: { ...type.label, color: colors.textPrimary },
  destinationCardCoords: { ...type.caption, color: colors.textSecondary, marginTop: 2 },
  destinationStartButton: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.accent,
  },
  destinationStartText: { ...type.caption, color: '#FFFFFF', fontWeight: '800' },
  rideBarSlot: { marginTop: 'auto', paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  safetyBanner: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    ...elevation.raised,
  },
  safetyBannerCopy: { flex: 1 },
  safetyBannerTitle: { ...type.label, color: colors.textPrimary },
  safetyBannerText: { ...type.caption, color: colors.textSecondary, marginTop: 2 },
  safetyEnableButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.accent },
  safetyEnableText: { ...type.caption, color: colors.accentText, fontWeight: '800' },
});
