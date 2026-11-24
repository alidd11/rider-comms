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
import { AccessibilityInfo, ActivityIndicator, BackHandler, View, Text, Pressable, Alert, Linking, Share, useColorScheme, useWindowDimensions } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import type { RootStackParamList, TabParamList } from '../navigation';
import { HIDDEN_TAB_BAR_STYLE, TAB_BAR_STYLE } from '../navigation/tabBarStyle';
import { useAuth } from '../auth/AuthContext';
import { colors, spacing, MIN_TOUCH_TARGET, pressedFeedback } from '../theme';
import { BOTTOM_BAR_HEIGHT, HUD_ACTION_HEIGHT, NAVIGATION_SUMMARY_BASE_HEIGHT, styles } from './MapScreen.styles';
import { RideBar } from '../ride/RideBar';
import { useRide } from '../ride/RideContext';
import { ProximityVoice } from '../voice/ProximityVoice';
import { LaunchCover } from './LaunchCover';
import { HostPanel } from '../ride/HostPanel';
import { parseRideInviteLink } from '../ride/rideInvite';
import { useSettings } from '../settings/SettingsContext';
import { MapDrawer } from './MapDrawer';
import { useFriends } from '../friends/FriendsContext';
import type { PlaceResult } from '../api/places';
import { HazardReportSheet } from './HazardReportSheet';
import type { HazardReport } from '@rider-comms/shared';
import { simplifyRoutePath } from '../navigationRoadEvents';
import { HazardDetailCard } from '../components/HazardDetailCard';
import { useNavigationLiveActivity, useRideLiveActivity } from './useNavigationLiveActivity';
import { buildNavigationProviderUrl, navigationTargetFromValues, openNavigationUrl } from '../navigationLinks';
import type { NavigationTarget } from '../navigationLinks';
import { useMovementSafety } from '../safety/MovementSafetyContext';
import { useVoiceMute } from '../voice/VoiceMuteContext';
import { useDarkOutside } from './useDarkOutside';
import { NearbyRidersIcon } from '../components/NearbyRidersIcon';
import { navigationProviderLabel } from '../navigationPreference';
import { formatNavigationDistance } from '../navigationGuidance';
import { RiderAvatar } from '../components/RiderAvatar';
import { HazardMarker, NavigationPuckMarker, SmoothSelfMarker, SmoothRideMemberMarker } from './mapMarkers';
import { RegroupChip, RegroupMarker, isRegroupSpot, regroupTitle } from './RegroupPoint';
import { RidingHud } from './RidingHud';
import { NavigationBanner, NavigationControls, NavigationRecentreButton, NavigationSpeedBadge, NavigationTripSummary } from './NavigationOverlay';
import { GLANCE_TEXT_MAX_SCALE, NavigationNightContext } from '../navigationTone';
import { ArrivalCard, DestinationCard, RoutePreviewSheet, RoutePreviewTopBar } from './MapPlaceCards';
import type { RouteAvoidance } from '../routeOptionsPreference';
import { RIDE_LOCATION_FRESH_MS, navigationManeuverArrow, regroupAnnouncement, rideBatteryAnnouncements, rideDropAnnouncements, routeTrafficDelayText, navigationEtaShareText, routeShareText, routeTrafficLines, type RouteStyle, rideMemberLastSeenAgo, type RegroupPoint, type RideBatteryState, type RideDropState } from '@rider-comms/shared';
import { speakNavigationPrompt } from '../audio/navigationSpeech';
import { useRideProfiles } from './useRideProfiles';
import { queuedReportsText, useHazardReports } from './useHazardReports';
import { StopsOnTheWaySheet } from './StopsOnTheWaySheet';
import { useNavigationSummary } from './useNavigationSummary';
import { usePresence } from './usePresence';
import { useInAppNavigation } from './useInAppNavigation';
import { haptics } from '../haptics';
import { CURATED_ROUTES } from '../routes/curatedRoutes';

const RIDE_MARKER_REFRESH_MS = 10_000;
const DEFAULT_REGION = {
  latitude: 51.5074,
  longitude: -0.1278,
  latitudeDelta: 0.16,
  longitudeDelta: 0.16,
};
const FOCUSED_REGION_DELTA = 0.025;

type Segment = 'public' | 'host';

/** The route line, as Google Maps draws it: the chosen way wide blue on a
 * darker edge, other ways grey, traffic orange and red (PWA: ROUTE_LINE in
 * 17-navigation.js). */
const ROUTE_LINE = {
  chosen: { fill: '#1A73E8', casing: '#0B4FB3', width: 9, casingWidth: 13 },
  other: { fill: '#A9B4BA', casing: '#7F8C93', width: 7, casingWidth: 10 },
  traffic: { slow: '#F29900', jam: '#D93025' },
} as const;

export function MapScreen(): React.JSX.Element {
  const colorScheme = useColorScheme();
  const { client, riderId } = useAuth();
  const { activeRide, rideLocations, roster, shareRideLocation, setRegroupPoint } = useRide();
  const regroup = activeRide?.regroup ?? null;
  const [regroupError, setRegroupError] = React.useState(false);
  const [regroupSaving, setRegroupSaving] = React.useState(false);
  const { shareLocation, setShareLocation, unitSystem, navigationProvider, routeAvoidance, setRouteAvoidance, spokenDirections, avatarId, displayName } = useSettings();
  const { lockedForSafety, speedMps, refreshTracking } = useMovementSafety();
  const { muted: voiceMuted, toggleMuted: toggleVoiceMuted, voiceConnected } = useVoiceMute();
  const [rideBarHeight, setRideBarHeight] = React.useState(0);
  // The Where to drawer (PWA: #mapDrawer) and its resting height.
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [drawerPeek, setDrawerPeek] = React.useState(0);
  const { incomingRequests, unreadMessageCount } = useFriends();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const route = useRoute<RouteProp<TabParamList, 'Map'>>();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList, 'Map'>>();
  // The Menu is a root stack screen; Map sits in the tabs inside it.
  const rootNavigation = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  const [segment, setSegment] = React.useState<Segment>(route.params?.segment ?? 'public');
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
      return next;
    } catch {
      return null;
    }
    // refreshTracking forwards to the provider's latest start function through
    // a ref, so an earlier copy is never stale; listing it would recreate this
    // callback (and re-run everything keyed on it) on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const { publicLive, ridersInZone, nearbyTogglePending, handleNearbyToggle } = usePresence(
    client,
    activeRide,
    shareLocation,
    setShareLocation,
    lockedForSafety,
    riderId,
    requestCurrentLocation,
    setError,
  );
  // Dark basemap from sunset to sunrise, even with the phone in light mode
  // (PWA: isDarkOutside at map start). Re-checked each minute so the map
  // turns dark mid-ride. Without a fix, the time zone gives the longitude.
  const darkOutside = useDarkOutside(currentLocation);
  // Riders near you, for the Go live button's spoken label (PWA: renderMapChrome).
  const nearbyCount = ridersInZone.length;
  const hudSpeed = speedMps == null ? null : Math.round(speedMps * (unitSystem === 'km' ? 3.6 : 2.23694));

  const hasCurrentLocation = currentLocation !== null;
  const [stopsSheetOpen, setStopsSheetOpen] = React.useState(false);
  // Report confirmations are spoken too, like other riding prompts, since
  // riders often report from the riding display without looking down.
  const hazardSpeech = React.useRef({ speak: spokenDirections });
  const announceHazardReport = React.useCallback((text: string) => {
    AccessibilityInfo.announceForAccessibility(text);
    if (hazardSpeech.current.speak) speakNavigationPrompt(text);
  }, []);
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
    reportNotice: hazardReportNotice,
    queuedReportCount,
  } = useHazardReports(client, hasCurrentLocation, currentLocationRef, requestCurrentLocationForHazardReport, announceHazardReport, riderId);

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
    navigationPuck,
    navigationRouteLine,
    navigationTrafficLines,
    currentNavigationStep,
    fitRoute,
    focusNavigationCamera,
    finishInAppNavigation,
    navigationArrival,
    dismissNavigationArrival,
    startInAppNavigation,
    startCuratedNavigation,
    curatedRemainingStops,
    stopFollowingRoute,
    resumeFollowingRoute,
    routePreview,
    chooseRoutePreview,
    startRoutePreview,
    closeRoutePreview,
    replanRoutePreview,
    setRoutePreviewStyle,
    removeRoutePreviewStop,
    findStopsOnTheWay,
    addNavigationStop,
    skipNavigationStop,
    navigationStop,
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
    routeAvoidance,
    spokenDirections,
  );

  // During turn-by-turn guidance the selected rider avatar must follow the
  // device's live high-accuracy fix, not the slower ride-location round trip.
  // Other riders still use the consented private-ride location feed below.
  // Ride markers age with the clock, and so does the arrival time while
  // the rider waits at lights with no new fix.
  const navigatingNow = Boolean(activeRoute);
  React.useEffect(() => {
    if (!rideLocations.length && !navigatingNow) return;
    setMarkerNow(Date.now());
    const timer = setInterval(() => setMarkerNow(Date.now()), RIDE_MARKER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [rideLocations.length, navigatingNow]);
  const selfMapLocation = activeRoute && currentLocation
    ? currentLocation
    : ownRideLocation
      ? { lat: ownRideLocation.lat, lon: ownRideLocation.lon }
      : currentLocation;
  const ownRideLocationFresh = Boolean(
    ownRideLocation && markerNow - ownRideLocation.updatedAt <= RIDE_LOCATION_FRESH_MS,
  );
  const selfMapStatus = publicLive || (shareRideLocation && ownRideLocationFresh)
    ? 'online'
    : ownRideLocation && !ownRideLocationFresh
      ? 'stale'
      : 'none';

  // A ridercomms://join?code=… invite link (shared by a host) opens the Ride
  // tab with the code filled in; the rider still taps Join.
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);
  React.useEffect(() => {
    const openInvite = (url: string | null | undefined) => {
      const code = parseRideInviteLink(url);
      if (!code) return;
      setInviteCode(code);
      navigation.setParams({ segment: 'host', at: Date.now() });
    };
    void Linking.getInitialURL().then(openInvite).catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => openInvite(url));
    return () => subscription.remove();
  }, [navigation]);

  // The tab bar gives the map the whole screen during turn-by-turn
  // navigation (and while moving, see Tabs in navigation/index.tsx).
  React.useEffect(() => {
    navigation.setOptions({ tabBarStyle: activeRoute || lockedForSafety ? HIDDEN_TAB_BAR_STYLE : TAB_BAR_STYLE });
  }, [activeRoute, lockedForSafety, navigation]);

  // Reacts to the "Group Ride" tab bar shortcut (see navigation/index.tsx),
  // which navigates here with a fresh `at` nonce each press so a repeat tap
  // back to the same segment still switches even if the user had since
  // flipped the in-screen toggle to something else.
  React.useEffect(() => {
    if (route.params?.segment) {
      setSegment(route.params.segment);
      setDrawerOpen(false);
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
    const id = route.params?.curatedRouteId;
    if (!id) return;
    const curated = CURATED_ROUTES.find((item) => item.id === id);
    // Consume the one-shot selection. Otherwise later Map tab presses could
    // accidentally restart the previous scenic route.
    navigation.setParams({ curatedRouteId: undefined });
    if (curated) void startCuratedNavigation(curated);
    else Alert.alert('Route unavailable', 'The selected scenic route is no longer in the reviewed catalogue.');
    // A new selection supplies an `at` nonce even if the Map tab is already mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.at, route.params?.curatedRouteId]);

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
    navigationRoadName,
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
  const selectedIsRegroup = isRegroupSpot(regroup, selectedDestination);
  const selectedDestinationSubtitle = selectedIsRegroup
    ? 'Regroup point · set by the host'
    : navigationTarget
      ? `${navigationTarget.lat.toFixed(5)}, ${navigationTarget.lon.toFixed(5)}`
      : selectedPlace?.address ?? '';
  const selectedDestinationProvider = navigationProvider === 'in_app'
    ? 'In Rider Comms'
    : `Open in ${navigationProviderLabel(navigationProvider)}`;

  const navigationArrivalLabel = new Date(Date.now() + remainingNavigationSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // The trip card's expanded half: parked only (Ride Safe leaves it out).
  const tripDetails = React.useMemo(() => (activeRoute && !lockedForSafety ? {
    upcomingSteps: activeRoute.steps.slice(navigationStepIndex + 1),
    destinationLabel: navigationDestination?.label ?? '',
    onAddStop: () => setStopsSheetOpen(true),
    stopLabel: navigationStop?.label ?? null,
    onSkipStop: () => { void skipNavigationStop(); },
    onShareEta: () => {
      const message = navigationEtaShareText(navigationDestination?.label ?? '', navigationArrivalLabel, remainingNavigationMeters, unitSystem);
      void Share.share({ message }).then(() => haptics.success()).catch(() => undefined);
    },
  } : undefined), [activeRoute, lockedForSafety, navigationStepIndex, navigationDestination, navigationArrivalLabel, navigationStop, remainingNavigationMeters, skipNavigationStop, unitSystem]);
  useRideLiveActivity(activeRide && !activeRoute
    ? { riderCount: roster.length, code: activeRide.code, regroupLabel: regroup?.label }
    : null);
  useNavigationLiveActivity(
    activeRoute && currentNavigationStep
      ? {
        maneuver: upcomingNavigationStep?.maneuver ?? 'arrive',
        instruction: navigationGuidanceInstruction,
        distanceLabel: formatNavigationDistance(distanceToCurrentStepEnd, unitSystem),
        arrivalLabel: navigationArrivalLabel,
        progress: activeRoute.distanceMeters > 0 ? 1 - remainingNavigationMeters / activeRoute.distanceMeters : 0,
      }
      : null,
    navigationNotice === 'You’ve arrived.',
    // Within ~250 m of the turn, show every distance change.
    distanceToCurrentStepEnd < 250,
  );

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

  hazardSpeech.current.speak = spokenDirections && !(activeRoute && navigationMuted);

  // A new regroup point from the host is spoken to members with headsets
  // (shared regroupAnnouncement), unless spoken directions are off or the
  // rider has muted navigation. The chip and flag show it on screen too.
  const lastRegroup = React.useRef<{ rideId: string | null; point: RegroupPoint | null | undefined }>({ rideId: null, point: undefined });
  React.useEffect(() => {
    const rideId = activeRide?.rideId ?? null;
    const known = lastRegroup.current.rideId === rideId ? lastRegroup.current.point : undefined;
    lastRegroup.current = { rideId, point: rideId ? regroup : undefined };
    const announcement = regroupAnnouncement(known, regroup, activeRide?.isHost === true);
    if (announcement && spokenDirections && !(activeRoute && navigationMuted)) speakNavigationPrompt(announcement);
    // Only a change to the ride or its regroup point should speak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRide?.rideId, regroup?.setAt]);

  // A rider whose position stops updating mid-ride (no signal, flat
  // battery, a fall) is called out once, and again when they're back
  // (shared rideDropAnnouncements). Checked only when a fresh set of
  // positions arrives, so this rider's own lost signal never reads as
  // everyone else dropping.
  const rideDrops = React.useRef<{ rideId: string | null; state: RideDropState; battery: RideBatteryState }>({ rideId: null, state: {}, battery: {} });
  React.useEffect(() => {
    const rideId = activeRide?.rideId ?? null;
    if (rideDrops.current.rideId !== rideId) rideDrops.current = { rideId, state: {}, battery: {} };
    if (!rideId) return;
    const names = Object.fromEntries(Object.entries(rideProfiles).map(([id, profile]) => [id, profile.displayName]));
    const others = rideLocations.filter((location) => location.riderId !== riderId);
    const step = rideDropAnnouncements(rideDrops.current.state, others, names, Date.now());
    rideDrops.current.state = step.state;
    // A rider whose phone is nearly flat is called out once too (shared
    // rideBatteryAnnouncements), so the group knows why they may go quiet.
    const battery = rideBatteryAnnouncements(rideDrops.current.battery, others, names);
    rideDrops.current.battery = battery.state;
    const said = [...step.announcements, ...battery.announcements];
    if (said.length === 0) return;
    const message = said.join(' ');
    AccessibilityInfo.announceForAccessibility(message);
    if (spokenDirections && !(activeRoute && navigationMuted)) speakNavigationPrompt(message);
    // Only a new set of positions should be checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideLocations, activeRide?.rideId]);

  const routeLineCoordinates = React.useMemo(
    () => navigationRouteLine?.map((coordinate) => ({ latitude: coordinate.lat, longitude: coordinate.lon })) ?? null,
    [navigationRouteLine],
  );
  const maneuverArrowPath = React.useMemo(() => {
    if (!activeRoute) return null;
    const arrow = navigationManeuverArrow(
      activeRoute.steps[navigationStepIndex]?.coordinates ?? [],
      activeRoute.steps[navigationStepIndex + 1]?.coordinates,
    );
    return arrow ? arrow.path.map((point) => ({ latitude: point.lat, longitude: point.lon })) : null;
  }, [activeRoute, navigationStepIndex]);

  // Picking another place replaces the arrival card.
  const hasSelectedDestination = selectedDestination !== null;
  React.useEffect(() => {
    if (hasSelectedDestination) dismissNavigationArrival();
  }, [dismissNavigationArrival, hasSelectedDestination]);

  // A failed regroup attempt's message belongs to that place only.
  React.useEffect(() => {
    setRegroupError(false);
  }, [selectedDestination?.lat, selectedDestination?.lon]);

  /** Shows the regroup point in the destination card (one tap to route). */
  function showRegroupPoint(): void {
    if (!regroup) return;
    setSegment('public');
    setSelectedHazardId(null);
    setSelectedPlace(null);
    setNavigationTarget({ lat: regroup.lat, lon: regroup.lon, label: regroupTitle(regroup) });
  }

  async function toggleRegroupPoint(destination: NavigationTarget, clear: boolean): Promise<void> {
    setRegroupSaving(true);
    setRegroupError(false);
    const saved = await setRegroupPoint(clear ? null : {
      lat: destination.lat,
      lon: destination.lon,
      label: destination.label ?? '',
    });
    setRegroupSaving(false);
    setRegroupError(!saved);
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
  // decision can be made up front, same as other map apps' own
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
        const route = await client.getDrivingRoute({ lat: origin.lat, lon: origin.lon }, target, routeAvoidance);
        if (requestId === destinationEtaRequestId.current) {
          setDestinationEta({ distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds });
        }
      } catch {
        // Best-effort preview only; "Start route" surfaces a real error if
        // the route genuinely cannot be calculated.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDestination?.lat, selectedDestination?.lon, client, routeAvoidance.highways, routeAvoidance.tolls, routeAvoidance.ferries]);

  /** An avoid chip in the route preview: the Settings choice, and the ways
   * asked for again; put back if Google finds none that way. */
  async function toggleRoutePreviewAvoid(key: keyof RouteAvoidance): Promise<void> {
    const previous = routeAvoidance;
    const next = { ...previous, [key]: !previous[key] };
    setRouteAvoidance(next);
    if (!(await replanRoutePreview(next))) {
      setRouteAvoidance(previous);
      Alert.alert('No route found', 'There’s no way there with that setting. The routes shown are unchanged.');
    }
  }

  /** Hold the navigation voice button: mute, or leave Nearby Voice, without
   * ending the route. */
  function openNavigationVoiceOptions(): void {
    const buttons: Parameters<typeof Alert.alert>[2] = [
      { text: voiceMuted ? 'Unmute microphone' : 'Mute microphone', onPress: toggleVoiceMuted },
      ...(publicLive ? [{ text: 'Leave Nearby Voice', style: 'destructive' as const, onPress: () => void handleNearbyToggle() }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert(
      publicLive ? 'Nearby Voice' : 'Group ride voice',
      publicLive ? 'Your route keeps going whatever you choose.' : 'Your route keeps going. Leave the ride from the ride screen.',
      buttons,
    );
  }

  /** Fastest, Twisty or No motorways, for this trip only. */
  async function chooseRoutePreviewStyle(style: RouteStyle): Promise<void> {
    if (!(await setRoutePreviewStyle(style))) {
      Alert.alert('No route found', 'There’s no way there like that. The routes shown are unchanged.');
    }
  }

  function shareRoutePreview(): void {
    if (!routePreview) return;
    const route = routePreview.routes[routePreview.index];
    if (!route) return;
    const arrival = new Date(Date.now() + route.durationSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const message = routeShareText(routePreview.target.label ?? '', arrival, route.distanceMeters, unitSystem, route.summary ?? '');
    void Share.share({ message }).then(() => haptics.success()).catch(() => undefined);
  }

  async function openDirections(target: NavigationTarget): Promise<void> {
    if (navigationProvider === 'in_app') {
      // Parked: the ways there first. On the move: straight onto the fastest.
      await startInAppNavigation(target, { preview: !lockedForSafety });
      return;
    }
    const url = buildNavigationProviderUrl(target, navigationProvider);
    if (!url) {
      Alert.alert('Location unavailable', 'This destination has invalid coordinates.');
      return;
    }
    if (!(await openNavigationUrl(url, Linking))) {
      Alert.alert('Couldn’t open directions', `Couldn’t open ${navigationProviderLabel(navigationProvider)} on this device.`);
    }
  }

  useFocusEffect(React.useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (segment === 'host') {
        navigation.setParams({ segment: 'public', at: Date.now() });
        return true;
      }
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [drawerOpen, navigation, segment]));

  // The drawer steps aside while navigating, while Ride Safe locks the
  // controls, and while a place or hazard card owns the bottom of the map.
  const friendsAttention = incomingRequests.length + unreadMessageCount;
  // The route preview's hazards: the whole of each way, not only the 40
  // miles round the rider that the map's reports cover (PWA:
  // loadRoutePreviewHazards).
  const [routeHazardReports, setRouteHazardReports] = React.useState<HazardReport[]>([]);
  const previewRoutes = routePreview?.routes;
  React.useEffect(() => {
    setRouteHazardReports([]);
    if (!previewRoutes) return undefined;
    let current = true;
    void Promise.resolve()
      .then(() => Promise.all(previewRoutes.map((way) => client.getHazardsAlongRoute(simplifyRoutePath(way.coordinates)))))
      .then((answers) => { if (current) setRouteHazardReports(answers.flatMap((answer) => answer.hazards)); })
      .catch(() => { /* The reports round the rider still show. */ });
    return () => { current = false; };
  }, [client, previewRoutes]);
  const previewHazards = React.useMemo(() => {
    const byId = new Map<string, HazardReport>();
    [...hazards, ...routeHazardReports].forEach((report) => byId.set(report.id, report));
    return [...byId.values()];
  }, [hazards, routeHazardReports]);

  const drawerVisible = segment === 'public' && !lockedForSafety && !activeRoute && !routePreview && !selectedDestination && !selectedHazard && !navigationArrival;
  // Moving off with the route preview open: go, on the route it shows.
  React.useEffect(() => {
    if (lockedForSafety && routePreview) startRoutePreview();
  }, [lockedForSafety, routePreview, startRoutePreview]);
  const bottomInset = drawerVisible && drawerPeek > 0 ? drawerPeek : insets.bottom;
  // Bottom controls sit above the drawer, and above the ride bar while a
  // group ride is showing.
  const bottomBarOffset = activeRide && rideBarHeight > 0 && !(drawerVisible && drawerOpen) ? rideBarHeight : bottomInset + spacing.sm;

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
            userInterfaceStyle={colorScheme === 'dark' || darkOutside ? 'dark' : 'light'}
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
              <NavigationPuckMarker
                key={`self-rider-${avatarId}-nav`}
                now={navigationPuck?.now ?? selfMapLocation}
                target={navigationPuck?.target ?? selfMapLocation}
                glideMs={navigationPuck?.glideMs ?? 0}
                coneDegrees={navigationPuck?.coneDegrees ?? null}
                avatarId={avatarId}
                displayName={displayName}
                description={shareRideLocation ? 'Your live group-ride location' : 'Your location'}
              />
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
                // Stopped updating (lost signal, phone locked): grey, with
                // how long ago, for up to the 10 minutes the server keeps it.
                const lastSeen = rideMemberLastSeenAgo(location.updatedAt, markerNow);
                const markerStatus = lastSeen ? 'stale' : 'online';
                return (
                  <SmoothRideMemberMarker
                    key={`ride-location-${location.riderId}-${profile?.avatarId ?? 'ember'}-${markerStatus}-${lastSeen ?? ''}-${location.batteryLow ? 'battery-low' : ''}`}
                    location={{ lat: location.lat, lon: location.lon }}
                    avatarId={profile?.avatarId ?? 'ember'}
                    displayName={profile?.displayName ?? 'Ride member'}
                    status={markerStatus}
                    lastSeen={lastSeen}
                    batteryLow={location.batteryLow === true}
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
            {/* The route preview: every way there, the chosen one blue and
                on top, the others grey; a tap on a line chooses it. */}
            {!activeRoute && routePreview ? [...routePreview.routes.keys()]
              .sort((a, b) => Number(a === routePreview.index) - Number(b === routePreview.index))
              .map((index) => {
                const chosen = index === routePreview.index;
                const coordinates = routePreview.routes[index]!.coordinates.map((point) => ({ latitude: point.lat, longitude: point.lon }));
                const line = chosen ? ROUTE_LINE.chosen : ROUTE_LINE.other;
                return (
                  <React.Fragment key={`route-preview-${index}`}>
                    <Polyline coordinates={coordinates} strokeColor={line.casing} strokeWidth={line.casingWidth} lineCap="round" lineJoin="round" zIndex={chosen ? 6 : 4} />
                    <Polyline
                      testID={`route-preview-line-${index}`}
                      coordinates={coordinates}
                      strokeColor={line.fill}
                      strokeWidth={line.width}
                      lineCap="round"
                      lineJoin="round"
                      zIndex={chosen ? 6 : 5}
                      tappable={!chosen}
                      onPress={() => chooseRoutePreview(index)}
                    />
                  </React.Fragment>
                );
              }) : null}
            {/* Traffic on the chosen way, as Google Maps colours it. */}
            {!activeRoute && routePreview ? routeTrafficLines(routePreview.routes[routePreview.index]!.coordinates, routePreview.routes[routePreview.index]!.traffic).map((stretch, index) => (
              <Polyline
                key={`route-preview-traffic-${index}`}
                coordinates={stretch.coordinates.map((point) => ({ latitude: point.lat, longitude: point.lon }))}
                strokeColor={ROUTE_LINE.traffic[stretch.speed]}
                strokeWidth={ROUTE_LINE.chosen.width}
                lineCap="round"
                lineJoin="round"
                zIndex={6}
              />
            )) : null}
            {/* Each way's time on its line, as in Google Maps; a tap chooses it. */}
            {!activeRoute && routePreview ? routePreview.choices.map((choice) => {
              const path = routePreview.routes[choice.index]!.coordinates;
              const point = path[Math.min(path.length - 1, Math.floor(path.length * ([0.5, 0.35, 0.65][choice.index] ?? 0.5)))];
              if (!point) return null;
              const chosen = choice.index === routePreview.index;
              return (
                <Marker
                  key={`route-preview-time-${choice.index}`}
                  testID={`route-preview-time-${choice.index}`}
                  coordinate={{ latitude: point.lat, longitude: point.lon }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  zIndex={chosen ? 8 : 7}
                  tracksViewChanges={false}
                  accessibilityLabel={`${choice.text}${chosen ? ', chosen' : ''}`}
                  onPress={() => chooseRoutePreview(choice.index)}
                >
                  <View style={[styles.routePreviewBubble, chosen && styles.routePreviewBubbleChosen]}>
                    <Text style={[styles.routePreviewBubbleText, chosen && styles.routePreviewBubbleTextChosen]}>{choice.time}</Text>
                    {choice.label !== 'Alternative' ? (
                      <Text style={[styles.routePreviewBubbleLabel, chosen && styles.routePreviewBubbleTextChosen]}>{choice.label}</Text>
                    ) : null}
                  </View>
                </Marker>
              );
            }) : null}
            {activeRoute && routeLineCoordinates && (
              <>
                {curatedRemainingStops.map((stop, index) => (
                  <Marker
                    key={`curated-stop-${index}-${stop.lat}-${stop.lon}`}
                    coordinate={{ latitude: stop.lat, longitude: stop.lon }}
                    title={`Planned stop ${index + 1}: ${stop.label}`}
                    pinColor={colors.accent}
                  />
                ))}
                {/* Google Maps' line: wide blue on a darker edge, with slow
                    and jammed stretches in orange and red (PWA: renderNavigationRouteLine). */}
                <Polyline
                  coordinates={routeLineCoordinates}
                  strokeColor={ROUTE_LINE.chosen.casing}
                  strokeWidth={ROUTE_LINE.chosen.casingWidth}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={5}
                />
                <Polyline
                  coordinates={routeLineCoordinates}
                  strokeColor={ROUTE_LINE.chosen.fill}
                  strokeWidth={ROUTE_LINE.chosen.width}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={6}
                />
                {navigationTrafficLines.map((stretch, index) => (
                  <Polyline
                    key={`navigation-traffic-${index}`}
                    testID="navigation-traffic-line"
                    coordinates={stretch.coordinates.map((point) => ({ latitude: point.lat, longitude: point.lon }))}
                    strokeColor={ROUTE_LINE.traffic[stretch.speed]}
                    strokeWidth={ROUTE_LINE.chosen.width}
                    lineCap="round"
                    lineJoin="round"
                    zIndex={7}
                  />
                ))}
                {/* The white turn arrow at the next maneuver (PWA: navArrowLine). */}
                {maneuverArrowPath ? (
                  <>
                    <Polyline coordinates={maneuverArrowPath} strokeColor="#0B1216" strokeWidth={13} lineCap="round" lineJoin="round" zIndex={8} />
                    <Polyline coordinates={maneuverArrowPath} strokeColor="#FFFFFF" strokeWidth={8} lineCap="round" lineJoin="round" zIndex={9} />
                  </>
                ) : null}
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
            {regroup ? <RegroupMarker point={regroup} onPress={showRegroupPoint} /> : null}
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
          <HostPanel
            inviteCode={inviteCode}
            backToMenu={route.params?.fromMenu === true}
            onBack={() => {
              const toMenu = route.params?.fromMenu === true;
              navigation.setParams({ segment: 'public', at: Date.now(), fromMenu: undefined });
              // Opened from the menu: go back to it, over the map.
              if (toMenu) rootNavigation?.navigate('Menu');
            }}
          />
        </View>
      )}

      {segment === 'public' && !lockedForSafety && !activeRoute && !routePreview && (
        <View style={[styles.searchSlot, styles.searchRow, { top: insets.top + spacing.sm }]}>
          {/* The menu (Ride, Friends, Routes, Settings, plan, help). Friend
              requests and unread messages show as a count on the avatar. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={friendsAttention > 0 ? `Open menu, ${friendsAttention} new from friends` : 'Open menu'}
            accessibilityHint="Ride, friends, routes, settings and help"
            testID="open-menu"
            onPress={() => rootNavigation?.navigate('Menu')}
            style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]}
          >
            <RiderAvatar avatarId={avatarId} size={46} mapMarker={false} status="none" />
            <View style={styles.menuHint} pointerEvents="none">
              <Ionicons name="menu" size={12} color={colors.textPrimary} />
            </View>
            {friendsAttention > 0 ? (
              <View style={styles.menuBadge} testID="menu-badge">
                <Text style={styles.menuBadgeText}>{friendsAttention > 99 ? '99+' : friendsAttention}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      )}

      {error && !activeRoute && (
        <View
          style={[styles.mapError, { top: insets.top + spacing.sm + MIN_TOUCH_TARGET + spacing.sm }]}
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
        >
          <Ionicons name="warning-outline" size={20} color={colors.danger} />
          <Text style={styles.mapErrorText}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss map message"
            accessibilityHint="Hides this message without changing your map or ride settings"
            style={({ pressed }) => [styles.mapErrorDismiss, pressed && pressedFeedback]}
            onPress={() => setError(null)}
          >
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}

      {segment === 'public' && regroup && !activeRoute && !selectedDestination && !selectedHazard && (
        <RegroupChip
          point={regroup}
          from={currentLocation}
          unitSystem={unitSystem}
          // Under the avatar and menu row.
          top={insets.top + spacing.sm + MIN_TOUCH_TARGET + spacing.sm}
          onPress={showRegroupPoint}
        />
      )}

      {segment === 'public' && !selectedDestination && !activeRoute && !navigationArrival && queuedReportCount > 0 && (
        <View
          pointerEvents="none"
          style={[styles.queuedReports, { bottom: bottomBarOffset + (lockedForSafety ? HUD_ACTION_HEIGHT : BOTTOM_BAR_HEIGHT) + spacing.sm }]}
          testID="queued-hazard-reports"
        >
          <Ionicons name="cloud-upload-outline" size={16} color={colors.warning} />
          <Text style={styles.queuedReportsText} maxFontSizeMultiplier={GLANCE_TEXT_MAX_SCALE}>{queuedReportsText(queuedReportCount)}</Text>
        </View>
      )}

      {segment === 'public' && !selectedDestination && !activeRoute && !routePreview && !navigationArrival && (
        <View style={[styles.mapActions, { bottom: bottomBarOffset + (lockedForSafety ? HUD_ACTION_HEIGHT : BOTTOM_BAR_HEIGHT) + spacing.sm }]}>
          <Pressable
            style={({ pressed }) => [styles.mapActionButton, pressed && styles.mapActionButtonPressed]}
            onPress={() => void centreOnCurrentLocation()}
            accessibilityRole="button"
            accessibilityLabel="Centre on my location"
            accessibilityHint="Moves the map back to your current position"
          >
            <Ionicons name="navigate" size={22} color={colors.accent} />
          </Pressable>
        </View>
      )}

      {segment === 'public' && !selectedDestination && !activeRoute && !routePreview && !navigationArrival && !lockedForSafety && (
        <View style={[styles.mapBottomBar, { bottom: bottomBarOffset }]} testID="map-bottom-bar">
          <Pressable
            style={({ pressed }) => [styles.mapHazardButton, pressed && styles.mapActionButtonPressed]}
            onPress={() => void openReportSheet()}
            accessibilityRole="button"
            accessibilityLabel="Report on the road"
            accessibilityHint="Choose a road hazard to share with nearby riders"
          >
            <MaterialCommunityIcons name="alert-outline" size={26} color="#1F1300" />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.mapLiveButton, publicLive && styles.mapLiveButtonActive, pressed && styles.mapActionButtonPressed]}
            onPress={() => {
              haptics.tap();
              void handleNearbyToggle();
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: publicLive, busy: nearbyTogglePending, disabled: nearbyTogglePending }}
            accessibilityLabel={publicLive ? `Leave nearby${nearbyCount ? `, ${nearbyCount} ${nearbyCount === 1 ? 'rider' : 'riders'} nearby` : ''}` : 'Go live nearby'}
            accessibilityHint={publicLive ? 'Stops sharing your nearby presence' : 'Shows you to nearby riders and turns on Nearby Voice'}
            disabled={nearbyTogglePending}
            testID="go-live-button"
          >
            {nearbyTogglePending ? (
              <ActivityIndicator color={publicLive ? '#04210F' : '#04161D'} />
            ) : (
              <NearbyRidersIcon size={24} color={publicLive ? '#04210F' : '#04161D'} />
            )}
          </Pressable>
        </View>
      )}

      {segment === 'public' && lockedForSafety && !activeRoute && (
        <RidingHud
          top={insets.top + spacing.sm}
          bottom={bottomBarOffset}
          inRide={Boolean(activeRide)}
          rosterCount={roster.length}
          speed={hudSpeed}
          unitSystem={unitSystem}
          voiceConnected={voiceConnected}
          voiceMuted={voiceMuted}
          onToggleMute={toggleVoiceMuted}
          onReport={() => void openReportSheet()}
        />
      )}

      {activeRoute && currentNavigationStep && (
        <NavigationControls
          bottom={navigationSummaryHeight + spacing.md}
          canReport={!lockedForSafety}
          muted={navigationMuted}
          following={navigationFollowing}
          onReport={() => void openReportSheet()}
          onFindStops={() => setStopsSheetOpen(true)}
          onToggleMute={() => setNavigationMuted((current) => !current)}
          voice={voiceConnected || publicLive || activeRide ? { muted: voiceMuted, onToggleMute: toggleVoiceMuted, onMore: openNavigationVoiceOptions } : null}
          onOverviewOrFollow={() => {
            if (navigationFollowing) fitRoute(activeRoute);
            else void centreOnCurrentLocation();
          }}
        />
      )}

      <StopsOnTheWaySheet
        visible={stopsSheetOpen && Boolean(activeRoute || routePreview) && !lockedForSafety}
        onClose={() => setStopsSheetOpen(false)}
        findStops={findStopsOnTheWay}
        onChoose={(place) => {
          setStopsSheetOpen(false);
          void addNavigationStop(place);
        }}
      />

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
          notice={hazardReportNotice?.text ?? null}
        />
      )}

      {segment === 'public' && !activeRoute && navigationArrival && !selectedDestination && !selectedHazard && (
        <ArrivalCard
          bottom={insets.bottom + spacing.sm}
          arrival={navigationArrival}
          unitSystem={unitSystem}
          onDone={dismissNavigationArrival}
        />
      )}

      {segment === 'public' && !activeRoute && routePreview && (
        <>
          <RoutePreviewTopBar
            top={insets.top + spacing.sm}
            preview={routePreview}
            avoidance={routeAvoidance}
            replanning={navigationLoading}
            onBack={closeRoutePreview}
            onChangeDestination={() => {
              // Another destination: back to search, as in Google Maps.
              closeRoutePreview();
              setNavigationTarget(null);
              setSelectedPlace(null);
              setDrawerOpen(true);
            }}
            onStyle={(style) => void chooseRoutePreviewStyle(style)}
            onToggleAvoid={(key) => void toggleRoutePreviewAvoid(key)}
            onAddStop={() => setStopsSheetOpen(true)}
          />
          <RoutePreviewSheet
            bottom={0}
            preview={routePreview}
            unitSystem={unitSystem}
            replanning={navigationLoading}
            ride={activeRide ? {
              count: Math.max(1, roster.length),
              avatars: roster.slice(0, 3).map((id, index) => (
                <View key={id} style={index > 0 ? styles.routePreviewRideAvatarOverlap : undefined}>
                  <RiderAvatar avatarId={rideProfiles[id]?.avatarId ?? null} size={26} mapMarker={false} status="none" />
                </View>
              )),
            } : null}
            hazards={previewHazards}
            onRemoveStop={() => { void removeRoutePreviewStop(); }}
            onChoose={chooseRoutePreview}
            onStart={startRoutePreview}
            onShare={shareRoutePreview}
          />
        </>
      )}

      {segment === 'public' && !activeRoute && !routePreview && selectedDestination && !selectedHazard && (
        <DestinationCard
          bottom={insets.bottom + spacing.sm}
          destination={selectedDestination}
          subtitle={selectedDestinationSubtitle}
          isRegroup={selectedIsRegroup}
          eta={destinationEta}
          unitSystem={unitSystem}
          providerLabel={selectedDestinationProvider}
          loading={navigationLoading}
          isHost={activeRide?.isHost === true}
          regroupSaving={regroupSaving}
          regroupError={regroupError}
          onDismiss={() => {
            setNavigationTarget(null);
            setSelectedPlace(null);
          }}
          onStartRoute={() => void openDirections(selectedDestination)}
          onToggleRegroup={() => void toggleRegroupPoint(selectedDestination, selectedIsRegroup)}
        />
      )}

      {activeRoute && currentNavigationStep && (
        <NavigationNightContext.Provider value={darkOutside && colorScheme !== 'dark'}>
          <NavigationBanner
            top={insets.top + spacing.sm}
            upcomingStep={upcomingNavigationStep}
            followingStep={followingNavigationStep}
            distanceToStepEnd={distanceToCurrentStepEnd}
            unitSystem={unitSystem}
            roadName={navigationRoadName}
            glanceAction={navigationGlanceAction}
            guidanceInstruction={navigationGuidanceInstruction}
            roadAlerts={navigationRoadAlerts}
            notice={navigationNotice}
            onHeight={setNavigationBannerHeight}
          />
          {/* Bottom-left, as in Google Maps: Re-centre once the map has been
              moved, otherwise the speedometer. */}
          {!navigationFollowing ? (
            <NavigationRecentreButton
              bottom={navigationSummaryHeight + spacing.md}
              onPress={() => void centreOnCurrentLocation()}
            />
          ) : (
            <NavigationSpeedBadge
              bottom={navigationSummaryHeight + spacing.md}
              navigationSpeedMps={navigationSpeedMps}
              unitSystem={unitSystem}
            />
          )}
          <NavigationTripSummary
            bottomPadding={Math.max(insets.bottom, spacing.sm)}
            arrivalLabel={navigationArrivalLabel}
            remainingSeconds={remainingNavigationSeconds}
            remainingMeters={remainingNavigationMeters}
            unitSystem={unitSystem}
            onHeight={setNavigationSummaryHeight}
            trafficText={activeRoute ? routeTrafficDelayText(activeRoute.durationSeconds, activeRoute.typicalDurationSeconds) : ''}
            onEnd={() => finishInAppNavigation(false)}
            tripDetails={tripDetails}
          />
        </NavigationNightContext.Provider>
      )}

      {drawerVisible && (
        <MapDrawer
          near={currentLocation}
          onRequestLocation={async () => { await requestCurrentLocation(true); }}
          onSelectPlace={selectPlace}
          onRouteToPlace={(place) => {
            selectPlace(place);
            void openDirections({ lat: place.lat, lon: place.lon, label: place.name });
          }}
          onGroupRide={() => navigation.navigate('Map', { segment: 'host', at: Date.now() })}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          onPeekHeight={setDrawerPeek}
          bottomInset={insets.bottom}
        />
      )}

      {/* Faded, not unmounted, while the drawer is open: the ride bar holds
          the group voice connection. */}
      <View
        style={[styles.rideBarSlot, (segment === 'public' || lockedForSafety) && styles.rideBarSlotFloating, { paddingBottom: bottomInset + spacing.sm }, drawerVisible && drawerOpen && styles.rideBarHidden]}
        pointerEvents={drawerVisible && drawerOpen ? 'none' : 'box-none'}
        onLayout={(event) => setRideBarHeight(event.nativeEvent.layout.height)}
      >
        <RideBar controlsVisible={!activeRoute} />
      </View>
      <ProximityVoice
        enabled={publicLive}
        peerIds={ridersInZone}
        summary={segment === 'public' && !activeRoute && ridersInZone.length > 0 && !selectedPlace && !selectedHazard && !error ? (
          <View
            style={styles.nearbyCount}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${ridersInZone.length} ${ridersInZone.length === 1 ? 'rider' : 'riders'} nearby. Exact locations are private.`}
          >
            <MaterialCommunityIcons name="account-multiple" size={16} color={colors.accent} />
            <Text style={styles.nearbyCountText}>
              {ridersInZone.length} {ridersInZone.length === 1 ? 'rider' : 'riders'} nearby · exact locations private
            </Text>
          </View>
        ) : undefined}
      />
      <LaunchCover mapReady={mapReady} hasFix={Boolean(currentLocation)} />
    </View>
  );
}
