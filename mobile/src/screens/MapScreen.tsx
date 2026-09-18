// The public presence response intentionally returns rider IDs, not other
// riders' exact coordinates. The map therefore plots only coordinates the
// current rider is allowed to know: their own fix, selected destinations,
// aggregate hazard reports, and fresh private-ride coordinates explicitly
// shared by current ride members. Public nearby riders remain a count rather
// than being placed at invented bearings.
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
import MapView, { Marker, Polyline } from 'react-native-maps';
import { haversineMiles } from '@rider-comms/shared';
import type { HazardReport, HazardType } from '@rider-comms/shared';
import type { TabParamList } from '../navigation';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, radii, type, elevation, MIN_TOUCH_TARGET } from '../theme';
import { RideBar } from '../ride/RideBar';
import { useRide } from '../ride/RideContext';
import { ProximityVoice } from '../voice/ProximityVoice';
import { HostPanel } from '../ride/HostPanel';
import { useSettings } from '../settings/SettingsContext';
import { PlaceSearchBar } from './PlaceSearchBar';
import type { PlaceResult } from '../api/places';
import { HazardReportSheet, HAZARD_TYPE_META } from './HazardReportSheet';
import { buildNavigationProviderUrl, navigationTargetFromValues, openNavigationUrl } from '../navigationLinks';
import type { NavigationTarget } from '../navigationLinks';
import { useMovementSafety } from '../safety/MovementSafetyContext';
import { GOOGLE_DIRECTIONS_API_KEY } from '../config';
import {
  distanceToSegmentMeters,
  fetchDrivingRoute,
  metersBetween,
  type InAppNavigationRoute,
} from '../api/directions';
import { navigationProviderLabel } from '../navigationPreference';
import { formatNavigationDistance, maneuverIcon } from '../navigationGuidance';
import {
  NAV_GPS_CHECK_INTERVAL_MS,
  NavigationGpsTracker,
  isNavigationGpsNotice,
  navigationGpsNotice,
} from '../navigationGpsHealth';
import { speakNavigationPrompt, stopNavigationPrompt } from '../audio/navigationSpeech';

const PRESENCE_UPDATE_INTERVAL_MS = 8000; // per spec Section 8: every 5-10s
const DEFAULT_REGION = {
  latitude: 51.5074,
  longitude: -0.1278,
  latitudeDelta: 0.16,
  longitudeDelta: 0.16,
};
const FOCUSED_REGION_DELTA = 0.025;
const NAV_STEP_ARRIVAL_RADIUS_M = 30;
const NAV_OFF_ROUTE_RADIUS_M = 60;
const NAV_OFF_ROUTE_GRACE_MS = 10_000;

function formatNavigationDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

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
  const { client, riderId } = useAuth();
  const { rideLocations } = useRide();
  const { shareLocation, unitSystem, navigationProvider } = useSettings();
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
  const [activeRoute, setActiveRoute] = React.useState<InAppNavigationRoute | null>(null);
  const [navigationDestination, setNavigationDestination] = React.useState<NavigationTarget | null>(null);
  const [navigationStepIndex, setNavigationStepIndex] = React.useState(0);
  const [navigationLoading, setNavigationLoading] = React.useState(false);
  const [navigationNotice, setNavigationNotice] = React.useState<string | null>(null);
  const navOffRouteSince = React.useRef<number | null>(null);
  const navRerouting = React.useRef(false);
  const navGpsTracker = React.useRef(new NavigationGpsTracker());
  const announcedNavigationStep = React.useRef<{ route: InAppNavigationRoute; index: number } | null>(null);
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
  const currentNavigationStep = activeRoute?.steps[navigationStepIndex] ?? null;
  const nextNavigationStep = activeRoute?.steps[navigationStepIndex + 1] ?? null;
  const remainingNavigationMeters = activeRoute
    ? activeRoute.steps.slice(navigationStepIndex).reduce((sum, step) => sum + step.distanceMeters, 0)
    : 0;
  const remainingNavigationSeconds = activeRoute
    ? activeRoute.steps.slice(navigationStepIndex).reduce((sum, step) => sum + step.durationSeconds, 0)
    : 0;
  const distanceToCurrentStepEnd = currentNavigationStep && currentLocation
    ? metersBetween(currentLocation, currentNavigationStep.end)
    : currentNavigationStep?.distanceMeters ?? 0;

  const fitRoute = React.useCallback((nextRoute: InAppNavigationRoute) => {
    if (!mapReady || nextRoute.coordinates.length < 2) return;
    mapRef.current?.fitToCoordinates(
      nextRoute.coordinates.map((coordinate) => ({ latitude: coordinate.lat, longitude: coordinate.lon })),
      { edgePadding: { top: 150, right: 56, bottom: 180, left: 56 }, animated: true }
    );
  }, [mapReady]);

  const finishInAppNavigation = React.useCallback((arrived = false) => {
    setActiveRoute(null);
    setNavigationDestination(null);
    setNavigationStepIndex(0);
    announcedNavigationStep.current = null;
    navOffRouteSince.current = null;
    navRerouting.current = false;
    navGpsTracker.current.reset();
    setNavigationNotice(arrived ? 'You have arrived.' : null);
    void stopNavigationPrompt().finally(() => {
      if (arrived) speakNavigationPrompt('You have arrived at your destination.');
    });
  }, []);

  const requestInAppRoute = React.useCallback(async (origin: { lat: number; lon: number }, target: NavigationTarget, rerouting = false) => {
    if (!GOOGLE_DIRECTIONS_API_KEY) throw new Error('directions_not_configured');
    if (rerouting) navRerouting.current = true;
    try {
      const nextRoute = await fetchDrivingRoute(origin, target, GOOGLE_DIRECTIONS_API_KEY);
      setActiveRoute(nextRoute);
      setNavigationDestination(target);
      setNavigationStepIndex(0);
      setNavigationNotice(rerouting ? 'Route updated.' : null);
      navOffRouteSince.current = null;
      fitRoute(nextRoute);
    } finally {
      if (rerouting) navRerouting.current = false;
    }
  }, [fitRoute]);

  async function startInAppNavigation(target: NavigationTarget): Promise<void> {
    const origin = currentLocation ?? await requestCurrentLocation(true);
    if (!origin) return;
    setNavigationLoading(true);
    setNavigationNotice(null);
    try {
      await requestInAppRoute({ lat: origin.lat, lon: origin.lon }, target);
      setSelectedPlace(null);
      setNavigationTarget(null);
      setSelectedHazardId(null);
    } catch (routeError) {
      const message = routeError instanceof Error && routeError.message === 'directions_not_configured'
        ? 'In-app navigation is not configured for this build yet. Choose Google Maps, Waze or Apple Maps in Settings.'
        : routeError instanceof Error && routeError.message === 'directions_no_route'
          ? 'No driving route was found for that destination.'
          : 'Rider Comms could not calculate that route. Try again or choose another navigation app.';
      Alert.alert('Couldn’t start navigation', message);
    } finally {
      setNavigationLoading(false);
    }
  }

  React.useEffect(() => {
    if (!activeRoute || !currentNavigationStep) return;
    const last = announcedNavigationStep.current;
    if (last?.route === activeRoute && last.index === navigationStepIndex) return;
    announcedNavigationStep.current = { route: activeRoute, index: navigationStepIndex };
    speakNavigationPrompt(currentNavigationStep.instruction);
  }, [activeRoute, currentNavigationStep, navigationStepIndex]);

  React.useEffect(() => {
    return () => {
      void stopNavigationPrompt();
    };
  }, []);

  React.useEffect(() => {
    if (!activeRoute) {
      navGpsTracker.current.reset();
      return;
    }

    navGpsTracker.current.begin();
    const timer = setInterval(() => {
      const notice = navigationGpsNotice(navGpsTracker.current.stateAt());
      if (!notice) return;
      navOffRouteSince.current = null;
      setNavigationNotice(notice);
    }, NAV_GPS_CHECK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [activeRoute]);

  React.useEffect(() => {
    if (!activeRoute || !navigationDestination || !currentNavigationStep) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 },
      (position) => {
        if (cancelled) return;
        const recovered = navGpsTracker.current.recordFix();
        if (recovered) {
          setNavigationNotice((current) => isNavigationGpsNotice(current) ? null : current);
        }
        const here = { lat: position.coords.latitude, lon: position.coords.longitude };
        setCurrentLocation(here);
        focusCoordinate(here, 0.012);

        if (
          navigationStepIndex === activeRoute.steps.length - 1 &&
          metersBetween(here, currentNavigationStep.end) <= NAV_STEP_ARRIVAL_RADIUS_M
        ) {
          finishInAppNavigation(true);
          return;
        }

        let effectiveIndex = navigationStepIndex;
        while (effectiveIndex < activeRoute.steps.length - 1) {
          const step = activeRoute.steps[effectiveIndex]!;
          const nextStep = activeRoute.steps[effectiveIndex + 1]!;
          const reachedStepEnd = metersBetween(here, step.end) <= NAV_STEP_ARRIVAL_RADIUS_M;
          const alreadyOnNextStep = distanceToSegmentMeters(here, nextStep.start, nextStep.end) <= NAV_STEP_ARRIVAL_RADIUS_M * 1.5;
          if (!reachedStepEnd && !alreadyOnNextStep) break;
          effectiveIndex += 1;
        }
        if (effectiveIndex !== navigationStepIndex) {
          setNavigationStepIndex(effectiveIndex);
        }

        const effectiveStep = activeRoute.steps[effectiveIndex]!;
        const distanceOffRoute = distanceToSegmentMeters(here, effectiveStep.start, effectiveStep.end);
        if (distanceOffRoute <= NAV_OFF_ROUTE_RADIUS_M) {
          navOffRouteSince.current = null;
          return;
        }

        if (!navOffRouteSince.current) {
          navOffRouteSince.current = Date.now();
          return;
        }
        if (Date.now() - navOffRouteSince.current < NAV_OFF_ROUTE_GRACE_MS || navRerouting.current) return;

        navOffRouteSince.current = null;
        setNavigationNotice('Rerouting…');
        speakNavigationPrompt('Rerouting.');
        void requestInAppRoute(here, navigationDestination, true).catch(() => {
          setNavigationNotice('Could not reroute. Continue with caution.');
        });
      }
    ).then((value) => {
      if (cancelled) value.remove();
      else subscription = value;
    }).catch(async () => {
      if (cancelled) return;
      const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
      const health = navGpsTracker.current.markUnavailable(permission?.granted === false);
      navOffRouteSince.current = null;
      setNavigationNotice(navigationGpsNotice(health));
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [activeRoute, currentNavigationStep, finishInAppNavigation, focusCoordinate, navigationDestination, navigationStepIndex, requestInAppRoute]);

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
            {rideLocations
              .filter((location) => location.riderId !== riderId)
              .map((location) => (
                <Marker
                  key={`ride-location-${location.riderId}`}
                  coordinate={{ latitude: location.lat, longitude: location.lon }}
                  title={location.riderId}
                  description="Private ride member · live location"
                  pinColor={colors.success}
                />
              ))}
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
              <Polyline
                coordinates={activeRoute.coordinates.map((coordinate) => ({ latitude: coordinate.lat, longitude: coordinate.lon }))}
                strokeColor={colors.accent}
                strokeWidth={6}
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

      {segment === 'public' && !activeRoute && selectedPlace && (
        <View style={[styles.errorOverlay, { top: insets.top + spacing.sm + MIN_TOUCH_TARGET * 0.8 + spacing.sm }]} pointerEvents="box-none">
          <View style={styles.noticeBox}>
            <Ionicons name="location" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.selectedPlaceName}>{selectedPlace.name}</Text>
              <Text numberOfLines={1} style={styles.noticeSubtext}>{selectedPlace.address}</Text>
              <Pressable
                style={styles.directionsButton}
                onPress={() => void openDirections({ lat: selectedPlace.lat, lon: selectedPlace.lon, label: selectedPlace.name })}
                disabled={navigationLoading}
                accessibilityRole="button"
                accessibilityLabel={`Get directions to ${selectedPlace.name}`}
              >
                <Ionicons name="navigate" size={15} color="#FFFFFF" />
                <Text style={styles.directionsButtonText}>{navigationLoading ? 'Starting…' : navigationProvider === 'in_app' ? 'Start in Rider Comms' : navigationProviderLabel(navigationProvider)}</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setSelectedPlace(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
      )}

      {segment === 'public' && !activeRoute && locationUnavailable && (
        <View style={[styles.errorOverlay, { top: insets.top + spacing.lg }]} pointerEvents="box-none">
          <View style={styles.noticeBox}>
            <Ionicons name="location-outline" size={18} color={colors.textMuted} />
            <Text style={styles.noticeText}>Location unavailable — see Settings to enable it</Text>
          </View>
        </View>
      )}

      {segment === 'public' && !activeRoute && error && (
        <View style={[styles.errorOverlay, { top: insets.top + spacing.lg }]} pointerEvents="box-none">
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        </View>
      )}

      {segment === 'public' && !activeRoute && selectedHazard && !lockedForSafety && (
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
            disabled={navigationLoading}
          >
            <Ionicons name="navigate" size={16} color="#FFFFFF" />
            <Text style={styles.destinationStartText}>{navigationLoading ? 'Starting…' : navigationProvider === 'in_app' ? 'Start' : navigationProviderLabel(navigationProvider)}</Text>
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

      {activeRoute && currentNavigationStep && (
        <>
          <View style={[styles.navigationBanner, { top: insets.top + spacing.sm }]} accessibilityLiveRegion="polite">
            <View style={styles.navigationManeuver}>
              <Ionicons
                name={maneuverIcon(currentNavigationStep.maneuver) as keyof typeof Ionicons.glyphMap}
                size={24}
                color={colors.accentText}
              />
            </View>
            <View style={styles.navigationBannerCopy}>
              <Text style={styles.navigationDistance}>{formatNavigationDistance(distanceToCurrentStepEnd, unitSystem)}</Text>
              <Text numberOfLines={2} style={styles.navigationInstruction}>{currentNavigationStep.instruction}</Text>
              {nextNavigationStep ? (
                <View style={styles.navigationNextRow}>
                  <Text style={styles.navigationNextLabel}>THEN</Text>
                  <Text numberOfLines={1} style={styles.navigationNextInstruction}>{nextNavigationStep.instruction}</Text>
                </View>
              ) : null}
              {navigationNotice ? <Text style={styles.navigationNotice}>{navigationNotice}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="End navigation" onPress={() => finishInAppNavigation(false)} style={styles.navigationEndButton}>
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={[styles.navigationSummary, { bottom: insets.bottom + spacing.sm }]}>
            <View style={styles.navigationSummaryPrimary}>
              <Text style={styles.navigationArrival}>{new Date(Date.now() + remainingNavigationSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
              <Text style={styles.navigationSummaryLabel}>arrival</Text>
            </View>
            <View>
              <Text style={styles.navigationSummaryValue}>{formatNavigationDuration(remainingNavigationSeconds)}</Text>
              <Text style={styles.navigationSummaryLabel}>left</Text>
            </View>
            <View>
              <Text style={styles.navigationSummaryValue}>{formatNavigationDistance(remainingNavigationMeters, unitSystem)}</Text>
              <Text style={styles.navigationSummaryLabel}>away</Text>
            </View>
          </View>
        </>
      )}

      {!lockedForSafety && !activeRoute && <SegmentToggle segment={segment} onChange={setSegment} topInset={insets.top} />}

      {!activeRoute && (lockedForSafety || movementState === 'unknown') && (
        <View style={[styles.safetyBanner, { top: insets.top + spacing.sm }]} accessibilityLiveRegion="polite">
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
      <ProximityVoice enabled={shareLocation && ridersInZone.length > 0} />
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
  navigationBanner: {
    position: 'absolute', left: spacing.md, right: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, borderRadius: radii.lg,
    backgroundColor: '#101011', borderWidth: 1, borderColor: colors.border,
    ...elevation.raised,
  },
  navigationManeuver: {
    width: 48, height: 48, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
  },
  navigationBannerCopy: { flex: 1, minWidth: 0 },
  navigationDistance: { ...type.subheading, color: colors.textPrimary },
  navigationInstruction: { ...type.body, color: colors.textPrimary, marginTop: 2, fontWeight: '700' },
  navigationNextRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  navigationNextLabel: { ...type.caption, color: colors.textMuted, fontWeight: '800' },
  navigationNextInstruction: { ...type.caption, color: colors.textSecondary, flex: 1 },
  navigationNotice: { ...type.caption, color: colors.textSecondary, marginTop: spacing.xs },
  navigationEndButton: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, borderRadius: radii.pill,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised,
  },
  navigationSummary: {
    position: 'absolute', left: spacing.md, right: spacing.md,
    minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radii.lg, backgroundColor: '#101011', borderWidth: 1, borderColor: colors.border,
    ...elevation.raised,
  },
  navigationSummaryPrimary: { minWidth: 84 },
  navigationArrival: { ...type.heading, color: colors.textPrimary, fontSize: 24 },
  navigationSummaryValue: { ...type.subheading, color: colors.textPrimary, textAlign: 'center' },
  navigationSummaryLabel: { ...type.caption, color: colors.textMuted, textAlign: 'center' },
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
