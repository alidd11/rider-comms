// The public presence response intentionally returns rider IDs, not other
// riders' exact coordinates. The map therefore plots only coordinates the
// current rider is allowed to know: their own fix, selected destinations,
// aggregate hazard reports, and fresh private-ride coordinates explicitly
// shared by current ride members. Public nearby riders remain a count rather
// than being placed at invented bearings.
//
// Public map and private ride hosting share this one mounted screen. The
// bottom Map and Ride tabs switch the route's segment parameter rather than
// mounting a second map instance, which keeps map billing/state predictable
// and matches the PWA's tab-owned interaction model.
import * as React from 'react';
import { AccessibilityInfo, View, Text, Pressable, Alert, Linking, useColorScheme, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { haversineMiles } from '@rider-comms/shared';
import type { TabParamList } from '../navigation';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, MIN_TOUCH_TARGET } from '../theme';
import { NAVIGATION_SUMMARY_BASE_HEIGHT, styles } from './MapScreen.styles';
import { RideBar } from '../ride/RideBar';
import { useRide } from '../ride/RideContext';
import { ProximityVoice } from '../voice/ProximityVoice';
import { HostPanel } from '../ride/HostPanel';
import { useSettings } from '../settings/SettingsContext';
import { PlaceSearchBar } from './PlaceSearchBar';
import type { PlaceResult } from '../api/places';
import { HazardReportSheet } from './HazardReportSheet';
import { HazardDetailCard } from '../components/HazardDetailCard';
import { buildNavigationProviderUrl, navigationTargetFromValues, openNavigationUrl } from '../navigationLinks';
import type { NavigationTarget } from '../navigationLinks';
import { useMovementSafety } from '../safety/MovementSafetyContext';
import { navigationProviderLabel } from '../navigationPreference';
import {
  formatNavigationDistance,
  formatNavigationDuration,
  formatNavigationSpeed,
  navigationSpeedUnit,
} from '../navigationGuidance';
import { RiderAvatar } from '../components/RiderAvatar';
import { NavigationManeuverGlyph } from '../components/NavigationManeuverGlyph';
import { NavigationRoadAhead } from '../components/NavigationRoadAhead';
import { HazardMarker, SmoothSelfMarker, SmoothRideMemberMarker } from './mapMarkers';
import { useRideProfiles } from './useRideProfiles';
import { useHazardReports } from './useHazardReports';
import { useNavigationSummary } from './useNavigationSummary';
import { usePresence } from './usePresence';
import { useInAppNavigation } from './useInAppNavigation';

const RIDE_MARKER_REFRESH_MS = 10_000;
const RIDE_MARKER_STALE_MS = 20_000;
const DEFAULT_REGION = {
  latitude: 51.5074,
  longitude: -0.1278,
  latitudeDelta: 0.16,
  longitudeDelta: 0.16,
};
const FOCUSED_REGION_DELTA = 0.025;

type Segment = 'public' | 'host';

export function MapScreen(): React.JSX.Element {
  const colorScheme = useColorScheme();
  const { client, riderId } = useAuth();
  const { activeRide, rideLocations, roster, shareRideLocation } = useRide();
  const { shareLocation, setShareLocation, unitSystem, navigationProvider, avatarId, displayName } = useSettings();
  const { lockedForSafety, movementState, locationAccess, requestLocationAccess, openLocationSettings, refreshTracking } = useMovementSafety();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const route = useRoute<RouteProp<TabParamList, 'Map'>>();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList, 'Map'>>();
  const [segment, setSegment] = React.useState<Segment>(route.params?.segment ?? 'public');
  // "No location yet" (getCurrentLocation() failing — expected pre-GPS, see
  // the TODO on that stub above) is a normal, non-alarming state, not a
  // genuine error — kept separate from `error` so it renders with neutral
  // styling instead of the red/danger treatment reserved for real failures
  // (e.g. the presence API call itself failing below).
  const [locationUnavailable, setLocationUnavailable] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = React.useState<{ lat: number; lon: number } | null>(null);
  const currentLocationRef = React.useRef<{ lat: number; lon: number } | null>(null);
  const currentLocationAccuracyRef = React.useRef<number | null>(null);
  const [selectedPlace, setSelectedPlace] = React.useState<PlaceResult | null>(null);
  const [destinationEta, setDestinationEta] = React.useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const destinationEtaRequestId = React.useRef(0);
  const [navigationTarget, setNavigationTarget] = React.useState<NavigationTarget | null>(null);
  const [navigationBannerHeight, setNavigationBannerHeight] = React.useState(166);
  const [navigationSummaryHeight, setNavigationSummaryHeight] = React.useState(NAVIGATION_SUMMARY_BASE_HEIGHT);
  const [reduceMotionEnabled, setReduceMotionEnabled] = React.useState(false);
  const [mapReady, setMapReady] = React.useState(false);
  const rideProfiles = useRideProfiles(client, riderId, roster);
  const [markerNow, setMarkerNow] = React.useState(() => Date.now());
  const mapRef = React.useRef<MapView | null>(null);
  const centredOnFirstFix = React.useRef(false);

  React.useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotionEnabled(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotionEnabled);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  React.useEffect(() => {
    if (!rideLocations.length) return;
    setMarkerNow(Date.now());
    const timer = setInterval(() => setMarkerNow(Date.now()), RIDE_MARKER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [rideLocations.length]);

  const ownRideLocation = rideLocations.find((location) => location.riderId === riderId);

  const focusCoordinate = React.useCallback((target: { lat: number; lon: number }, delta = FOCUSED_REGION_DELTA) => {
    mapRef.current?.animateToRegion({
      latitude: target.lat,
      longitude: target.lon,
      latitudeDelta: delta,
      longitudeDelta: delta,
    }, 450);
  }, []);

  const requestCurrentLocation = React.useCallback(async (
    showSettingsPrompt = true,
    accuracy: Location.Accuracy = Location.Accuracy.Balanced,
    refreshMovementTracking = true,
  ): Promise<{ lat: number; lon: number; accuracyMeters: number; recordedAt: number } | null> => {
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
      const result = await Location.getCurrentPositionAsync({ accuracy });
      const next = {
        lat: result.coords.latitude,
        lon: result.coords.longitude,
        accuracyMeters: result.coords.accuracy ?? Number.POSITIVE_INFINITY,
        recordedAt: result.timestamp,
      };
      currentLocationAccuracyRef.current = next.accuracyMeters;
      setCurrentLocation(next);
      if (refreshMovementTracking) await refreshTracking();
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
    currentLocationRef.current = currentLocation;
  }, [currentLocation]);

  React.useEffect(() => {
    if (!mapReady || segment !== 'public' || !currentLocation || centredOnFirstFix.current || navigationTarget || selectedPlace) return;
    centredOnFirstFix.current = true;
    focusCoordinate(currentLocation);
  }, [currentLocation, focusCoordinate, mapReady, navigationTarget, segment, selectedPlace]);

  const { publicLive, ridersInZone, handleNearbyToggle } = usePresence(
    client,
    activeRide,
    shareLocation,
    setShareLocation,
    lockedForSafety,
    riderId,
    requestCurrentLocation,
    setLocationUnavailable,
    setError,
  );

  const hasCurrentLocation = currentLocation !== null;
  const requestCurrentLocationForHazardReport = React.useCallback(
    () => requestCurrentLocation(true),
    [requestCurrentLocation],
  );
  const {
    hazards,
    selectedHazardId,
    setSelectedHazardId,
    selectedHazard,
    reportSheetOpen,
    openReportSheet,
    closeReportSheet,
    handleReport,
    handleVote,
  } = useHazardReports(client, hasCurrentLocation, currentLocationRef, requestCurrentLocationForHazardReport);

  const {
    activeRoute,
    navigationDestination,
    navigationStepIndex,
    navigationLoading,
    navigationNotice,
    navigationMuted,
    setNavigationMuted,
    navigationFollowing,
    navigationSpeedMps,
    currentNavigationStep,
    fitRoute,
    focusNavigationCamera,
    finishInAppNavigation,
    startInAppNavigation,
    stopFollowingRoute,
    resumeFollowingRoute,
  } = useInAppNavigation(
    client,
    mapRef,
    mapReady,
    reduceMotionEnabled,
    insets,
    spacing,
    viewportHeight,
    navigationBannerHeight,
    navigationSummaryHeight,
    unitSystem,
    currentLocation,
    currentLocationAccuracyRef,
    requestCurrentLocation,
    setCurrentLocation,
    setSelectedPlace,
    setNavigationTarget,
    setSelectedHazardId,
  );

  // During turn-by-turn guidance the selected rider avatar must follow the
  // device's live high-accuracy fix, not the slower ride-location round trip.
  // Other riders still use the consented private-ride location feed below.
  const selfMapLocation = activeRoute && currentLocation
    ? currentLocation
    : ownRideLocation
      ? { lat: ownRideLocation.lat, lon: ownRideLocation.lon }
      : currentLocation;
  const ownRideLocationFresh = Boolean(
    ownRideLocation && markerNow - ownRideLocation.updatedAt <= RIDE_MARKER_STALE_MS,
  );
  const selfMapStatus = publicLive || (shareRideLocation && ownRideLocationFresh)
    ? 'online'
    : ownRideLocation && !ownRideLocationFresh
      ? 'stale'
      : 'none';

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

  const {
    upcomingNavigationStep,
    followingNavigationStep,
    navigationRoadAlerts,
    navigationGuidanceInstruction,
    navigationGlanceAction,
    distanceToCurrentStepEnd,
    remainingNavigationMeters,
    remainingNavigationSeconds,
  } = useNavigationSummary(
    activeRoute,
    navigationStepIndex,
    navigationDestination,
    currentLocation,
    navigationNotice,
    hazards,
    currentLocationAccuracyRef.current,
  );
  const visibleMapHazards = React.useMemo(() => {
    if (!activeRoute) return hazards;
    const visibleIds = new Set(navigationRoadAlerts.map((alert) => alert.hazard.id));
    if (selectedHazardId) visibleIds.add(selectedHazardId);
    return hazards.filter((hazard) => visibleIds.has(hazard.id));
  }, [activeRoute, hazards, navigationRoadAlerts, selectedHazardId]);

  const selectedDestination: NavigationTarget | null = navigationTarget ?? (selectedPlace
    ? { lat: selectedPlace.lat, lon: selectedPlace.lon, label: selectedPlace.name }
    : null);
  const selectedDestinationSubtitle = navigationTarget
    ? `${navigationTarget.lat.toFixed(5)}, ${navigationTarget.lon.toFixed(5)}`
    : selectedPlace?.address ?? '';
  const selectedDestinationProvider = navigationProvider === 'in_app'
    ? 'In Rider Comms'
    : `Open in ${navigationProviderLabel(navigationProvider)}`;

  React.useEffect(() => {
    navigation.setOptions({ tabBarStyle: activeRoute ? { display: 'none' } : undefined });
    return () => navigation.setOptions({ tabBarStyle: undefined });
  }, [activeRoute, navigation]);

  async function centreOnCurrentLocation(): Promise<void> {
    const location = currentLocation ?? await requestCurrentLocation(true);
    if (!location) return;
    if (activeRoute && currentNavigationStep) {
      resumeFollowingRoute();
      focusNavigationCamera(location, activeRoute, navigationStepIndex);
      return;
    }
    focusCoordinate(location);
  }

  function selectPlace(place: PlaceResult): void {
    setNavigationTarget(null);
    setSelectedHazardId(null);
    setSelectedPlace(place);
    focusCoordinate(place);
  }

  // A rider picking a destination could not previously tell how far or how
  // long the drive was until after committing to "Start route" -- fetch a
  // quick driving-time estimate for the destination card itself so that
  // decision can be made up front, same as Google/Waze/Apple Maps' own
  // place cards. currentLocationRef (not the state value) keeps this from
  // refetching on every GPS tick; the request id guards against a stale
  // response landing after the destination changed or was dismissed.
  React.useEffect(() => {
    if (!selectedDestination) {
      setDestinationEta(null);
      return;
    }
    const requestId = ++destinationEtaRequestId.current;
    const target = selectedDestination;
    setDestinationEta(null);
    (async () => {
      const origin = currentLocationRef.current ?? await requestCurrentLocation(true);
      if (!origin || requestId !== destinationEtaRequestId.current) return;
      try {
        const route = await client.getDrivingRoute({ lat: origin.lat, lon: origin.lon }, target);
        if (requestId === destinationEtaRequestId.current) {
          setDestinationEta({ distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds });
        }
      } catch {
        // Best-effort preview only; "Start route" surfaces a real error if
        // the route genuinely cannot be calculated.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDestination?.lat, selectedDestination?.lon, client]);

  async function openDirections(target: NavigationTarget): Promise<void> {
    if (navigationProvider === 'in_app') {
      await startInAppNavigation(target);
      return;
    }
    const url = buildNavigationProviderUrl(target, navigationProvider);
    if (!url) {
      Alert.alert('Location unavailable', 'This destination has invalid coordinates.');
      return;
    }
    if (!(await openNavigationUrl(url, Linking))) {
      Alert.alert('Couldn’t open directions', `Rider Comms could not open ${navigationProviderLabel(navigationProvider)} on this device.`);
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
            mapType="standard"
            userInterfaceStyle={colorScheme === 'dark' ? 'dark' : 'light'}
            showsCompass={false}
            showsMyLocationButton={false}
            showsTraffic={Boolean(activeRoute)}
            toolbarEnabled={false}
            rotateEnabled={Boolean(activeRoute)}
            pitchEnabled={Boolean(activeRoute)}
            onPanDrag={() => {
              if (!activeRoute) return;
              stopFollowingRoute();
            }}
            onMapReady={() => setMapReady(true)}
          >
            {selfMapLocation && (activeRoute ? (
              <Marker
                key={`self-rider-${avatarId}-nav`}
                coordinate={{ latitude: selfMapLocation.lat, longitude: selfMapLocation.lon }}
                title={displayName || 'Your location'}
                description={shareRideLocation ? 'Your live group-ride location' : 'Your location'}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <RiderAvatar avatarId={avatarId} size={64} mapMarker={false} selected status="none" />
              </Marker>
            ) : (
              // Turn-by-turn navigation already drives the marker above via
              // its own, more frequent watchPosition subscription tightly
              // coupled to the adaptive nav camera -- SmoothSelfMarker's own
              // independent glide would fight it, so this smoothed version
              // only ever renders outside of active navigation.
              <SmoothSelfMarker
                key={`self-rider-${avatarId}-${selfMapStatus}-map`}
                location={selfMapLocation}
                avatarId={avatarId}
                displayName={displayName}
                shareRideLocation={shareRideLocation}
                status={selfMapStatus}
              />
            ))}
            {rideLocations
              .filter((location) => location.riderId !== riderId)
              .map((location) => {
                const profile = rideProfiles[location.riderId];
                const fresh = markerNow - location.updatedAt <= RIDE_MARKER_STALE_MS;
                const markerStatus = fresh ? 'online' : 'stale';
                return (
                  <SmoothRideMemberMarker
                    key={`ride-location-${location.riderId}-${profile?.avatarId ?? 'ember'}-${markerStatus}`}
                    location={{ lat: location.lat, lon: location.lon }}
                    avatarId={profile?.avatarId ?? 'ember'}
                    displayName={profile?.displayName ?? 'Ride member'}
                    status={markerStatus}
                  />
                );
              })}
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
            {activeRoute && (
              <>
                <Polyline
                  coordinates={activeRoute.coordinates.map((coordinate) => ({ latitude: coordinate.lat, longitude: coordinate.lon }))}
                  strokeColor="#174EA6"
                  strokeWidth={10}
                />
                <Polyline
                  coordinates={activeRoute.coordinates.map((coordinate) => ({ latitude: coordinate.lat, longitude: coordinate.lon }))}
                  strokeColor="#4285F4"
                  strokeWidth={6}
                />
                {navigationDestination ? (
                  <Marker
                    coordinate={{ latitude: navigationDestination.lat, longitude: navigationDestination.lon }}
                    title={navigationDestination.label ? `Destination: ${navigationDestination.label}` : 'Route destination'}
                    anchor={{ x: 0.5, y: 0.92 }}
                    tracksViewChanges={false}
                  >
                    <View style={styles.navigationDestinationMarker}>
                      <MaterialCommunityIcons name="flag-checkered" size={23} color={colors.accentText} />
                    </View>
                  </Marker>
                ) : null}
              </>
            )}
            {visibleMapHazards.map((hazard) => (
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
        <View style={styles.hostFill}>
          <HostPanel />
        </View>
      )}

      {segment === 'public' && !lockedForSafety && !activeRoute && (
        <View style={[styles.searchSlot, { top: insets.top + spacing.sm }]}>
          <PlaceSearchBar
            near={currentLocation}
            onRequestLocation={async () => { await requestCurrentLocation(true); }}
            onSelect={selectPlace}
          />
        </View>
      )}

      {segment === 'public' && !activeRoute && ridersInZone.length > 0 && !selectedPlace && !selectedHazard && !locationUnavailable && !error && (
        <View style={[styles.nearbyCount, { top: insets.top + spacing.sm + MIN_TOUCH_TARGET + spacing.sm }]}>
          <MaterialCommunityIcons name="account-multiple" size={16} color={colors.accent} />
          <Text style={styles.nearbyCountText}>
            {ridersInZone.length} {ridersInZone.length === 1 ? 'rider' : 'riders'} nearby · exact locations private
          </Text>
        </View>
      )}


      {segment === 'public' && !selectedDestination && !activeRoute && (
        <View style={[styles.mapActions, { bottom: insets.bottom + spacing.sm }]}>
          {!lockedForSafety && <Pressable
            style={styles.mapActionButton}
            onPress={() => void openReportSheet()}
            accessibilityRole="button"
            accessibilityLabel="Report on the road"
          >
            <MaterialCommunityIcons name="alert-plus" size={24} color={colors.textPrimary} />
          </Pressable>}
          <Pressable
            style={styles.mapActionButton}
            onPress={() => void centreOnCurrentLocation()}
            accessibilityRole="button"
            accessibilityLabel="Centre map on my location"
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={24} color={colors.accent} />
          </Pressable>
          <Pressable
            style={[styles.mapActionButton, publicLive && styles.mapActionButtonActive]}
            onPress={() => void handleNearbyToggle()}
            accessibilityRole="button"
            accessibilityState={{ selected: publicLive }}
            accessibilityLabel={publicLive ? 'Stop live location and proximity voice' : 'Go live nearby and enable proximity voice'}
          >
            <Ionicons name="people" size={24} color={publicLive ? colors.accentText : colors.accent} />
          </Pressable>
        </View>
      )}

      {activeRoute && currentNavigationStep && (
        <View style={[styles.navigationActions, { bottom: navigationSummaryHeight + spacing.md }]}>
          {!lockedForSafety && (
            <Pressable
              style={styles.navigationActionButton}
              onPress={() => void openReportSheet()}
              accessibilityRole="button"
              accessibilityLabel="Report on the road"
            >
              <MaterialCommunityIcons name="alert-plus" size={24} color={colors.textPrimary} />
            </Pressable>
          )}
          <Pressable
            style={[styles.navigationActionButton, navigationMuted && styles.navigationActionButtonActive]}
            onPress={() => setNavigationMuted((current) => !current)}
            accessibilityRole="button"
            accessibilityState={{ selected: navigationMuted }}
            accessibilityLabel={navigationMuted ? 'Unmute navigation guidance' : 'Mute navigation guidance'}
          >
            <Ionicons name={navigationMuted ? 'volume-mute' : 'volume-high'} size={24} color={navigationMuted ? colors.accentText : colors.textPrimary} />
          </Pressable>
          <Pressable
            style={[styles.navigationActionButton, !navigationFollowing && styles.navigationActionButtonActive]}
            onPress={() => {
              if (navigationFollowing) fitRoute(activeRoute);
              else void centreOnCurrentLocation();
            }}
            accessibilityRole="button"
            accessibilityLabel={navigationFollowing ? 'Show route overview' : 'Resume navigation follow mode'}
          >
            <Ionicons
              name={navigationFollowing ? 'map-outline' : 'navigate'}
              size={24}
              color={navigationFollowing ? colors.textPrimary : colors.accentText}
            />
          </Pressable>
        </View>
      )}

      <HazardReportSheet
        visible={reportSheetOpen}
        onClose={closeReportSheet}
        onReport={handleReport}
      />

      {segment === 'public' && !activeRoute && selectedHazard && (
        <HazardDetailCard
          hazard={selectedHazard}
          bottomInset={insets.bottom + spacing.sm}
          onDismiss={() => setSelectedHazardId(null)}
          onVote={handleVote}
        />
      )}

      {segment === 'public' && !activeRoute && selectedDestination && !selectedHazard && (
        <View style={[styles.destinationCard, { bottom: insets.bottom + spacing.sm }]} accessibilityLiveRegion="polite">
          <View style={styles.destinationCardHead}>
            <View style={styles.destinationCardIcon}>
              <Ionicons name="location" size={20} color={colors.accent} />
            </View>
            <View style={styles.destinationCardCopy}>
              <Text numberOfLines={2} style={styles.destinationCardTitle}>
                {selectedDestination.label ?? 'Selected place'}
              </Text>
              <Text numberOfLines={2} style={styles.destinationCardCoords}>{selectedDestinationSubtitle}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss destination"
              style={styles.destinationCardDismiss}
              onPress={() => {
                setNavigationTarget(null);
                setSelectedPlace(null);
              }}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.destinationCardEta}>
            <Ionicons name="map-outline" size={15} color={colors.accent} />
            <Text style={styles.destinationCardEtaText}>
              {destinationEta
                ? `${formatNavigationDistance(destinationEta.distanceMeters, unitSystem)} · ${formatNavigationDuration(destinationEta.durationSeconds)}`
                : 'Calculating route…'}
            </Text>
          </View>
          <Pressable
            style={styles.destinationPrimaryAction}
            accessibilityRole="button"
            accessibilityLabel={`Start route to ${selectedDestination.label ?? 'selected place'}`}
            onPress={() => void openDirections(selectedDestination)}
            disabled={navigationLoading}
          >
            <Ionicons name="navigate" size={18} color={colors.accentText} />
            <View>
              <Text style={styles.destinationPrimaryTitle}>{navigationLoading ? 'Starting…' : 'Start route'}</Text>
              <Text style={styles.destinationPrimarySubtitle}>{selectedDestinationProvider}</Text>
            </View>
          </Pressable>
        </View>
      )}

      {activeRoute && currentNavigationStep && (
        <>
          <View
            style={[styles.navigationBanner, { top: insets.top + spacing.sm }]}
            onLayout={(event) => {
              const measuredHeight = Math.ceil(event.nativeEvent.layout.height);
              setNavigationBannerHeight((current) => Math.abs(current - measuredHeight) > 1 ? measuredHeight : current);
            }}
          >
            <View style={styles.navigationBannerMain}>
              <View style={styles.navigationManeuver}>
                <NavigationManeuverGlyph
                  maneuver={upcomingNavigationStep?.maneuver ?? 'arrive'}
                  size={66}
                  color={colors.textPrimary}
                  secondaryColor={colors.textMuted}
                />
              </View>
              <View style={styles.navigationBannerCopy}>
                <Text style={styles.navigationDistance}>{formatNavigationDistance(distanceToCurrentStepEnd, unitSystem)}</Text>
                <Text
                  numberOfLines={1}
                  style={styles.navigationInstruction}
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={navigationGuidanceInstruction}
                >
                  {navigationGlanceAction}
                </Text>
                <Text numberOfLines={1} accessible={false} style={styles.navigationProviderInstruction}>
                  {navigationGuidanceInstruction}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="End navigation" onPress={() => finishInAppNavigation(false)} style={styles.navigationEndButton}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
            {followingNavigationStep ? (
              <View style={styles.navigationNextPreview}>
                <View style={styles.navigationNextGlyph}>
                  <NavigationManeuverGlyph
                    maneuver={followingNavigationStep.maneuver}
                    size={30}
                    color={colors.textSecondary}
                    secondaryColor={colors.textMuted}
                  />
                </View>
                <Text style={styles.navigationNextLabel}>Then</Text>
                <Text numberOfLines={1} style={styles.navigationNextInstruction}>{followingNavigationStep.instruction}</Text>
              </View>
            ) : null}
            <NavigationRoadAhead alerts={navigationRoadAlerts} unit={unitSystem} />
            {navigationNotice ? (
              <View style={styles.navigationNoticeRow}>
                <Ionicons name="warning-outline" size={16} color={colors.warning} />
                <Text style={styles.navigationNotice}>{navigationNotice}</Text>
              </View>
            ) : null}
          </View>
          <View
            style={[
              styles.navigationSpeedBadge,
              { top: insets.top + spacing.sm + navigationBannerHeight + spacing.sm },
            ]}
            accessible
            accessibilityLabel={navigationSpeedMps == null
              ? 'Current speed unavailable'
              : `Current speed ${formatNavigationSpeed(navigationSpeedMps, unitSystem)} ${navigationSpeedUnit(unitSystem)}`}
          >
            <Text style={styles.navigationSpeedBadgeValue}>{formatNavigationSpeed(navigationSpeedMps, unitSystem)}</Text>
            <Text style={styles.navigationSpeedBadgeUnit}>{navigationSpeedUnit(unitSystem)}</Text>
          </View>
          <View
            style={[styles.navigationSummary, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}
            onLayout={(event) => {
              const measuredHeight = Math.ceil(event.nativeEvent.layout.height);
              setNavigationSummaryHeight((current) => Math.abs(current - measuredHeight) > 1 ? measuredHeight : current);
            }}
          >
            <View style={styles.navigationSummaryHandle} />
            <View style={styles.navigationSummaryContent}>
              <View style={styles.navigationSummaryPrimary}>
                <Text style={styles.navigationArrival}>{new Date(Date.now() + remainingNavigationSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
                <Text style={styles.navigationSummaryLabel}>arrival</Text>
              </View>
              <View style={styles.navigationSummaryDivider} />
              <View style={styles.navigationSummaryStat}>
                <Text style={styles.navigationSummaryValue}>{formatNavigationDuration(remainingNavigationSeconds)}</Text>
                <Text style={styles.navigationSummaryLabel}>left</Text>
              </View>
              <View style={styles.navigationSummaryDivider} />
              <View style={styles.navigationSummaryStat}>
                <Text style={styles.navigationSummaryValue}>{formatNavigationDistance(remainingNavigationMeters, unitSystem)}</Text>
                <Text style={styles.navigationSummaryLabel}>away</Text>
              </View>
            </View>
          </View>
        </>
      )}

      {!activeRoute && (lockedForSafety || movementState === 'unknown') && (
        <View
          style={[styles.safetyBanner, { top: insets.top + spacing.sm + (segment === 'public' ? MIN_TOUCH_TARGET + spacing.sm : 0) }]}
          accessibilityLiveRegion="polite"
        >
          <MaterialCommunityIcons name="motorbike" size={20} color={colors.accent} />
          <View style={styles.safetyBannerCopy}>
            <Text style={styles.safetyBannerTitle}>Ride-safe mode</Text>
            <Text style={styles.safetyBannerText}>
              {movementState === 'moving'
                ? 'Distracting controls are locked until you are safely below 8 mph.'
                : 'Waiting for a reliable speed fix. Controls stay available.'}
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
        <RideBar controlsVisible={!activeRoute} />
      </View>
      <ProximityVoice enabled={publicLive} peerIds={ridersInZone} />
    </View>
  );
}
