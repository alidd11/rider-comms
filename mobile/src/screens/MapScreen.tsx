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
import { AccessibilityInfo, View, Text, Pressable, StyleSheet, Alert, Linking, useColorScheme, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
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
import type { PublicRiderProfile } from '../api/client';
import { HazardReportSheet, HAZARD_TYPE_META } from './HazardReportSheet';
import { buildNavigationProviderUrl, navigationTargetFromValues, openNavigationUrl } from '../navigationLinks';
import type { NavigationTarget } from '../navigationLinks';
import { useMovementSafety } from '../safety/MovementSafetyContext';
import { GOOGLE_DIRECTIONS_API_KEY } from '../config';
import {
  distanceToPathMeters,
  distanceToSegmentMeters,
  fetchDrivingRoute,
  lookAheadCoordinateOnPath,
  metersBetween,
  remainingDistanceOnPathMeters,
  type InAppNavigationRoute,
} from '../api/directions';
import { navigationProviderLabel } from '../navigationPreference';
import {
  formatNavigationDistance,
  formatNavigationSpeed,
  navigationPromptStageForDistance,
  navigationPromptText,
  navigationSpeedUnit,
} from '../navigationGuidance';
import {
  combineNavigationCameraPaths,
  navigationCameraProfile,
  navigationViewportBias,
  stabilizeNavigationHeading,
} from '../navigationCamera';
import {
  NAV_GPS_CHECK_INTERVAL_MS,
  NavigationGpsTracker,
  isNavigationGpsNotice,
  navigationGpsNotice,
} from '../navigationGpsHealth';
import { speakNavigationPrompt, stopNavigationPrompt } from '../audio/navigationSpeech';
import { microphoneErrorMessage, preflightVoiceMicrophone } from '../audio/microphone';
import { RiderAvatar } from '../components/RiderAvatar';
import { NavigationManeuverGlyph } from '../components/NavigationManeuverGlyph';

const PRESENCE_UPDATE_INTERVAL_MS = 8000; // per spec Section 8: every 5-10s
const RIDE_MARKER_REFRESH_MS = 10_000;
const RIDE_MARKER_STALE_MS = 20_000;
const RIDE_AVATAR_REFRESH_MS = 30_000;
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
const NAVIGATION_SUMMARY_BASE_HEIGHT = 104;

function bearingDegrees(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const toDeg = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const deltaLon = toRad(to.lon - from.lon);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

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

export function MapScreen(): React.JSX.Element {
  const colorScheme = useColorScheme();
  const { client, riderId } = useAuth();
  const { rideLocations, roster, shareRideLocation } = useRide();
  const { shareLocation, setShareLocation, unitSystem, navigationProvider, avatarId, displayName } = useSettings();
  const { lockedForSafety, movementState, locationAccess, requestLocationAccess, openLocationSettings, refreshTracking } = useMovementSafety();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const route = useRoute<RouteProp<TabParamList, 'Map'>>();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList, 'Map'>>();
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
  const [navigationMuted, setNavigationMuted] = React.useState(false);
  const [navigationFollowing, setNavigationFollowing] = React.useState(true);
  const [navigationSpeedMps, setNavigationSpeedMps] = React.useState<number | null>(null);
  const [navigationSummaryHeight, setNavigationSummaryHeight] = React.useState(NAVIGATION_SUMMARY_BASE_HEIGHT);
  const [reduceMotionEnabled, setReduceMotionEnabled] = React.useState(false);
  const navOffRouteSince = React.useRef<number | null>(null);
  const navRerouting = React.useRef(false);
  const navigationFollowingRef = React.useRef(true);
  const navigationCameraHeading = React.useRef<number | null>(null);
  const navGpsTracker = React.useRef(new NavigationGpsTracker());
  const announcedNavigationStep = React.useRef<{ route: InAppNavigationRoute; index: number } | null>(null);
  const navigationPromptProgress = React.useRef<{ route: InAppNavigationRoute; targetIndex: number; stage: number } | null>(null);
  const finalNavigationPrompt = React.useRef<{ route: InAppNavigationRoute; index: number } | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [rideProfiles, setRideProfiles] = React.useState<Record<string, PublicRiderProfile>>({});
  const [markerNow, setMarkerNow] = React.useState(() => Date.now());
  const mapRef = React.useRef<MapView | null>(null);
  const centredOnFirstFix = React.useRef(false);

  const rideRosterKey = React.useMemo(() => roster.slice().sort().join('|'), [roster]);

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
    let cancelled = false;
    const ids = roster.filter((id) => id !== riderId);

    if (!ids.length) {
      setRideProfiles({});
      return () => { cancelled = true; };
    }

    const refresh = async () => {
      const entries = await Promise.all(ids.map(async (id) => {
        try {
          return [id, await client.getPublicProfile(id)] as const;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      setRideProfiles(Object.fromEntries(entries.filter((entry): entry is readonly [string, PublicRiderProfile] => entry !== null)));
    };

    void refresh();
    // Ride locations themselves refresh every 10 seconds. Profile identity
    // changes are lower urgency, but still reconcile during a live ride so a
    // newly selected avatar appears without leaving/rejoining.
    const timer = setInterval(refresh, RIDE_AVATAR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, riderId, rideRosterKey]);

  React.useEffect(() => {
    if (!rideLocations.length) return;
    setMarkerNow(Date.now());
    const timer = setInterval(() => setMarkerNow(Date.now()), RIDE_MARKER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [rideLocations.length]);

  const ownRideLocation = rideLocations.find((location) => location.riderId === riderId);
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
  const selfMapStatus = shareLocation || (shareRideLocation && ownRideLocationFresh)
    ? 'online'
    : ownRideLocation && !ownRideLocationFresh
      ? 'stale'
      : 'none';

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
      // Nearby Voice authorisation is capped at <=100 m accuracy by the
      // backend. Ask for a high-accuracy fix while live so an otherwise valid
      // two-rider test is not rejected just because the generic map fix used
      // the lower-power Balanced mode.
      const location = await requestCurrentLocation(false, Location.Accuracy.High, false);
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

  const handleNearbyToggle = React.useCallback(async () => {
    if (shareLocation) {
      setShareLocation(false);
      return;
    }
    if (lockedForSafety) {
      Alert.alert('Nearby Voice unavailable while moving', 'Stop safely before joining Nearby Voice. You can always leave or mute an active voice session while riding.');
      return;
    }
    try {
      await preflightVoiceMicrophone();
    } catch (microphoneError) {
      Alert.alert('Microphone unavailable', microphoneErrorMessage(microphoneError));
      return;
    }

    try {
      // The presence endpoint refuses a fix until the durable profile says
      // shareLocation=true. Confirm that backend write BEFORE flipping the
      // local setting; otherwise the presence effect can race the queued
      // SettingsContext save and fail the first Go Live with a 403.
      await client.updateProfile(riderId, { shareLocation: true });
      setShareLocation(true);
    } catch {
      Alert.alert(
        'Nearby Voice unavailable',
        'Rider Comms could not enable Nearby Voice on the server. Check your connection and try again.',
      );
    }
  }, [client, lockedForSafety, riderId, setShareLocation, shareLocation]);

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
  const upcomingNavigationStep = activeRoute?.steps[navigationStepIndex + 1] ?? null;
  const followingNavigationStep = activeRoute?.steps[navigationStepIndex + 2] ?? null;
  const navigationGuidanceInstruction = upcomingNavigationStep?.instruction
    ?? `Arrive at ${navigationDestination?.label ?? 'destination'}`;
  const distanceToCurrentStepEnd = currentNavigationStep && currentLocation
    ? remainingDistanceOnPathMeters(currentLocation, currentNavigationStep.coordinates)
    : currentNavigationStep?.distanceMeters ?? 0;
  const laterNavigationSteps = activeRoute?.steps.slice(navigationStepIndex + 1) ?? [];
  const remainingNavigationMeters = currentNavigationStep
    ? distanceToCurrentStepEnd + laterNavigationSteps.reduce((sum, step) => sum + step.distanceMeters, 0)
    : 0;
  const currentStepTimeRatio = currentNavigationStep?.distanceMeters
    ? Math.max(0, Math.min(1, distanceToCurrentStepEnd / currentNavigationStep.distanceMeters))
    : 0;
  const remainingNavigationSeconds = currentNavigationStep
    ? currentNavigationStep.durationSeconds * currentStepTimeRatio
      + laterNavigationSteps.reduce((sum, step) => sum + step.durationSeconds, 0)
    : 0;

  const selectedDestination: NavigationTarget | null = navigationTarget ?? (selectedPlace
    ? { lat: selectedPlace.lat, lon: selectedPlace.lon, label: selectedPlace.name }
    : null);
  const selectedDestinationSubtitle = navigationTarget
    ? `${navigationTarget.lat.toFixed(5)}, ${navigationTarget.lon.toFixed(5)}`
    : selectedPlace?.address ?? '';
  const selectedDestinationProvider = navigationProvider === 'in_app'
    ? 'In Rider Comms'
    : `Open in ${navigationProviderLabel(navigationProvider)}`;

  const fitRoute = React.useCallback((nextRoute: InAppNavigationRoute) => {
    if (!mapReady || nextRoute.coordinates.length < 2) return;
    navigationFollowingRef.current = false;
    setNavigationFollowing(false);
    navigationCameraHeading.current = null;
    mapRef.current?.fitToCoordinates(
      nextRoute.coordinates.map((coordinate) => ({ latitude: coordinate.lat, longitude: coordinate.lon })),
      { edgePadding: { top: 170, right: 64, bottom: 180, left: 64 }, animated: true }
    );
    mapRef.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 250 });
  }, [mapReady]);

  const focusNavigationCamera = React.useCallback((
    here: { lat: number; lon: number },
    routeForCamera: InAppNavigationRoute,
    stepIndex: number,
    gpsHeading?: number | null,
    speedMps?: number | null,
  ) => {
    const step = routeForCamera.steps[stepIndex];
    if (!step || step.coordinates.length === 0) return;

    const upcomingStep = routeForCamera.steps[stepIndex + 1];
    const followingStep = routeForCamera.steps[stepIndex + 2];
    const cameraPath = combineNavigationCameraPaths(
      step.coordinates,
      upcomingStep?.coordinates,
      followingStep?.coordinates,
    );
    if (cameraPath.length === 0) return;

    const maneuverDistance = remainingDistanceOnPathMeters(here, step.coordinates);
    const topOcclusion = insets.top + 136 + (followingStep ? 48 : 0) + (navigationNotice ? 36 : 0);
    const bottomOcclusion = Math.max(insets.bottom, spacing.sm) + 112;
    const viewportBias = navigationViewportBias(viewportHeight, topOcclusion, bottomOcclusion);
    const profile = navigationCameraProfile({
      speedMps,
      maneuverDistanceMeters: maneuverDistance,
      maneuver: upcomingStep?.maneuver,
      viewportBias,
    });

    const headingTarget = lookAheadCoordinateOnPath(
      here,
      cameraPath,
      Math.min(70, Math.max(35, profile.lookAheadMeters * 0.35)),
    );
    const routeHeading = bearingDegrees(here, headingTarget);
    const movingSpeed = Number.isFinite(speedMps) ? Number(speedMps) : null;
    const candidateHeading = movingSpeed !== null
      && movingSpeed > 2.5
      && Number.isFinite(gpsHeading)
      && (gpsHeading ?? -1) >= 0
      ? Number(gpsHeading)
      : routeHeading;
    const heading = stabilizeNavigationHeading(
      navigationCameraHeading.current,
      candidateHeading,
      movingSpeed,
    );
    navigationCameraHeading.current = heading;

    if (!mapReady || !navigationFollowingRef.current) return;
    const centre = lookAheadCoordinateOnPath(here, cameraPath, profile.centreAheadMeters);
    const camera = {
      center: { latitude: centre.lat, longitude: centre.lon },
      heading,
      pitch: profile.pitch,
      zoom: profile.zoom,
    };
    if (reduceMotionEnabled) {
      mapRef.current?.setCamera(camera);
    } else {
      mapRef.current?.animateCamera(camera, { duration: movingSpeed !== null && movingSpeed <= 1.5 ? 650 : 500 });
    }
  }, [insets.bottom, insets.top, mapReady, navigationNotice, reduceMotionEnabled, viewportHeight]);

  React.useEffect(() => {
    navigationFollowingRef.current = navigationFollowing;
  }, [navigationFollowing]);

  React.useEffect(() => {
    navigation.setOptions({ tabBarStyle: activeRoute ? { display: 'none' } : undefined });
    return () => navigation.setOptions({ tabBarStyle: undefined });
  }, [activeRoute, navigation]);

  React.useEffect(() => {
    if (navigationMuted) void stopNavigationPrompt();
  }, [navigationMuted]);

  const finishInAppNavigation = React.useCallback((arrived = false) => {
    setActiveRoute(null);
    setNavigationDestination(null);
    setNavigationStepIndex(0);
    announcedNavigationStep.current = null;
    navigationPromptProgress.current = null;
    finalNavigationPrompt.current = null;
    navOffRouteSince.current = null;
    navRerouting.current = false;
    navGpsTracker.current.reset();
    navigationCameraHeading.current = null;
    navigationFollowingRef.current = true;
    setNavigationFollowing(true);
    setNavigationMuted(false);
    setNavigationSpeedMps(null);
    setNavigationNotice(arrived ? 'You have arrived.' : null);
    mapRef.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 350 });
    void stopNavigationPrompt().finally(() => {
      if (arrived && !navigationMuted) speakNavigationPrompt('You have arrived at your destination.');
    });
  }, [navigationMuted]);

  const requestInAppRoute = React.useCallback(async (origin: { lat: number; lon: number }, target: NavigationTarget, rerouting = false) => {
    if (!GOOGLE_DIRECTIONS_API_KEY) throw new Error('directions_not_configured');
    if (rerouting) navRerouting.current = true;
    try {
      const nextRoute = await fetchDrivingRoute(origin, target, GOOGLE_DIRECTIONS_API_KEY);
      setActiveRoute(nextRoute);
      setNavigationDestination(target);
      setNavigationStepIndex(0);
      announcedNavigationStep.current = null;
      navigationPromptProgress.current = null;
      finalNavigationPrompt.current = null;
      setNavigationNotice(rerouting ? 'Route updated.' : null);
      navOffRouteSince.current = null;
      if (!rerouting) navigationCameraHeading.current = null;
      navigationFollowingRef.current = true;
      setNavigationFollowing(true);
      if (nextRoute.steps[0]) focusNavigationCamera(origin, nextRoute, 0);
    } finally {
      if (rerouting) navRerouting.current = false;
    }
  }, [focusNavigationCamera]);

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
    if (!activeRoute || !currentNavigationStep || navigationMuted) return;
    const last = announcedNavigationStep.current;
    if (last?.route === activeRoute && last.index === navigationStepIndex) return;
    announcedNavigationStep.current = { route: activeRoute, index: navigationStepIndex };
    const finalPrompt = finalNavigationPrompt.current;
    const alreadySpokenAtTurn = finalPrompt?.route === activeRoute && finalPrompt.index === navigationStepIndex;
    if (!alreadySpokenAtTurn) speakNavigationPrompt(currentNavigationStep.instruction);
  }, [activeRoute, currentNavigationStep, navigationMuted, navigationStepIndex]);

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
      setNavigationSpeedMps(null);
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
        setNavigationSpeedMps(Number.isFinite(position.coords.speed) && Number(position.coords.speed) >= 0
          ? Number(position.coords.speed)
          : null);

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
          const alreadyOnNextStep = distanceToPathMeters(here, nextStep.coordinates) <= NAV_STEP_ARRIVAL_RADIUS_M * 1.5;
          if (!reachedStepEnd && !alreadyOnNextStep) break;
          effectiveIndex += 1;
        }
        if (effectiveIndex !== navigationStepIndex) {
          setNavigationStepIndex(effectiveIndex);
        }

        const effectiveStep = activeRoute.steps[effectiveIndex]!;
        focusNavigationCamera(
          here,
          activeRoute,
          effectiveIndex,
          position.coords.heading,
          position.coords.speed,
        );

        const upcomingIndex = effectiveIndex + 1;
        const upcomingStep = activeRoute.steps[upcomingIndex];
        if (upcomingStep) {
          let progress = navigationPromptProgress.current;
          if (progress?.route !== activeRoute || progress.targetIndex !== upcomingIndex) {
            progress = { route: activeRoute, targetIndex: upcomingIndex, stage: 0 };
            navigationPromptProgress.current = progress;
          }
          const maneuverDistance = remainingDistanceOnPathMeters(here, effectiveStep.coordinates);
          const promptStage = navigationPromptStageForDistance(maneuverDistance);
          if (!navigationMuted && promptStage > progress.stage) {
            navigationPromptProgress.current = { ...progress, stage: promptStage };
            if (promptStage === 3) finalNavigationPrompt.current = { route: activeRoute, index: upcomingIndex };
            const prompt = navigationPromptText(upcomingStep.instruction, maneuverDistance, unitSystem, promptStage);
            if (prompt) speakNavigationPrompt(prompt);
          }
        }

        const distanceOffRoute = distanceToPathMeters(here, effectiveStep.coordinates);
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
        if (!navigationMuted) speakNavigationPrompt('Rerouting.');
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
      setNavigationSpeedMps(null);
      setNavigationNotice(navigationGpsNotice(health));
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [activeRoute, currentNavigationStep, finishInAppNavigation, focusNavigationCamera, navigationDestination, navigationMuted, navigationStepIndex, requestInAppRoute, unitSystem]);

  async function centreOnCurrentLocation(): Promise<void> {
    const location = currentLocation ?? await requestCurrentLocation(true);
    if (!location) return;
    if (activeRoute && currentNavigationStep) {
      navigationFollowingRef.current = true;
      setNavigationFollowing(true);
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
              navigationFollowingRef.current = false;
              setNavigationFollowing(false);
            }}
            onMapReady={() => setMapReady(true)}
          >
            {selfMapLocation && (
              <Marker
                key={`self-rider-${avatarId}-${selfMapStatus}-${activeRoute ? 'nav' : 'map'}`}
                coordinate={{ latitude: selfMapLocation.lat, longitude: selfMapLocation.lon }}
                title={displayName || 'Your location'}
                description={shareRideLocation ? 'Your live group-ride location' : 'Your location'}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
              >
                <RiderAvatar
                  avatarId={avatarId}
                  size={activeRoute ? 54 : 44}
                  mapMarker
                  selected
                  status={selfMapStatus}
                />
              </Marker>
            )}
            {rideLocations
              .filter((location) => location.riderId !== riderId)
              .map((location) => {
                const profile = rideProfiles[location.riderId];
                const fresh = markerNow - location.updatedAt <= RIDE_MARKER_STALE_MS;
                const markerStatus = fresh ? 'online' : 'stale';
                return (
                  <Marker
                    key={`ride-location-${location.riderId}-${profile?.avatarId ?? 'ember'}-${markerStatus}`}
                    coordinate={{ latitude: location.lat, longitude: location.lon }}
                    title={profile?.displayName ?? 'Ride member'}
                    description="Private ride member · live location"
                    anchor={{ x: 0.5, y: 1 }}
                    tracksViewChanges={false}
                  >
                    <RiderAvatar
                      avatarId={profile?.avatarId ?? 'ember'}
                      size={40}
                      mapMarker
                      status={markerStatus}
                    />
                  </Marker>
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
              </>
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
            <MaterialCommunityIcons name="alert-plus" size={22} color={colors.textPrimary} />
          </Pressable>}
          <Pressable
            style={styles.mapActionButton}
            onPress={() => void centreOnCurrentLocation()}
            accessibilityRole="button"
            accessibilityLabel="Centre map on my location"
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={22} color={colors.accent} />
          </Pressable>
          <Pressable
            style={[styles.mapActionButton, shareLocation && styles.mapActionButtonActive]}
            onPress={() => void handleNearbyToggle()}
            accessibilityRole="button"
            accessibilityState={{ selected: shareLocation }}
            accessibilityLabel={shareLocation ? 'Stop live location and proximity voice' : 'Go live nearby and enable proximity voice'}
          >
            <Ionicons name="people" size={24} color={shareLocation ? colors.accentText : colors.accent} />
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
              <MaterialCommunityIcons name="alert-plus" size={22} color={colors.textPrimary} />
            </Pressable>
          )}
          <Pressable
            style={[styles.navigationActionButton, navigationMuted && styles.navigationActionButtonActive]}
            onPress={() => setNavigationMuted((current) => !current)}
            accessibilityRole="button"
            accessibilityState={{ selected: navigationMuted }}
            accessibilityLabel={navigationMuted ? 'Unmute navigation guidance' : 'Mute navigation guidance'}
          >
            <Ionicons name={navigationMuted ? 'volume-mute' : 'volume-high'} size={22} color={navigationMuted ? colors.accentText : colors.textPrimary} />
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
              size={22}
              color={navigationFollowing ? colors.textPrimary : colors.accentText}
            />
          </Pressable>
        </View>
      )}

      <HazardReportSheet visible={reportSheetOpen} onClose={() => setReportSheetOpen(false)} onReport={handleReport} />

      {segment === 'public' && !activeRoute && selectedDestination && (
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
          <View style={[styles.navigationBanner, { top: insets.top + spacing.sm }]}>
            <View style={styles.navigationBannerMain}>
              <View style={styles.navigationManeuver}>
                <NavigationManeuverGlyph
                  maneuver={upcomingNavigationStep?.maneuver ?? 'arrive'}
                  size={58}
                  color={colors.textPrimary}
                  secondaryColor={colors.textMuted}
                />
              </View>
              <View style={styles.navigationBannerCopy}>
                <Text style={styles.navigationDistance}>{formatNavigationDistance(distanceToCurrentStepEnd, unitSystem)}</Text>
                <Text numberOfLines={2} style={styles.navigationInstruction} accessibilityLiveRegion="polite">{navigationGuidanceInstruction}</Text>
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
                    size={28}
                    color={colors.textSecondary}
                    secondaryColor={colors.textMuted}
                  />
                </View>
                <Text style={styles.navigationNextLabel}>Then</Text>
                <Text numberOfLines={1} style={styles.navigationNextInstruction}>{followingNavigationStep.instruction}</Text>
              </View>
            ) : null}
            {navigationNotice ? (
              <View style={styles.navigationNoticeRow}>
                <Ionicons name="warning-outline" size={16} color={colors.warning} />
                <Text style={styles.navigationNotice}>{navigationNotice}</Text>
              </View>
            ) : null}
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
              <View style={styles.navigationSummaryDivider} />
              <View
                style={styles.navigationSummaryStat}
                accessible
                accessibilityLabel={navigationSpeedMps == null
                  ? 'Current speed unavailable'
                  : `Current speed ${formatNavigationSpeed(navigationSpeedMps, unitSystem)} ${navigationSpeedUnit(unitSystem)}`}
              >
                <View style={styles.navigationSpeedValueRow}>
                  <Ionicons accessible={false} name="speedometer-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.navigationSummaryValue}>{formatNavigationSpeed(navigationSpeedMps, unitSystem)}</Text>
                </View>
                <Text style={styles.navigationSummaryLabel}>{navigationSpeedUnit(unitSystem)}</Text>
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
      <ProximityVoice enabled={shareLocation} peerIds={ridersInZone} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  mapFill: { flex: 1 },
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  hostFill: { flex: 1, padding: 0, backgroundColor: colors.background },
  searchSlot: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 9,
  },
  pinBadgeSelected: { borderColor: colors.accent, backgroundColor: colors.accentPressed },
  hazardBadge: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.background },
  mapActions: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 10,
    gap: spacing.sm,
  },
  mapActionButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.raised,
  },
  mapActionButtonActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  currentLocationMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: '#ffffff',
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
    borderRadius: 17,
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
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  hazardVoteText: { ...type.caption, color: colors.textPrimary, fontWeight: '700' },
  destinationCard: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    ...elevation.raised,
  },
  destinationCardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  destinationCardIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  destinationCardCopy: { minWidth: 0, flex: 1 },
  destinationCardTitle: { ...type.subheading, color: colors.textPrimary, fontWeight: '800' },
  destinationCardCoords: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  destinationCardDismiss: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  destinationPrimaryAction: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: 14,
    backgroundColor: colors.accent,
  },
  destinationPrimaryTitle: { ...type.button, color: colors.accentText, lineHeight: 19 },
  destinationPrimarySubtitle: { ...type.caption, color: colors.accentText, opacity: 0.72, marginTop: 1 },
  navigationActions: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 4,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.raised,
  },
  navigationActionButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  navigationActionButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  navigationBanner: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    overflow: 'hidden',
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.raised,
  },
  navigationBannerMain: {
    minHeight: 118,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  navigationManeuver: {
    width: 72,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  navigationBannerCopy: { flex: 1, minWidth: 0 },
  navigationDistance: { color: colors.accent, fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -0.6 },
  navigationInstruction: { ...type.body, color: colors.textPrimary, marginTop: 2, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  navigationNextPreview: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  navigationNextGlyph: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surfaceRaised,
  },
  navigationNextLabel: { ...type.caption, color: colors.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  navigationNextInstruction: { ...type.body, color: colors.textSecondary, flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  navigationNoticeRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.dangerSurface,
  },
  navigationNotice: { ...type.caption, color: colors.textSecondary, flex: 1 },
  navigationEndButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  navigationSummary: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: NAVIGATION_SUMMARY_BASE_HEIGHT,
    paddingTop: 10,
    paddingHorizontal: spacing.lg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...elevation.raised,
  },
  navigationSummaryHandle: {
    width: 46,
    height: 5,
    alignSelf: 'center',
    marginBottom: 10,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
    opacity: 0.55,
  },
  navigationSummaryContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navigationSummaryPrimary: { flex: 1.08, minWidth: 78 },
  navigationSummaryStat: { flex: 1, minWidth: 0, alignItems: 'center' },
  navigationSummaryDivider: { width: StyleSheet.hairlineWidth, height: 46, backgroundColor: colors.border },
  navigationArrival: { ...type.heading, color: colors.success, fontSize: 25, lineHeight: 30 },
  navigationSummaryValue: { ...type.heading, color: colors.textPrimary, fontSize: 21, lineHeight: 27, textAlign: 'center' },
  navigationSpeedValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  navigationSummaryLabel: { ...type.caption, color: colors.textMuted, marginTop: 2, textAlign: 'center', textTransform: 'uppercase' },
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
  safetyEnableButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.accent },
  safetyEnableText: { ...type.caption, color: colors.accentText, fontWeight: '800' },
});
