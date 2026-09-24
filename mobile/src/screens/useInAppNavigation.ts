import * as React from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import type MapView from 'react-native-maps';
import { ApiError } from '../api/client';
import type { RiderCommsClient } from '../api/client';
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
  navigationPromptText,
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
import { bearingDegrees } from './mapMarkers';
import type { UnitSystem } from '../settings/SettingsContext';

const NAV_STEP_ARRIVAL_RADIUS_M = 30;
const NAV_OFF_ROUTE_RADIUS_M = 60;
const NAV_OFF_ROUTE_GRACE_MS = 10_000;
// styles.navigationActions' own footprint: the dock now stacks vertically,
// so its height is the worst case of all three 54px buttons showing with
// two 8px gaps between them -- kept as a named constant here because the
// adaptive camera's bottom-occlusion estimate needs to know it too, not
// just the styles (in MapScreen.tsx) that position it.
const NAVIGATION_ACTIONS_HEIGHT = 178;

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
  currentNavigationStep: InAppNavigationRoute['steps'][number] | null;
  fitRoute: (nextRoute: InAppNavigationRoute) => void;
  focusNavigationCamera: (
    here: { lat: number; lon: number },
    routeForCamera: InAppNavigationRoute,
    stepIndex: number,
    gpsHeading?: number | null,
    speedMps?: number | null,
  ) => void;
  finishInAppNavigation: (arrived?: boolean) => void;
  startInAppNavigation: (target: NavigationTarget) => Promise<void>;
  stopFollowingRoute: () => void;
  resumeFollowingRoute: () => void;
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
): InAppNavigation {
  const [activeRoute, setActiveRoute] = React.useState<InAppNavigationRoute | null>(null);
  const [navigationDestination, setNavigationDestination] = React.useState<NavigationTarget | null>(null);
  const [navigationStepIndex, setNavigationStepIndex] = React.useState(0);
  const [navigationLoading, setNavigationLoading] = React.useState(false);
  const [navigationNotice, setNavigationNotice] = React.useState<string | null>(null);
  const [navigationMuted, setNavigationMuted] = React.useState(false);
  const [navigationFollowing, setNavigationFollowing] = React.useState(true);
  const [navigationSpeedMps, setNavigationSpeedMps] = React.useState<number | null>(null);
  const navOffRouteSince = React.useRef<number | null>(null);
  const navRerouting = React.useRef(false);
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
    mapRef.current?.fitToCoordinates(
      nextRoute.coordinates.map((coordinate) => ({ latitude: coordinate.lat, longitude: coordinate.lon })),
      { edgePadding: { top: 170, right: 64, bottom: 180, left: 64 }, animated: true }
    );
    mapRef.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 250 });
  }, [mapRef, mapReady]);

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
    const topOcclusion = insets.top + spacing.sm + navigationBannerHeight;
    // Was a flat 112px guess that predated the navigation control dock
    // (Report/Mute/Overview-Follow) landing above the ETA summary bar --
    // undercounting the real occluded height by the dock's own footprint
    // pushed the rider's own puck down into that now-taller stack instead
    // of keeping it clear of it, worst right when a maneuver's zoom/pitch
    // changes amplify that same fixed offset in screen-pixel terms.
    const bottomOcclusion = Math.max(insets.bottom, spacing.sm) + navigationSummaryHeight + spacing.md + NAVIGATION_ACTIONS_HEIGHT;
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
  }, [insets.bottom, insets.top, mapRef, mapReady, navigationBannerHeight, navigationSummaryHeight, reduceMotionEnabled, spacing.md, spacing.sm, viewportHeight]);

  React.useEffect(() => {
    navigationFollowingRef.current = navigationFollowing;
  }, [navigationFollowing]);

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
      if (arrived && !navigationMutedRef.current) speakNavigationPrompt('You have arrived at your destination.');
    });
  }, [mapRef]);

  const requestInAppRoute = React.useCallback(async (origin: { lat: number; lon: number }, target: NavigationTarget, rerouting = false) => {
    if (rerouting) navRerouting.current = true;
    try {
      const nextRoute = await client.getDrivingRoute(origin, target);
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
  }, [client, focusNavigationCamera]);

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
        ? 'In-app navigation is not configured on the Rider Comms server yet. Choose Google Maps, Waze or Apple Maps in Settings.'
        : routeErrorCode === 'directions_no_route'
          ? 'No driving route was found for that destination.'
          : 'Rider Comms could not calculate that route. Try again or choose another navigation app.';
      Alert.alert('Couldn’t start navigation', message);
    } finally {
      setNavigationLoading(false);
    }
  }, [currentLocation, requestCurrentLocation, requestInAppRoute, setNavigationTarget, setSelectedHazardId, setSelectedPlace]);

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
    // activeRoute/navigationDestination gate whether this effect runs at
    // all; navigationStepIndexRef/navigationMutedRef (read inside the
    // callback below) keep it from restarting the subscription on every
    // step advance or mute toggle.
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
        currentLocationAccuracyRef.current = position.coords.accuracy ?? Number.POSITIVE_INFINITY;
        setCurrentLocation(here);
        setNavigationSpeedMps(Number.isFinite(position.coords.speed) && Number(position.coords.speed) >= 0
          ? Number(position.coords.speed)
          : null);

        const stepIndex = navigationStepIndexRef.current;
        const startingStep = activeRoute.steps[stepIndex];
        if (!startingStep) return;

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
          if (!navigationMutedRef.current && promptStage > progress.stage) {
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
        if (!navigationMutedRef.current) speakNavigationPrompt('Rerouting.');
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
  }, [activeRoute, currentLocationAccuracyRef, finishInAppNavigation, focusNavigationCamera, navigationDestination, requestInAppRoute, setCurrentLocation, unitSystem]);

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
    currentNavigationStep,
    fitRoute,
    focusNavigationCamera,
    finishInAppNavigation,
    startInAppNavigation,
    stopFollowingRoute,
    resumeFollowingRoute,
  };
}
