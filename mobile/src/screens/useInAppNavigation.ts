import * as React from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type MapView from 'react-native-maps';
import { ApiError } from '../api/client';
import type { PlaceAlongRoute, RiderCommsClient } from '../api/client';
import type { NavigationTarget } from '../navigationLinks';
import {
  distanceToPathMeters,
  lookAheadCoordinateOnPath,
  metersBetween,
  remainingDistanceOnPathMeters,
  type InAppNavigationRoute,
} from '../api/directions';
import {
  navigationPromptStageForDistance,
  navigationStepStartPrompt,
  navigationPromptText,
} from '../navigationGuidance';
import {
  combineNavigationCameraPaths,
  navigationCameraAltitudeMeters,
  navigationCameraProfile,
  navigationCentreAheadMeters,
  navigationMetresPerPoint,
  navigationRiderScreenOffset,
  nextNavigationCameraCorrection,
  offsetAlongHeading,
  stabilizeNavigationHeading,
} from '../navigationCamera';
import {
  NAV_GPS_CHECK_INTERVAL_MS,
  NavigationGpsTracker,
  isNavigationGpsNotice,
  navigationGpsNotice,
} from '../navigationGpsHealth';
import { speakNavigationPrompt, stopNavigationPrompt } from '../audio/navigationSpeech';
import { acquireNavigationAudioSession, releaseNavigationAudioSession } from '../audio/audioSession';
import { watchNavigationLocation, type NavigationLocationWatch } from '../navigationLocationStream';
import {
  buildNavigationPathIndex,
  matchFixToPath,
  navigationFixAgeSeconds,
  navigationPuckConeDegrees,
  navigationPuckTravelHeading,
  navigationRouteStatus,
  navigationTripSeconds,
  recordNavigationTripFix,
  routeAheadPath,
  routeChoices,
  stopsOnTheWay,
  FASTER_ROUTE_CHECK_MS,
  fasterRouteAnnouncement,
  fasterRouteSavingSeconds,
  startNavigationTrip,
  type NavigationTrip,
  type RouteChoice,
  type StopOnTheWay,
  predictNavigationPuck,
} from '@rider-comms/shared';
import { bearingDegrees } from './mapMarkers';
import type { UnitSystem } from '../settings/SettingsContext';
import { DEFAULT_ROUTE_AVOIDANCE, type RouteAvoidance } from '../routeOptionsPreference';
import type { CuratedRoute } from '../routes/curatedRoutes';
import { advanceCuratedStops, initialCuratedStops, type CuratedNavigationStop } from '../routes/curatedNavigation';

const NAV_STEP_ARRIVAL_RADIUS_M = 30;
/** Shown briefly after a successful reroute; styled as information, not a warning. */
export const ROUTE_UPDATED_NOTICE = 'Route updated.';
const ROUTE_UPDATED_NOTICE_MS = 4000;
const NAV_OFF_ROUTE_GRACE_MS = 10_000;
/** The puck and camera glide to where the rider will be when the next fix
 * is due (fixes arrive about once a second), so motion never stops. */
export const NAV_PUCK_GLIDE_MS = 1000;

/** Where to draw the navigation puck: now, and at the end of its glide. */
export interface NavigationPuckPlacement {
  now: { lat: number; lon: number };
  target: { lat: number; lon: number };
  glideMs: number;
  /** Screen direction of the cone around the puck; null hides it. */
  coneDegrees: number | null;
}

/** What the arrival card shows once the rider reaches the destination. */
export interface NavigationArrival {
  label: string | null;
  seconds: number;
  distanceMeters: number;
}

export interface InAppNavigation {
  activeRoute: InAppNavigationRoute | null;
  navigationDestination: NavigationTarget | null;
  navigationStepIndex: number;
  navigationLoading: boolean;
  navigationNotice: string | null;
  navigationMuted: boolean;
  setNavigationMuted: React.Dispatch<React.SetStateAction<boolean>>;
  navigationFollowing: boolean;
  navigationSpeedMps: number | null;
  navigationPuck: NavigationPuckPlacement | null;
  currentNavigationStep: InAppNavigationRoute['steps'][number] | null;
  fitRoute: (nextRoute: InAppNavigationRoute) => void;
  focusNavigationCamera: (
    here: { lat: number; lon: number },
    routeForCamera: InAppNavigationRoute,
    stepIndex: number,
    gpsHeading?: number | null,
    speedMps?: number | null,
    glideMs?: number,
  ) => void;
  finishInAppNavigation: (arrived?: boolean) => void;
  /** Set on arrival until the rider dismisses it or starts another route. */
  navigationArrival: NavigationArrival | null;
  dismissNavigationArrival: () => void;
  startInAppNavigation: (target: NavigationTarget) => Promise<void>;
  startCuratedNavigation: (route: CuratedRoute) => Promise<void>;
  curatedRemainingStops: CuratedNavigationStop[];
  stopFollowingRoute: () => void;
  resumeFollowingRoute: () => void;
  /** The ways there, labelled; empty with only one, or once rerouted. */
  routeChoices: RouteChoice[];
  /** Which of routeChoices is being followed. */
  chosenRouteIndex: number;
  chooseRoute: (index: number) => void;
  /** The stop on the way the route goes through, if any. */
  navigationStop: NavigationStop | null;
  findStopsOnTheWay: (query: string) => Promise<StopOnTheWay<PlaceAlongRoute>[]>;
  addNavigationStop: (place: { lat: number; lon: number; name: string }) => Promise<boolean>;
}

/**
 * Owns active in-app turn-by-turn navigation: requesting/rerouting the
 * route, the GPS watcher that advances steps and drives the adaptive
 * camera, and the voice-prompt announcements. This is the most
 * interdependent slice of MapScreen (map ref, camera state refs, GPS
 * subscription) -- extracted as a single cohesive move rather than split
 * further, to avoid restructuring the callback wiring between pieces that
 * depend tightly on each other's timing.
 */
export const NAVIGATION_KEEP_AWAKE_TAG = 'rider-comms-navigation';
/** Within this of a stop on the way, the rider has reached it. */
const NAV_STOP_REACHED_RADIUS_M = 80;

export interface NavigationStop { lat: number; lon: number; label: string }

export function useInAppNavigation(
  client: RiderCommsClient,
  mapRef: React.RefObject<MapView | null>,
  mapReady: boolean,
  reduceMotionEnabled: boolean,
  insets: { top: number; bottom: number },
  spacing: { sm: number; md: number },
  viewportHeight: number,
  navigationBannerHeight: number,
  navigationSummaryHeight: number,
  unitSystem: UnitSystem,
  currentLocation: { lat: number; lon: number } | null,
  currentLocationAccuracyRef: React.RefObject<number | null>,
  requestCurrentLocation: (showSettingsPrompt: boolean) => Promise<{ lat: number; lon: number } | null>,
  setCurrentLocation: (location: { lat: number; lon: number }) => void,
  setSelectedPlace: (place: null) => void,
  setNavigationTarget: (target: null) => void,
  setSelectedHazardId: (id: null) => void,
  routeAvoidance: RouteAvoidance = DEFAULT_ROUTE_AVOIDANCE,
  spokenDirections = true,
): InAppNavigation {
  // Settings → Voice and sound: each new route starts muted or not.
  const spokenDirectionsRef = React.useRef(spokenDirections);
  spokenDirectionsRef.current = spokenDirections;
  // Read through a ref so a settings change doesn't rebuild the route callbacks.
  const routeAvoidanceRef = React.useRef(routeAvoidance);
  routeAvoidanceRef.current = routeAvoidance;
  const [activeRoute, setActiveRoute] = React.useState<InAppNavigationRoute | null>(null);
  const [routeOptions, setRouteOptions] = React.useState<InAppNavigationRoute[]>([]);
  // The screen stays on while navigating, as in Google Maps, Waze and Apple
  // Maps: a rider glancing down mustn't find a locked phone (PWA: Screen
  // Wake Lock in 17-navigation.js).
  const navigating = activeRoute !== null;
  React.useEffect(() => {
    if (!navigating) return;
    activateKeepAwakeAsync(NAVIGATION_KEEP_AWAKE_TAG).catch(() => {});
    return () => { deactivateKeepAwake(NAVIGATION_KEEP_AWAKE_TAG).catch(() => {}); };
  }, [navigating]);
  const [navigationDestination, setNavigationDestination] = React.useState<NavigationTarget | null>(null);
  const [navigationStepIndex, setNavigationStepIndex] = React.useState(0);
  const [navigationLoading, setNavigationLoading] = React.useState(false);
  const [navigationNotice, setNavigationNotice] = React.useState<string | null>(null);
  const [navigationMuted, setNavigationMuted] = React.useState(false);
  const [navigationFollowing, setNavigationFollowing] = React.useState(true);
  const [navigationSpeedMps, setNavigationSpeedMps] = React.useState<number | null>(null);
  const [navigationPuck, setNavigationPuck] = React.useState<NavigationPuckPlacement | null>(null);
  const navOffRouteSince = React.useRef<number | null>(null);
  const navRerouting = React.useRef(false);
  // A stop on the way (petrol found along the route); every route asked for
  // goes through it until the rider gets there.
  const navigationStopRef = React.useRef<NavigationStop | null>(null);
  const [navigationStop, setNavigationStopState] = React.useState<NavigationStop | null>(null);
  const setNavigationStop = React.useCallback((stop: NavigationStop | null) => {
    navigationStopRef.current = stop;
    setNavigationStopState(stop);
  }, []);
  // The stop, as the last argument of a route request, only when there is one.
  const curatedStopsRef = React.useRef<CuratedNavigationStop[]>([]);
  const [curatedRemainingStops, setCuratedRemainingStops] = React.useState<CuratedNavigationStop[]>([]);
  const updateCuratedStops = React.useCallback((stops: CuratedNavigationStop[]) => {
    curatedStopsRef.current = stops;
    setCuratedRemainingStops(stops);
  }, []);
  // A petrol stop comes before the remaining curated stops, without replacing
  // the itinerary. This is the backend's ordered `waypoints` contract.
  const routeStops = (): [NavigationStop | null, CuratedNavigationStop[]] => [navigationStopRef.current, curatedStopsRef.current];
  // Where the rider is and how long is left there, from the latest fix, for
  // the faster-route check.
  const latestRouteProgress = React.useRef<{ route: InAppNavigationRoute; here: { lat: number; lon: number }; remainingSeconds: number } | null>(null);
  const navigationFollowingRef = React.useRef(true);
  // Read inside the GPS watchPositionAsync callback below instead of closing
  // over the state values directly, so that effect's own dependency array
  // doesn't need navigationStepIndex/navigationMuted -- without this, the
  // whole location subscription would tear down and re-subscribe on every
  // single maneuver step and every mute toggle, instead of only when
  // navigation actually starts or stops.
  const navigationStepIndexRef = React.useRef(0);
  const navigationMutedRef = React.useRef(false);
  const navigationCameraHeading = React.useRef<number | null>(null);
  // The map's rotation as last set by the app (heading-up follow, or north
  // up for the overview), for the puck's direction cone.
  const mapHeadingRef = React.useRef(0);
  // Time and distance since the route started (reroutes included).
  const tripRef = React.useRef<{ trip: NavigationTrip; label: string | null } | null>(null);
  const [navigationArrival, setNavigationArrival] = React.useState<NavigationArrival | null>(null);
  // Learned per device: how far the map SDK's real perspective is from the
  // shared camera model (Apple Maps and Google Maps differ).
  const navigationCameraCorrection = React.useRef(1);
  const navigationCameraFitTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const navGpsTracker = React.useRef(new NavigationGpsTracker());
  const announcedNavigationStep = React.useRef<{ route: InAppNavigationRoute; index: number } | null>(null);
  const navigationPromptProgress = React.useRef<{ route: InAppNavigationRoute; targetIndex: number; stage: number } | null>(null);
  const finalNavigationPrompt = React.useRef<{ route: InAppNavigationRoute; index: number } | null>(null);

  const currentNavigationStep = activeRoute?.steps[navigationStepIndex] ?? null;

  const fitRoute = React.useCallback((nextRoute: InAppNavigationRoute) => {
    if (!mapReady || nextRoute.coordinates.length < 2) return;
    navigationFollowingRef.current = false;
    setNavigationFollowing(false);
    navigationCameraHeading.current = null;
    mapHeadingRef.current = 0;
    mapRef.current?.fitToCoordinates(
      nextRoute.coordinates.map((coordinate) => ({ latitude: coordinate.lat, longitude: coordinate.lon })),
      {
        // At least what the banner and trip summary cover, so the route's
        // ends aren't drawn underneath them.
        edgePadding: {
          top: Math.max(170, insets.top + spacing.sm + navigationBannerHeight + 24),
          right: 64,
          bottom: Math.max(180, navigationSummaryHeight + 24),
          left: 64,
        },
        animated: true,
      }
    );
    mapRef.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 250 });
  }, [insets.top, mapRef, mapReady, navigationBannerHeight, navigationSummaryHeight, spacing.sm]);

  const focusNavigationCamera = React.useCallback((
    here: { lat: number; lon: number },
    routeForCamera: InAppNavigationRoute,
    stepIndex: number,
    gpsHeading?: number | null,
    speedMps?: number | null,
    glideMs = 0,
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
    const profile = navigationCameraProfile({
      speedMps,
      maneuverDistanceMeters: maneuverDistance,
      maneuver: upcomingStep?.maneuver,
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
    // Centre straight ahead along the camera heading so the rider stays
    // centred left-to-right and lands in the clear band between the banner
    // and the trip summary. The control dock sits at the right edge, clear
    // of a centred rider, so only the summary bounds the bottom.
    const topOcclusion = insets.top + spacing.sm + navigationBannerHeight;
    const aheadMeters = navigationCameraCorrection.current * navigationCentreAheadMeters({
      viewportHeight,
      topOcclusion,
      bottomOcclusion: navigationSummaryHeight,
      zoom: profile.zoom,
      pitch: profile.pitch,
      latitude: here.lat,
    });
    const centre = offsetAlongHeading(here.lat, here.lon, heading, aheadMeters);
    const camera = {
      center: { latitude: centre.lat, longitude: centre.lng },
      heading,
      pitch: profile.pitch,
      // Google Maps (Android) reads zoom; Apple Maps (iPhone) reads altitude.
      zoom: profile.zoom,
      altitude: navigationCameraAltitudeMeters({
        viewportHeight,
        zoom: profile.zoom,
        pitch: profile.pitch,
        latitude: here.lat,
      }),
    };
    // While moving, glide with the puck to its next predicted position.
    const gliding = glideMs > 0 && movingSpeed !== null && movingSpeed > 1.5;
    const transitionDuration = gliding ? glideMs : movingSpeed !== null && movingSpeed <= 1.5 ? 650 : 500;
    mapHeadingRef.current = heading;
    if (reduceMotionEnabled) {
      mapRef.current?.setCamera(camera);
    } else {
      mapRef.current?.animateCamera(camera, { duration: transitionDuration });
    }
    // Once the camera settles, check where the map really drew the rider
    // and nudge the learned correction towards the target.
    if (navigationCameraFitTimer.current) clearTimeout(navigationCameraFitTimer.current);
    navigationCameraFitTimer.current = setTimeout(() => {
      navigationCameraFitTimer.current = null;
      if (!navigationFollowingRef.current) return;
      const pointForCoordinate = mapRef.current?.pointForCoordinate;
      if (typeof pointForCoordinate !== 'function') return;
      void pointForCoordinate.call(mapRef.current, { latitude: here.lat, longitude: here.lon }).then((point) => {
        if (!navigationFollowingRef.current || !Number.isFinite(point?.y)) return;
        const metresPerPoint = navigationMetresPerPoint(profile.zoom, here.lat);
        navigationCameraCorrection.current = nextNavigationCameraCorrection(navigationCameraCorrection.current, {
          targetOffset: navigationRiderScreenOffset(viewportHeight, topOcclusion, navigationSummaryHeight),
          measuredOffset: point.y - viewportHeight / 2,
          flatOffset: metresPerPoint > 0 ? aheadMeters / metresPerPoint : Number.NaN,
          pitch: profile.pitch,
        });
      }).catch(() => {});
    }, (reduceMotionEnabled ? 0 : transitionDuration) + 80);
  }, [insets.top, mapRef, mapReady, navigationBannerHeight, navigationSummaryHeight, reduceMotionEnabled, spacing.sm, viewportHeight]);

  React.useEffect(() => {
    navigationFollowingRef.current = navigationFollowing;
  }, [navigationFollowing]);

  React.useEffect(() => () => {
    if (navigationCameraFitTimer.current) clearTimeout(navigationCameraFitTimer.current);
  }, []);

  React.useEffect(() => {
    if (navigationNotice !== ROUTE_UPDATED_NOTICE) return undefined;
    const timer = setTimeout(() => {
      setNavigationNotice((current) => (current === ROUTE_UPDATED_NOTICE ? null : current));
    }, ROUTE_UPDATED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [navigationNotice]);

  React.useEffect(() => {
    navigationStepIndexRef.current = navigationStepIndex;
  }, [navigationStepIndex]);

  React.useEffect(() => {
    navigationMutedRef.current = navigationMuted;
  }, [navigationMuted]);

  React.useEffect(() => {
    if (navigationMuted) void stopNavigationPrompt();
  }, [navigationMuted]);

  const finishInAppNavigation = React.useCallback((arrived = false) => {
    setActiveRoute(null);
    setNavigationPuck(null);
    setNavigationDestination(null);
    setNavigationStepIndex(0);
    announcedNavigationStep.current = null;
    navigationPromptProgress.current = null;
    finalNavigationPrompt.current = null;
    navOffRouteSince.current = null;
    navRerouting.current = false;
    navGpsTracker.current.reset();
    navigationCameraHeading.current = null;
    if (navigationCameraFitTimer.current) clearTimeout(navigationCameraFitTimer.current);
    navigationCameraFitTimer.current = null;
    navigationFollowingRef.current = true;
    setNavigationFollowing(true);
    setNavigationMuted(false);
    setNavigationSpeedMps(null);
    setNavigationNotice(arrived ? 'You’ve arrived.' : null);
    setRouteOptions([]);
    setNavigationStop(null);
    updateCuratedStops([]);
    const trip = tripRef.current;
    tripRef.current = null;
    setNavigationArrival(arrived && trip ? {
      label: trip.label,
      seconds: navigationTripSeconds(trip.trip, Date.now()),
      distanceMeters: trip.trip.distanceMeters,
    } : null);
    mapRef.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 350 });
    void stopNavigationPrompt().finally(() => {
      if (arrived && !navigationMutedRef.current) speakNavigationPrompt('You’ve arrived.');
    });
  }, [mapRef, setNavigationStop, updateCuratedStops]);

  const applyInAppRoute = React.useCallback((nextRoute: InAppNavigationRoute, origin: { lat: number; lon: number }, target: NavigationTarget, rerouting: boolean, notice: string = ROUTE_UPDATED_NOTICE) => {
    // The ways there, offered before setting off; a reroute offers none.
    const withoutAlternatives = ({ alternatives: _others, ...route }: InAppNavigationRoute): InAppNavigationRoute => route;
    const alternatives = nextRoute.alternatives ?? [];
    const chosen = nextRoute.alternatives ? withoutAlternatives(nextRoute) : nextRoute;
    setRouteOptions(rerouting || alternatives.length === 0 ? [] : [chosen, ...alternatives.map(withoutAlternatives)]);
    setActiveRoute(chosen);
    setNavigationDestination(target);
    setNavigationStepIndex(0);
    announcedNavigationStep.current = null;
    navigationPromptProgress.current = null;
    finalNavigationPrompt.current = null;
    setNavigationNotice(rerouting ? notice : null);
    navOffRouteSince.current = null;
    if (!rerouting) {
      navigationCameraHeading.current = null;
      setNavigationMuted(!spokenDirectionsRef.current);
      tripRef.current = { trip: startNavigationTrip(Date.now()), label: target.label ?? null };
      setNavigationArrival(null);
    }
    navigationFollowingRef.current = true;
    setNavigationFollowing(true);
    if (chosen.steps[0]) focusNavigationCamera(origin, chosen, 0);
  }, [focusNavigationCamera]);

  const requestInAppRoute = React.useCallback(async (origin: { lat: number; lon: number }, target: NavigationTarget, rerouting = false) => {
    if (rerouting) navRerouting.current = true;
    try {
      const nextRoute = await client.getDrivingRoute(origin, target, routeAvoidanceRef.current, ...routeStops());
      if (!rerouting) updateCuratedStops([]);
      applyInAppRoute(nextRoute, origin, target, rerouting);
    } finally {
      if (rerouting) navRerouting.current = false;
    }
  }, [applyInAppRoute, client, updateCuratedStops]);

  // Like Waze: every few minutes, ask for the way from here with live
  // traffic, and switch when it saves enough (shared fasterRouteSavingSeconds),
  // saying so rather than asking for a tap the rider can't make.
  const navigatingTo = activeRoute ? navigationDestination : null;
  React.useEffect(() => {
    if (!navigatingTo) return;
    let checking = false;
    const timer = setInterval(() => {
      const progress = latestRouteProgress.current;
      if (checking || navRerouting.current || !progress) return;
      checking = true;
      void client.getDrivingRoute(progress.here, navigatingTo, routeAvoidanceRef.current, ...routeStops())
        .then((candidate) => {
          const latest = latestRouteProgress.current;
          if (!latest || latest.route !== progress.route || navRerouting.current) return;
          const saving = fasterRouteSavingSeconds(latest.remainingSeconds, candidate.durationSeconds);
          if (saving <= 0) return;
          const announcement = fasterRouteAnnouncement(saving);
          applyInAppRoute(candidate, latest.here, navigatingTo, true, announcement);
          if (!navigationMutedRef.current) speakNavigationPrompt(announcement);
        })
        .catch(() => { /* No answer: keep the route the rider is on. */ })
        .finally(() => { checking = false; });
    }, FASTER_ROUTE_CHECK_MS);
    return () => clearInterval(timer);
  }, [applyInAppRoute, client, navigatingTo]);

  /** Petrol (or a café) along the rest of the route, ordered by what each
   * adds (shared routeAheadPath and stopsOnTheWay). */
  const findStopsOnTheWay = React.useCallback(async (query: string): Promise<StopOnTheWay<PlaceAlongRoute>[]> => {
    const route = activeRoute;
    const progress = latestRouteProgress.current;
    const here = progress?.route === route ? progress.here : currentLocation;
    if (!route || !here) return [];
    const path = routeAheadPath(route.coordinates, here);
    if (path.length < 2) return [];
    const { places } = await client.searchAlongRoute(query, path);
    return stopsOnTheWay(places, progress?.route === route ? progress.remainingSeconds : route.durationSeconds);
  }, [activeRoute, client, currentLocation]);

  /** Routes through a stop on the way, keeping the destination. */
  const addNavigationStop = React.useCallback(async (place: { lat: number; lon: number; name: string }): Promise<boolean> => {
    const progress = latestRouteProgress.current;
    const here = progress?.here ?? currentLocation;
    const target = navigationDestination;
    if (!here || !target) return false;
    const previous = navigationStopRef.current;
    setNavigationStop({ lat: place.lat, lon: place.lon, label: place.name });
    try {
      navRerouting.current = true;
      const route = await client.getDrivingRoute(here, target, routeAvoidanceRef.current, ...routeStops());
      const added = `Stop added: ${place.name}.`;
      applyInAppRoute(route, here, target, true, added);
      if (!navigationMutedRef.current) speakNavigationPrompt(added);
      return true;
    } catch {
      setNavigationStop(previous);
      setNavigationNotice('Couldn’t add that stop. Try again.');
      return false;
    } finally {
      navRerouting.current = false;
    }
  }, [applyInAppRoute, client, currentLocation, navigationDestination, setNavigationStop]);

  /** Switches to another of the offered ways there, before setting off. */
  const chooseRoute = React.useCallback((index: number) => {
    const route = routeOptions[index];
    if (!route || route === activeRoute) return;
    setActiveRoute(route);
    setNavigationStepIndex(0);
    announcedNavigationStep.current = null;
    navigationPromptProgress.current = null;
    finalNavigationPrompt.current = null;
    navOffRouteSince.current = null;
    navigationFollowingRef.current = true;
    setNavigationFollowing(true);
    const here = currentLocation ?? route.steps[0]?.start;
    if (here && route.steps[0]) focusNavigationCamera(here, route, 0);
  }, [activeRoute, currentLocation, focusNavigationCamera, routeOptions]);

  const startInAppNavigation = React.useCallback(async (target: NavigationTarget): Promise<void> => {
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
      const routeErrorCode = routeError instanceof ApiError
        && typeof routeError.body === 'object'
        && routeError.body
        && 'error' in (routeError.body as Record<string, unknown>)
        ? String((routeError.body as Record<string, unknown>).error)
        : routeError instanceof Error ? routeError.message : '';
      const message = routeErrorCode === 'directions_not_configured'
        ? 'Rider Comms navigation isn’t available right now. Choose Google Maps, Waze or Apple Maps in Settings → Map & navigation.'
        : routeErrorCode === 'directions_no_route'
          ? 'No driving route was found for that destination.'
          : 'Couldn’t plan that route. Try again or choose another navigation app.';
      Alert.alert('Couldn’t start navigation', message);
    } finally {
      setNavigationLoading(false);
    }
  }, [currentLocation, requestCurrentLocation, requestInAppRoute, setNavigationTarget, setSelectedHazardId, setSelectedPlace]);

  /** Start the *complete* curated itinerary, including the start checkpoint,
   * not a route to its first coordinate. No external navigation handoff. */
  const startCuratedNavigation = React.useCallback(async (route: CuratedRoute): Promise<void> => {
    const origin = currentLocation ?? await requestCurrentLocation(true);
    if (!origin) return;
    const pending = initialCuratedStops(route, origin);
    const destination = { lat: route.end.lat, lon: route.end.lon, label: route.name };
    setNavigationLoading(true);
    setNavigationNotice(null);
    try {
      const calculated = await client.getDrivingRoute(origin, destination, routeAvoidanceRef.current, undefined, pending);
      setNavigationStop(null);
      updateCuratedStops(pending);
      applyInAppRoute(calculated, origin, destination, false);
      setSelectedPlace(null);
      setNavigationTarget(null);
      setSelectedHazardId(null);
    } catch {
      Alert.alert('Couldn’t plan the scenic route', 'Rider Comms could not calculate the full journey through every planned stop. Check road conditions or try again.');
    } finally {
      setNavigationLoading(false);
    }
  }, [applyInAppRoute, client, currentLocation, requestCurrentLocation, setNavigationStop, setNavigationTarget, setSelectedHazardId, setSelectedPlace, updateCuratedStops]);

  React.useEffect(() => {
    if (!activeRoute || !currentNavigationStep || navigationMuted) return;
    const last = announcedNavigationStep.current;
    if (last?.route === activeRoute && last.index === navigationStepIndex) return;
    announcedNavigationStep.current = { route: activeRoute, index: navigationStepIndex };
    const finalPrompt = finalNavigationPrompt.current;
    const alreadySpokenAtTurn = finalPrompt?.route === activeRoute && finalPrompt.index === navigationStepIndex;
    // The instruction (unless said at the turn), then "Continue for 12 mi."
    // on a long road (shared navigationStepStartPrompt).
    const prompt = navigationStepStartPrompt(currentNavigationStep.instruction, currentNavigationStep.distanceMeters, unitSystem, alreadySpokenAtTurn);
    if (prompt) speakNavigationPrompt(prompt);
    // A change of units mid-route isn't a new step to announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Keeps iOS able to speak turn prompts with the screen locked. Keyed on
  // navigation running rather than the route, so a reroute while the phone
  // is locked doesn't stop and restart the audio session.
  const navigationRunning = activeRoute !== null;
  React.useEffect(() => {
    if (!navigationRunning) return;
    void acquireNavigationAudioSession().catch(() => {});
    return () => {
      void releaseNavigationAudioSession().catch(() => {});
    };
  }, [navigationRunning]);

  React.useEffect(() => {
    if (!activeRoute || !navigationDestination || !currentNavigationStep) return;
    // activeRoute/navigationDestination gate whether this effect runs at
    // all; navigationStepIndexRef/navigationMutedRef (read inside the
    // callback below) keep it from restarting the subscription on every
    // step advance or mute toggle.
    let cancelled = false;
    let subscription: NavigationLocationWatch | null = null;
    // Map matching (shared/src/navigationPuck.ts): the whole route as one
    // measured path, and how far along it the last fix matched.
    const puckPath = buildNavigationPathIndex(activeRoute.steps.flatMap((step) => step.coordinates));
    let puckAlongMeters: number | null = null;

    // Keeps delivering fixes with the phone locked (see navigationLocationStream).
    void watchNavigationLocation(
      (position) => {
        if (cancelled) return;
        const recovered = navGpsTracker.current.recordFix();
        if (recovered) {
          setNavigationNotice((current) => isNavigationGpsNotice(current) ? null : current);
        }
        const raw = { lat: position.coords.latitude, lon: position.coords.longitude };
        if (tripRef.current) {
          tripRef.current = {
            ...tripRef.current,
            trip: recordNavigationTripFix(tripRef.current.trip, { ...raw, accuracyMeters: position.coords.accuracy }),
          };
        }
        currentLocationAccuracyRef.current = position.coords.accuracy ?? Number.POSITIVE_INFINITY;
        setCurrentLocation(raw);
        const speed = Number.isFinite(position.coords.speed) && Number(position.coords.speed) >= 0
          ? Number(position.coords.speed)
          : null;
        setNavigationSpeedMps(speed);

        // Snap the fix onto the route and carry it forward by the rider's
        // speed. Off-route checks below keep using the raw fix.
        const nowMs = Date.now();
        const match = matchFixToPath(puckPath, {
          lat: raw.lat,
          lon: raw.lon,
          accuracyMeters: position.coords.accuracy,
          headingDegrees: position.coords.heading,
          speedMps: speed,
        }, puckAlongMeters);
        puckAlongMeters = match.distanceAlongMeters;
        const age = navigationFixAgeSeconds(position.timestamp, nowMs);
        const current = predictNavigationPuck(puckPath, match, speed, age);
        const ahead = predictNavigationPuck(puckPath, match, speed, age + NAV_PUCK_GLIDE_MS / 1000);
        const here = { lat: current.lat, lon: current.lon };
        const target = { lat: ahead.lat, lon: ahead.lon };
        // On the route, its direction is steadier than the GPS course.
        const cameraHeading = match.snapped && ahead.bearingDegrees !== null ? ahead.bearingDegrees : position.coords.heading;
        // Placed after the camera moves, so the cone is measured against the
        // map's new rotation.
        const placePuck = () => setNavigationPuck({
          now: here,
          target,
          glideMs: NAV_PUCK_GLIDE_MS,
          coneDegrees: navigationPuckConeDegrees(
            navigationPuckTravelHeading(match.snapped, ahead.bearingDegrees, position.coords.heading, speed),
            mapHeadingRef.current,
          ),
        });

        const stepIndex = navigationStepIndexRef.current;
        const startingStep = activeRoute.steps[stepIndex];
        if (!startingStep) {
          placePuck();
          return;
        }

        if (
          stepIndex === activeRoute.steps.length - 1 &&
          metersBetween(here, startingStep.end) <= NAV_STEP_ARRIVAL_RADIUS_M
        ) {
          finishInAppNavigation(true);
          return;
        }

        let effectiveIndex = stepIndex;
        while (effectiveIndex < activeRoute.steps.length - 1) {
          const step = activeRoute.steps[effectiveIndex]!;
          const nextStep = activeRoute.steps[effectiveIndex + 1]!;
          const reachedStepEnd = metersBetween(here, step.end) <= NAV_STEP_ARRIVAL_RADIUS_M;
          const alreadyOnNextStep = distanceToPathMeters(here, nextStep.coordinates) <= NAV_STEP_ARRIVAL_RADIUS_M * 1.5;
          if (!reachedStepEnd && !alreadyOnNextStep) break;
          effectiveIndex += 1;
        }
        if (effectiveIndex !== stepIndex) {
          setNavigationStepIndex(effectiveIndex);
        }

        const effectiveStep = activeRoute.steps[effectiveIndex]!;
        const stepLeft = effectiveStep.distanceMeters > 0
          ? Math.min(1, remainingDistanceOnPathMeters(here, effectiveStep.coordinates) / effectiveStep.distanceMeters)
          : 0;
        latestRouteProgress.current = {
          route: activeRoute,
          here: raw,
          remainingSeconds: effectiveStep.durationSeconds * stepLeft
            + activeRoute.steps.slice(effectiveIndex + 1).reduce((sum, step) => sum + step.durationSeconds, 0),
        };
        // Complete scenic checkpoints strictly in order on accurate fixes.
        // Missed turns and reroutes retain every unfinished point, rather
        // than silently changing the curated road sequence.
        const checkpoint = advanceCuratedStops(curatedStopsRef.current, raw, position.coords.accuracy);
        if (checkpoint.reached) {
          updateCuratedStops(checkpoint.remaining);
          const reached = `Passed ${checkpoint.reached.label}.`;
          setNavigationNotice(reached);
          if (!navigationMutedRef.current) speakNavigationPrompt(reached);
        }
        // At the stop: say so, and route straight on from here.
        const stop = navigationStopRef.current;
        if (stop && metersBetween(raw, stop) <= NAV_STOP_REACHED_RADIUS_M) {
          setNavigationStop(null);
          const reached = `You’ve reached ${stop.label}.`;
          setNavigationNotice(reached);
          if (!navigationMutedRef.current) speakNavigationPrompt(reached);
        }
        focusNavigationCamera(
          target,
          activeRoute,
          effectiveIndex,
          cameraHeading,
          // iOS reports -1 when it doesn't know the speed: pass "unknown",
          // not "stopped", so the camera keeps its riding zoom.
          speed,
          NAV_PUCK_GLIDE_MS,
        );
        placePuck();

        const upcomingIndex = effectiveIndex + 1;
        const upcomingStep = activeRoute.steps[upcomingIndex];
        if (upcomingStep) {
          let progress = navigationPromptProgress.current;
          if (progress?.route !== activeRoute || progress.targetIndex !== upcomingIndex) {
            progress = { route: activeRoute, targetIndex: upcomingIndex, stage: 0 };
            navigationPromptProgress.current = progress;
          }
          const maneuverDistance = remainingDistanceOnPathMeters(here, effectiveStep.coordinates);
          // Earlier at speed (shared): about a mile ahead at 70 mph.
          const promptStage = navigationPromptStageForDistance(maneuverDistance, speed);
          if (!navigationMutedRef.current && promptStage > progress.stage) {
            navigationPromptProgress.current = { ...progress, stage: promptStage };
            if (promptStage === 3) finalNavigationPrompt.current = { route: activeRoute, index: upcomingIndex };
            const prompt = navigationPromptText(upcomingStep.instruction, maneuverDistance, unitSystem, promptStage);
            if (prompt) speakNavigationPrompt(prompt);
          }
        }

        // A fix too uncertain to judge (tunnel, urban canyon) leaves the
        // off-route timer as it is; a rider who has turned is on the next step.
        const nextRouteStep = activeRoute.steps[effectiveIndex + 1];
        const routeStatus = navigationRouteStatus(
          distanceToPathMeters(raw, effectiveStep.coordinates),
          nextRouteStep ? distanceToPathMeters(raw, nextRouteStep.coordinates) : null,
          position.coords.accuracy,
        );
        if (routeStatus === 'unknown') return;
        if (routeStatus === 'on') {
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
        if (!navigationMutedRef.current) speakNavigationPrompt('Rerouting.');
        void requestInAppRoute(raw, navigationDestination, true).catch(() => {
          setNavigationNotice('Couldn’t reroute. Continue with caution.');
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
      currentLocationAccuracyRef.current = null;
      setNavigationSpeedMps(null);
      setNavigationNotice(navigationGpsNotice(health));
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
    // currentNavigationStep only gates whether this effect starts at all
    // (evaluated once per route); navigationMuted/navigationStepIndex are
    // deliberately excluded -- their current values are read from
    // navigationMutedRef/navigationStepIndexRef inside the callback above,
    // so muting or advancing a step doesn't tear down and re-subscribe the
    // GPS watcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoute, currentLocationAccuracyRef, finishInAppNavigation, focusNavigationCamera, navigationDestination, requestInAppRoute, setCurrentLocation, unitSystem, updateCuratedStops]);

  const dismissNavigationArrival = React.useCallback(() => setNavigationArrival(null), []);

  const stopFollowingRoute = React.useCallback(() => {
    navigationFollowingRef.current = false;
    setNavigationFollowing(false);
  }, []);

  const resumeFollowingRoute = React.useCallback(() => {
    navigationFollowingRef.current = true;
    setNavigationFollowing(true);
  }, []);

  return {
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
    /** The ways there, labelled (shared routeChoices); empty once rerouted. */
    routeChoices: routeOptions.length > 1 ? routeChoices(routeOptions) : [],
    chosenRouteIndex: activeRoute ? routeOptions.indexOf(activeRoute) : -1,
    chooseRoute,
    navigationStop,
    findStopsOnTheWay,
    addNavigationStop,
  };
}
