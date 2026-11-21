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
  routeTrafficLines,
  matchFixToPath,
  navigationOffRouteGraceMs,
  navigationPathAhead,
  navigationFixAgeSeconds,
  navigationPuckConeDegrees,
  navigationPuckTravelHeading,
  navigationRouteStatus,
  navigationTripSeconds,
  recordNavigationTripFix,
  routeAheadPath,
  routeChoices,
  routeIndexForStyle,
  routeStyleAvoidsMotorways,
  stopsOnTheWay,
  FASTER_ROUTE_CHECK_MS,
  fasterRouteAnnouncement,
  fasterRouteSavingSeconds,
  startNavigationTrip,
  type NavigationTrip,
  type RouteChoice,
  type RouteStyle,
  type StopOnTheWay,
  predictNavigationPuck,
  navigationArrival as arrivedAtDestination,
} from '@rider-comms/shared';
import { bearingDegrees } from './mapMarkers';
import type { UnitSystem } from '../settings/SettingsContext';
import { DEFAULT_ROUTE_AVOIDANCE, type RouteAvoidance } from '../routeOptionsPreference';
import type { CuratedRoute } from '../routes/curatedRoutes';
import {
  advanceCuratedStops,
  initialCuratedStops,
  CURATED_STOP_MAX_GPS_ACCURACY_METERS,
  CURATED_STOP_REACHED_METERS,
  type CuratedNavigationStop,
} from '../routes/curatedNavigation';

const NAV_STEP_ARRIVAL_RADIUS_M = 30;
/** Avoid repeated route requests while parked at the finish with missed stops. */
const CURATED_FINISH_REPLAN_COOLDOWN_MS = 30_000;
/** Shown briefly after a successful reroute; styled as information, not a warning. */
export const ROUTE_UPDATED_NOTICE = 'Route updated.';
const ROUTE_UPDATED_NOTICE_MS = 4000;
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

/** Room under the trip for the route preview card, and above it for the
 * from/to bar and the riding-style chips. */
const ROUTE_PREVIEW_SHEET_PADDING = 300;
const ROUTE_PREVIEW_TOP_PADDING = 210;

function withoutAlternatives(route: InAppNavigationRoute): InAppNavigationRoute {
  if (!('alternatives' in route)) return route;
  const { alternatives: _others, ...rest } = route;
  return rest;
}

/** The ways there, shown before Start (RoutePreviewSheet). */
export interface RoutePreview {
  target: NavigationTarget;
  /** Fastest, Twisty or No motorways, for this trip (shared RouteStyle). */
  style: RouteStyle;
  routes: InAppNavigationRoute[];
  /** Shared routeChoices for routes: time, tag (Fastest, Twisty, +6 min). */
  choices: RouteChoice[];
  /** The one Start will follow. */
  index: number;
  /** A stop added before Start (petrol, a café): every way goes through it. */
  stop?: NavigationStop | null;
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
  /** The route line to draw: what is still to ride, or all of it (null when not navigating). */
  navigationRouteLine: readonly { lat: number; lon: number }[] | null;
  navigationTrafficLines: ReadonlyArray<{ speed: 'slow' | 'jam'; coordinates: { lat: number; lon: number }[] }>;
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
  /** Plans the way there. Parked, it opens the route preview (the ways
   * there, then Start); with `preview: false` it starts on the fastest. */
  startInAppNavigation: (target: NavigationTarget, options?: { preview?: boolean }) => Promise<void>;
  /** The ways there before Start, as in Google Maps and Waze. */
  routePreview: RoutePreview | null;
  chooseRoutePreview: (index: number) => void;
  startRoutePreview: () => void;
  closeRoutePreview: () => void;
  /** Asks again with these avoid settings (motorways, tolls, ferries);
   * false, with the routes shown left as they were, when none comes back. */
  replanRoutePreview: (avoidance: RouteAvoidance) => Promise<boolean>;
  /** Asks again for a riding style (Fastest, Twisty, No motorways), for this
   * trip only; false, with the routes left as they were, when none comes back. */
  setRoutePreviewStyle: (style: RouteStyle) => Promise<boolean>;
  /** Takes the stop added before Start back out; false if no way comes back. */
  removeRoutePreviewStop: () => Promise<boolean>;
  startCuratedNavigation: (route: CuratedRoute) => Promise<void>;
  curatedRemainingStops: CuratedNavigationStop[];
  stopFollowingRoute: () => void;
  resumeFollowingRoute: () => void;
  /** The stop on the way the route goes through, if any. */
  navigationStop: NavigationStop | null;
  findStopsOnTheWay: (query: string) => Promise<StopOnTheWay<PlaceAlongRoute>[]>;
  addNavigationStop: (place: { lat: number; lon: number; name: string }) => Promise<boolean>;
  /** Drops the stop on the way (not wanted after all) and routes on from here. */
  skipNavigationStop: () => Promise<boolean>;
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
  requestCurrentLocation: (showSettingsPrompt: boolean, accuracy?: Location.Accuracy) => Promise<{ lat: number; lon: number; accuracyMeters?: number | null } | null>,
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
  const [routePreview, setRoutePreview] = React.useState<(RoutePreview & { origin: { lat: number; lon: number }; stop: NavigationStop | null }) | null>(null);
  const routePreviewRef = React.useRef(routePreview);
  routePreviewRef.current = routePreview;
  // Set once planRoutePreview exists (below), for adding a stop before Start.
  const planRoutePreviewRef = React.useRef<(avoidance: RouteAvoidance, style: RouteStyle, stop?: NavigationStop | null) => Promise<boolean>>(async () => false);
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
  /** The route still to ride (PWA: trimNavigationRouteLine); null draws all of it. */
  const [routeLineAhead, setRouteLineAhead] = React.useState<{ lat: number; lon: number }[] | null>(null);
  // How far along the route the drawn line now starts (the ridden part is
  // dropped), so the traffic colours drop away with it.
  const [routeLineFromMeters, setRouteLineFromMeters] = React.useState<number | null>(null);
  const navOffRouteSince = React.useRef<number | null>(null);
  const curatedFinishReplanAt = React.useRef<number | null>(null);
  // When the rider stopped close to the destination (shared navigationArrival).
  const arrivalStoppedSince = React.useRef<number | null>(null);
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
  const routeStops = React.useCallback((): [NavigationStop | null, CuratedNavigationStop[]] => [navigationStopRef.current, curatedStopsRef.current], []);
  // Preserve the three-argument contract for an ordinary navigation journey.
  // The fourth argument is used only for a single ad-hoc stop; the fifth is
  // reserved for a curated route's actual remaining checkpoints. This also
  // keeps existing routing and fuel-stop behaviour unchanged.
  const getRouteThroughStops = React.useCallback((
    origin: { lat: number; lon: number },
    target: NavigationTarget,
    via: NavigationStop | null,
    planned: readonly CuratedNavigationStop[],
  ): Promise<InAppNavigationRoute> => {
    if (planned.length) return client.getDrivingRoute(origin, target, routeAvoidanceRef.current, via, planned);
    if (via) return client.getDrivingRoute(origin, target, routeAvoidanceRef.current, via);
    return client.getDrivingRoute(origin, target, routeAvoidanceRef.current);
  }, [client]);
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

  const fitRoute = React.useCallback((nextRoute: Pick<InAppNavigationRoute, 'coordinates'>, bottomPadding?: number, topPadding?: number) => {
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
          top: topPadding ?? Math.max(170, insets.top + spacing.sm + navigationBannerHeight + 24),
          right: 64,
          bottom: bottomPadding ?? Math.max(180, navigationSummaryHeight + 24),
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
    setRouteLineAhead(null);
    setRouteLineFromMeters(null);
    setNavigationDestination(null);
    setNavigationStepIndex(0);
    announcedNavigationStep.current = null;
    navigationPromptProgress.current = null;
    finalNavigationPrompt.current = null;
    navOffRouteSince.current = null;
    curatedFinishReplanAt.current = null;
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
    setNavigationStop(null);
    updateCuratedStops([]);
    arrivalStoppedSince.current = null;
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
    // The ways there were offered in the route preview; guidance follows one.
    const chosen = withoutAlternatives(nextRoute);
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
      const [via, pending] = routeStops();
      const nextRoute = await getRouteThroughStops(origin, target, rerouting ? via : null, rerouting ? pending : []);
      if (!rerouting) {
        updateCuratedStops([]);
        setNavigationStop(null);
      }
      applyInAppRoute(nextRoute, origin, target, rerouting);
    } finally {
      if (rerouting) navRerouting.current = false;
    }
  }, [applyInAppRoute, getRouteThroughStops, routeStops, setNavigationStop, updateCuratedStops]);

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
      const [via, planned] = routeStops();
      void getRouteThroughStops(progress.here, navigatingTo, via, planned)
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
  }, [applyInAppRoute, getRouteThroughStops, navigatingTo, routeStops]);

  /** Petrol (or a café) along the rest of the route, ordered by what each
   * adds (shared routeAheadPath and stopsOnTheWay). */
  const findStopsOnTheWay = React.useCallback(async (query: string): Promise<StopOnTheWay<PlaceAlongRoute>[]> => {
    const planning = routePreviewRef.current;
    if (!activeRoute && planning) {
      // Before Start: along the whole of the way shown.
      const way = planning.routes[planning.index];
      if (!way || way.coordinates.length < 2) return [];
      const { places } = await client.searchAlongRoute(query, way.coordinates);
      return stopsOnTheWay(places, way.durationSeconds);
    }
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
    if (!activeRoute && routePreviewRef.current) {
      const planning = routePreviewRef.current;
      const added = await planRoutePreviewRef.current(routeAvoidanceRef.current, planning.style, { lat: place.lat, lon: place.lon, label: place.name });
      // Only while still choosing: if Ride Safe has started the route
      // meanwhile, a moving rider gets no alert.
      if (!added && routePreviewRef.current) Alert.alert('Couldn’t add that stop', 'The route shown is unchanged. Try again.');
      return added;
    }
    const progress = latestRouteProgress.current;
    const here = progress?.here ?? currentLocation;
    const target = navigationDestination;
    if (!here || !target) return false;
    const previous = navigationStopRef.current;
    setNavigationStop({ lat: place.lat, lon: place.lon, label: place.name });
    try {
      navRerouting.current = true;
      const [via, planned] = routeStops();
      const route = await getRouteThroughStops(here, target, via, planned);
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
  }, [activeRoute, applyInAppRoute, currentLocation, getRouteThroughStops, navigationDestination, routeStops, setNavigationStop]);

  /** Not stopping after all: drop the stop and route straight on, so
   * reroutes stop steering back to it (PWA: skipNavStop). */
  const skipNavigationStop = React.useCallback(async (): Promise<boolean> => {
    const stop = navigationStopRef.current;
    const progress = latestRouteProgress.current;
    const here = progress?.here ?? currentLocation;
    const target = navigationDestination;
    if (!stop || !here || !target || !activeRoute) return false;
    setNavigationStop(null);
    try {
      navRerouting.current = true;
      const [, planned] = routeStops();
      const route = await getRouteThroughStops(here, target, null, planned);
      const skipped = `Skipped ${stop.label}.`;
      applyInAppRoute(route, here, target, true, skipped);
      if (!navigationMutedRef.current) speakNavigationPrompt(skipped);
      return true;
    } catch {
      setNavigationStop(stop);
      setNavigationNotice('Couldn’t skip that stop. Try again.');
      return false;
    } finally {
      navRerouting.current = false;
    }
  }, [activeRoute, applyInAppRoute, currentLocation, getRouteThroughStops, navigationDestination, routeStops, setNavigationStop]);

  const fitPreview = React.useCallback((routes: readonly InAppNavigationRoute[]) => {
    fitRoute({ coordinates: routes.flatMap((route) => route.coordinates) }, ROUTE_PREVIEW_SHEET_PADDING, insets.top + ROUTE_PREVIEW_TOP_PADDING);
  }, [fitRoute, insets.top]);

  const clearPlaceCards = React.useCallback(() => {
    setSelectedPlace(null);
    setNavigationTarget(null);
    setSelectedHazardId(null);
  }, [setNavigationTarget, setSelectedHazardId, setSelectedPlace]);

  const startInAppNavigation = React.useCallback(async (target: NavigationTarget, { preview = true }: { preview?: boolean } = {}): Promise<void> => {
    const fix = currentLocation ?? await requestCurrentLocation(true);
    if (!fix) return;
    const origin = { lat: fix.lat, lon: fix.lon };
    setNavigationLoading(true);
    setNavigationNotice(null);
    try {
      const planned = await getRouteThroughStops(origin, target, null, []);
      updateCuratedStops([]);
      setNavigationStop(null);
      const routes = [planned, ...(planned.alternatives ?? [])].map(withoutAlternatives);
      const fastest = routeIndexForStyle(routes, 'fastest');
      if (preview) {
        // The ways there first, with the whole trip in view between the
        // from/to bar and the card.
        setRoutePreview({ origin, target, style: 'fastest', routes, choices: routeChoices(routes), index: fastest, stop: null });
        fitPreview(routes);
      } else {
        applyInAppRoute(routes[fastest]!, origin, target, false);
        clearPlaceCards();
      }
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
  }, [applyInAppRoute, clearPlaceCards, currentLocation, fitPreview, getRouteThroughStops, requestCurrentLocation, setNavigationStop, updateCuratedStops]);

  const chooseRoutePreview = React.useCallback((index: number) => {
    setRoutePreview((current) => current && current.routes[index] ? { ...current, index } : current);
  }, []);

  const closeRoutePreview = React.useCallback(() => setRoutePreview(null), []);


  /** Asks Google again for the preview's ways there: the riding style
   * decides motorways (shared routeStyleAvoidsMotorways) and which way is
   * shown first; tolls and ferries come from the rider's settings. */
  const planRoutePreview = React.useCallback(async (
    avoidance: RouteAvoidance,
    style: RouteStyle,
    stop: NavigationStop | null | undefined = routePreviewRef.current?.stop,
  ): Promise<boolean> => {
    const planning = routePreviewRef.current;
    if (!planning) return false;
    setNavigationLoading(true);
    try {
      const asked = { ...avoidance, highways: routeStyleAvoidsMotorways(style, avoidance.highways) };
      // Google offers no other ways for a trip with a stop.
      const planned = stop
        ? await client.getDrivingRoute(planning.origin, planning.target, asked, stop)
        : await client.getDrivingRoute(planning.origin, planning.target, asked);
      if (routePreviewRef.current !== planning) return false;
      const routes = [planned, ...(planned.alternatives ?? [])].map(withoutAlternatives);
      setRoutePreview({ ...planning, style, stop: stop ?? null, routes, choices: routeChoices(routes), index: routeIndexForStyle(routes, style) });
      fitPreview(routes);
      return true;
    } catch {
      return false;
    } finally {
      setNavigationLoading(false);
    }
  }, [client, fitPreview]);
  planRoutePreviewRef.current = planRoutePreview;

  const removeRoutePreviewStop = React.useCallback(async (): Promise<boolean> => {
    const planning = routePreviewRef.current;
    if (!planning?.stop) return false;
    const removed = await planRoutePreview(routeAvoidanceRef.current, planning.style, null);
    if (!removed && routePreviewRef.current) Alert.alert('Couldn’t remove the stop', 'The route shown is unchanged. Try again.');
    return removed;
  }, [planRoutePreview]);

  const replanRoutePreview = React.useCallback(
    (avoidance: RouteAvoidance) => planRoutePreview(avoidance, routePreviewRef.current?.style ?? 'fastest'),
    [planRoutePreview],
  );

  const setRoutePreviewStyle = React.useCallback(async (style: RouteStyle): Promise<boolean> => {
    if (!routePreviewRef.current || routePreviewRef.current.style === style) return false;
    return planRoutePreview(routeAvoidanceRef.current, style);
  }, [planRoutePreview]);

  const startRoutePreview = React.useCallback(() => {
    if (!routePreview) return;
    const { routes, index, origin, target, stop } = routePreview;
    setRoutePreview(null);
    applyInAppRoute(routes[index]!, origin, target, false);
    // Reroutes keep going through the stop until the rider gets there.
    setNavigationStop(stop);
    clearPlaceCards();
  }, [applyInAppRoute, clearPlaceCards, routePreview, setNavigationStop]);

  /** Start the *complete* curated itinerary, including the start checkpoint,
   * not a route to its first coordinate. No external navigation handoff. */
  const startCuratedNavigation = React.useCallback(async (route: CuratedRoute): Promise<void> => {
    // A fresh location fix is required before deciding whether the first
    // checkpoint has already been reached.
    const fix = await requestCurrentLocation(true, Location.Accuracy.High);
    if (!fix) return;
    // Accuracy is metadata for checkpoint decisions, not a route coordinate.
    const origin = { lat: fix.lat, lon: fix.lon };
    const pending = initialCuratedStops(route, origin, fix.accuracyMeters);
    const destination = { lat: route.end.lat, lon: route.end.lon, label: route.name };
    setNavigationLoading(true);
    setNavigationNotice(null);
    try {
      const calculated = await client.getDrivingRoute(origin, destination, routeAvoidanceRef.current, undefined, pending);
      setNavigationStop(null);
      curatedFinishReplanAt.current = null;
      updateCuratedStops(pending);
      applyInAppRoute(calculated, origin, destination, false);
      setSelectedPlace(null);
      setNavigationTarget(null);
      setSelectedHazardId(null);
    } catch {
      Alert.alert('Couldn’t plan the scenic route', 'Couldn’t calculate the full route through every planned stop. Check road conditions and try again.');
    } finally {
      setNavigationLoading(false);
    }
  }, [applyInAppRoute, client, requestCurrentLocation, setNavigationStop, setNavigationTarget, setSelectedHazardId, setSelectedPlace, updateCuratedStops]);

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
    let lineFromMeters: number | null = null;
    setRouteLineAhead(null);
    setRouteLineFromMeters(null);

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
        // Drop the ridden part of the line every few metres, as Google and
        // Apple Maps do.
        if (match.snapped && (lineFromMeters === null || Math.abs(match.distanceAlongMeters - lineFromMeters) >= 5)) {
          const ahead = navigationPathAhead(puckPath, match.distanceAlongMeters);
          if (ahead.length >= 2) {
            lineFromMeters = match.distanceAlongMeters;
            setRouteLineAhead(ahead);
            setRouteLineFromMeters(match.distanceAlongMeters);
          }
        }
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

        // Confirm curated checkpoints using the raw GPS fix before checking
        // for arrival. Reaching the destination must not discard a viewpoint
        // that the rider never passed (including after a GPS interruption).
        const checkpoint = advanceCuratedStops(curatedStopsRef.current, raw, position.coords.accuracy);
        if (checkpoint.reached) {
          updateCuratedStops(checkpoint.remaining);
          const reached = `Passed ${checkpoint.reached.label}.`;
          setNavigationNotice(reached);
          if (!navigationMutedRef.current) speakNavigationPrompt(reached);
        }

        // Arrived: at the end point, or parked close to it (shared
        // navigationArrival). Curated routes keep their own checkpoint rules.
        const arrival = stepIndex === activeRoute.steps.length - 1 && curatedStopsRef.current.length === 0
          ? arrivedAtDestination({
            distanceMeters: metersBetween(here, startingStep.end),
            rawDistanceMeters: metersBetween(raw, startingStep.end),
            accuracyMeters: position.coords.accuracy,
            speedMps: speed,
            nowMs,
            stoppedSinceMs: arrivalStoppedSince.current,
          })
          : null;
        arrivalStoppedSince.current = arrival?.stoppedSinceMs ?? null;
        if (arrival?.arrived) {
          finishInAppNavigation(true);
          return;
        }
        if (
          stepIndex === activeRoute.steps.length - 1 &&
          metersBetween(here, startingStep.end) <= NAV_STEP_ARRIVAL_RADIUS_M
        ) {
          if (curatedStopsRef.current.length === 0) {
            finishInAppNavigation(true);
            return;
          }
          // The map puck may be snapped/predicted; only a reliable *raw* fix
          // near the finish authorises a recovery reroute. Retry at most once
          // per cooldown so a failed provider request cannot loop each fix.
          placePuck();
          const accuracy = position.coords.accuracy;
          const atFinish = accuracy != null && Number.isFinite(accuracy)
            && accuracy >= 0 && accuracy <= CURATED_STOP_MAX_GPS_ACCURACY_METERS
            && metersBetween(raw, startingStep.end) + accuracy <= CURATED_STOP_REACHED_METERS;
          const previous = curatedFinishReplanAt.current;
          if (atFinish && !navRerouting.current
            && (previous === null || nowMs - previous >= CURATED_FINISH_REPLAN_COOLDOWN_MS)) {
            curatedFinishReplanAt.current = nowMs;
            navOffRouteSince.current = null;
            const count = curatedStopsRef.current.length;
            setNavigationNotice(`${count} planned ${count === 1 ? 'stop' : 'stops'} remaining. Recalculating…`);
            void requestInAppRoute(raw, navigationDestination, true).catch(() => {
              setNavigationNotice('Couldn’t restore the remaining planned stops. Continue with caution.');
            });
          }
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
        // Shorter at speed (shared navigationOffRouteGraceMs).
        if (Date.now() - navOffRouteSince.current < navigationOffRouteGraceMs(speed) || navRerouting.current) return;

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

  const navigationTrafficLines = React.useMemo(
    () => (activeRoute ? routeTrafficLines(activeRoute.coordinates, activeRoute.traffic, routeLineFromMeters) : []),
    [activeRoute, routeLineFromMeters],
  );

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
    /** The line to draw: what's still to ride, or the whole route. */
    navigationRouteLine: activeRoute ? (routeLineAhead ?? activeRoute.coordinates) : null,
    /** Slow and jammed stretches still ahead, drawn over the line (Google Maps' traffic colours). */
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
    routePreview: routePreview ? { target: routePreview.target, style: routePreview.style, routes: routePreview.routes, choices: routePreview.choices, index: routePreview.index, stop: routePreview.stop } : null,
    chooseRoutePreview,
    startRoutePreview,
    closeRoutePreview,
    replanRoutePreview,
    setRoutePreviewStyle,
    removeRoutePreviewStop,
    navigationStop,
    findStopsOnTheWay,
    addNavigationStop,
    skipNavigationStop,
  };
}
