import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { act, renderHook } from '@testing-library/react-native';
import { ApiError } from '../../src/api/client';
import type { RiderCommsClient } from '../../src/api/client';
import type { InAppNavigationRoute } from '../../src/api/directions';
import type { NavigationTarget } from '../../src/navigationLinks';
import {
  NAV_GPS_PERMISSION_NOTICE,
  NAV_GPS_STALE_AFTER_MS,
  NAV_GPS_STALE_NOTICE,
} from '../../src/navigationGpsHealth';
import { FASTER_ROUTE_CHECK_MS } from '@rider-comms/shared';
import { NAVIGATION_KEEP_AWAKE_TAG, useInAppNavigation } from '../../src/screens/useInAppNavigation';
import { CURATED_ROUTES } from '../../src/routes/curatedRoutes';

const mockSpeakNavigationPrompt = jest.fn();
const mockStopNavigationPrompt = jest.fn(async () => undefined);

jest.mock('../../src/audio/navigationSpeech', () => ({
  speakNavigationPrompt: (...args: unknown[]) => mockSpeakNavigationPrompt(...args),
  stopNavigationPrompt: () => mockStopNavigationPrompt(),
}));

// mapMarkers pulls in react-native-maps and several UI components; the hook
// only needs its bearing helper, so swap the module for that alone.
jest.mock('../../src/screens/mapMarkers', () => ({
  bearingDegrees: () => 0,
}));

type PositionCallback = (position: {
  coords: { latitude: number; longitude: number; accuracy: number | null; speed: number | null; heading: number | null };
}) => void;

const mockWatchNavigationLocation = jest.fn();
const mockGetForegroundPermissionsAsync = jest.fn();
const mockAcquireNavigationAudioSession = jest.fn(async () => undefined);
const mockReleaseNavigationAudioSession = jest.fn(async () => undefined);

const mockActivateKeepAwake = jest.fn(async (_tag: string) => undefined);
const mockDeactivateKeepAwake = jest.fn(async (_tag: string) => undefined);
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: (tag: string) => mockActivateKeepAwake(tag),
  deactivateKeepAwake: (tag: string) => mockDeactivateKeepAwake(tag),
}));

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) => mockGetForegroundPermissionsAsync(...args),
  Accuracy: { High: 4 },
}));

jest.mock('../../src/navigationLocationStream', () => ({
  watchNavigationLocation: (...args: unknown[]) => mockWatchNavigationLocation(...args),
}));

jest.mock('../../src/audio/audioSession', () => ({
  acquireNavigationAudioSession: () => mockAcquireNavigationAudioSession(),
  releaseNavigationAudioSession: () => mockReleaseNavigationAudioSession(),
}));

// Three steps near 51.5N: north 222m, east ~208m, north 222m to the
// destination. 0.0001 degrees of latitude is ~11m.
const ROUTE: InAppNavigationRoute = {
  coordinates: [
    { lat: 51.5, lon: -0.1 },
    { lat: 51.502, lon: -0.1 },
    { lat: 51.502, lon: -0.097 },
    { lat: 51.504, lon: -0.097 },
  ],
  distanceMeters: 652,
  durationSeconds: 90,
  steps: [
    {
      instruction: 'Head north on Mill Lane',
      distanceMeters: 222,
      durationSeconds: 30,
      start: { lat: 51.5, lon: -0.1 },
      end: { lat: 51.502, lon: -0.1 },
      coordinates: [{ lat: 51.5, lon: -0.1 }, { lat: 51.502, lon: -0.1 }],
    },
    {
      instruction: 'Turn right onto High Street',
      maneuver: 'turn-right',
      distanceMeters: 208,
      durationSeconds: 30,
      start: { lat: 51.502, lon: -0.1 },
      end: { lat: 51.502, lon: -0.097 },
      coordinates: [{ lat: 51.502, lon: -0.1 }, { lat: 51.502, lon: -0.097 }],
    },
    {
      instruction: 'Turn left onto Station Road',
      maneuver: 'turn-left',
      distanceMeters: 222,
      durationSeconds: 30,
      start: { lat: 51.502, lon: -0.097 },
      end: { lat: 51.504, lon: -0.097 },
      coordinates: [{ lat: 51.502, lon: -0.097 }, { lat: 51.504, lon: -0.097 }],
    },
  ],
};

const DESTINATION: NavigationTarget = { lat: 51.504, lon: -0.097, label: 'Cafe' };

function fakeMap() {
  return {
    fitToCoordinates: jest.fn(),
    animateCamera: jest.fn(),
    setCamera: jest.fn(),
  };
}

interface Props {
  client: { getDrivingRoute: jest.Mock };
  mapRef: { current: ReturnType<typeof fakeMap> | null };
  mapReady: boolean;
  reduceMotionEnabled: boolean;
  currentLocation: { lat: number; lon: number } | null;
  currentLocationAccuracyRef: { current: number | null };
  requestCurrentLocation: jest.Mock;
  setCurrentLocation: jest.Mock;
  setSelectedPlace: jest.Mock;
  setNavigationTarget: jest.Mock;
  setSelectedHazardId: jest.Mock;
  routeAvoidance?: { highways: boolean; tolls: boolean; ferries: boolean };
}

const INSETS = { top: 44, bottom: 34 };
const SPACING = { sm: 8, md: 16 };

async function renderNavigation(overrides: Partial<Props> = {}) {
  const props: Props = {
    client: { getDrivingRoute: jest.fn(async () => ROUTE) },
    mapRef: { current: fakeMap() },
    mapReady: true,
    reduceMotionEnabled: false,
    currentLocation: { lat: 51.5, lon: -0.1 },
    currentLocationAccuracyRef: { current: null },
    requestCurrentLocation: jest.fn(async () => ({ lat: 51.5, lon: -0.1, accuracyMeters: 5 })),
    setCurrentLocation: jest.fn(),
    setSelectedPlace: jest.fn(),
    setNavigationTarget: jest.fn(),
    setSelectedHazardId: jest.fn(),
    ...overrides,
  };

  return { props, ...await renderHook(
    (p: Props) => useInAppNavigation(
      p.client as unknown as RiderCommsClient,
      p.mapRef as never,
      p.mapReady,
      p.reduceMotionEnabled,
      INSETS,
      SPACING,
      800,
      96,
      72,
      'km',
      p.currentLocation,
      p.currentLocationAccuracyRef,
      p.requestCurrentLocation,
      p.setCurrentLocation,
      p.setSelectedPlace,
      p.setNavigationTarget,
      p.setSelectedHazardId,
      p.routeAvoidance,
    ),
    { initialProps: props },
  ) };
}

let mockRemove: jest.Mock;

function lastPositionCallback(): PositionCallback {
  const calls = mockWatchNavigationLocation.mock.calls;
  return calls[calls.length - 1]![0] as PositionCallback;
}

async function sendFix(lat: number, lon: number, speed: number | null = 8, heading: number | null = 0, accuracy: number | null = 5) {
  await act(async () => {
    lastPositionCallback()({ coords: { latitude: lat, longitude: lon, accuracy, speed, heading } });
  });
}

async function startNavigation(overrides: Partial<Props> = {}) {
  const rendered = await renderNavigation(overrides);
  await act(async () => {
    await rendered.result.current.startInAppNavigation(DESTINATION, { preview: false });
  });
  return rendered;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSpeakNavigationPrompt.mockClear();
  mockStopNavigationPrompt.mockClear();
  mockRemove = jest.fn();
  mockWatchNavigationLocation.mockReset();
  mockWatchNavigationLocation.mockImplementation(async () => ({ background: true, remove: mockRemove }));
  mockAcquireNavigationAudioSession.mockClear();
  mockReleaseNavigationAudioSession.mockClear();
  mockGetForegroundPermissionsAsync.mockReset();
  mockGetForegroundPermissionsAsync.mockResolvedValue({ granted: true });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('starts navigation from the current location and announces the first step', async () => {
  const { result, props } = await startNavigation();

  expect(props.client.getDrivingRoute).toHaveBeenCalledWith({ lat: 51.5, lon: -0.1 }, DESTINATION, { highways: false, tolls: false, ferries: false });
  expect(props.requestCurrentLocation).not.toHaveBeenCalled();
  expect(result.current.activeRoute).toBe(ROUTE);
  expect(result.current.navigationDestination).toBe(DESTINATION);
  expect(result.current.navigationStepIndex).toBe(0);
  expect(result.current.currentNavigationStep).toBe(ROUTE.steps[0]);
  expect(result.current.navigationLoading).toBe(false);
  expect(result.current.navigationFollowing).toBe(true);
  expect(props.setSelectedPlace).toHaveBeenCalledWith(null);
  expect(props.setNavigationTarget).toHaveBeenCalledWith(null);
  expect(props.setSelectedHazardId).toHaveBeenCalledWith(null);
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('Head north on Mill Lane');
  expect(props.mapRef.current!.animateCamera).toHaveBeenCalled();
  expect(mockWatchNavigationLocation).toHaveBeenCalledTimes(1);
  expect(mockAcquireNavigationAudioSession).toHaveBeenCalledTimes(1);
});

test('a long first road says how far it goes', async () => {
  const longRoute = { ...ROUTE, steps: [{ ...ROUTE.steps[0]!, distanceMeters: 19_312 }, ...ROUTE.steps.slice(1)] };
  await startNavigation({ client: { getDrivingRoute: jest.fn(async () => longRoute) } as never });
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('Head north on Mill Lane. Continue for 19 km.');
});

test('keeps the screen on while navigating, and lets it sleep again after', async () => {
  mockActivateKeepAwake.mockClear();
  mockDeactivateKeepAwake.mockClear();
  mockActivateKeepAwake.mockRejectedValueOnce(new Error('unavailable'));
  const { result } = await startNavigation();
  expect(mockActivateKeepAwake).toHaveBeenCalledWith(NAVIGATION_KEEP_AWAKE_TAG);
  expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();
  await act(async () => { result.current.finishInAppNavigation(); });
  expect(mockDeactivateKeepAwake).toHaveBeenCalledWith(NAVIGATION_KEEP_AWAKE_TAG);
});

test('asks for a location fix when none is known, and stops if none is available', async () => {
  const requestCurrentLocation = jest.fn(async () => null);
  const { result, props } = await startNavigation({ currentLocation: null, requestCurrentLocation });

  expect(requestCurrentLocation).toHaveBeenCalledWith(true);
  expect(props.client.getDrivingRoute).not.toHaveBeenCalled();
  expect(result.current.activeRoute).toBeNull();
  expect(result.current.navigationLoading).toBe(false);
});

test.each([
  [
    new ApiError(503, { error: 'directions_not_configured' }),
    'Rider Comms navigation isn’t available right now. Choose Google Maps, Waze or Apple Maps in Settings → Map & navigation.',
  ],
  [new ApiError(404, { error: 'directions_no_route' }), 'No driving route was found for that destination.'],
  [
    new ApiError(500, { error: 'upstream_failed' }),
    'Couldn’t plan that route. Try again or choose another navigation app.',
  ],
  [
    new Error('network down'),
    'Couldn’t plan that route. Try again or choose another navigation app.',
  ],
])('maps a route failure (%p) to a user-facing alert', async (error, message) => {
  const client = { getDrivingRoute: jest.fn(async () => { throw error; }) };
  const { result, props } = await startNavigation({ client });

  expect(Alert.alert).toHaveBeenCalledWith('Couldn’t start navigation', message);
  expect(result.current.activeRoute).toBeNull();
  expect(result.current.navigationLoading).toBe(false);
  expect(props.setSelectedPlace).not.toHaveBeenCalled();
  expect(mockWatchNavigationLocation).not.toHaveBeenCalled();
});

test('a GPS fix updates location, accuracy and speed', async () => {
  const { result, props } = await startNavigation();

  await sendFix(51.5005, -0.1, 7.5);

  expect(props.setCurrentLocation).toHaveBeenLastCalledWith({ lat: 51.5005, lon: -0.1 });
  expect(props.currentLocationAccuracyRef.current).toBe(5);
  expect(result.current.navigationSpeedMps).toBe(7.5);

  await sendFix(51.5006, -0.1, -1);
  expect(result.current.navigationSpeedMps).toBeNull();
});

test('speaks staged distance prompts for the upcoming turn once per stage', async () => {
  await startNavigation();
  mockSpeakNavigationPrompt.mockClear();

  // ~222m to the turn: stage 1.
  await sendFix(51.5, -0.1);
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledTimes(1);
  expect(mockSpeakNavigationPrompt.mock.calls[0]![0]).toMatch(/^In .*turn right onto High Street$/);

  // Still stage 1: no repeat.
  await sendFix(51.5001, -0.1);
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledTimes(1);

  // ~89m to the turn: stage 2.
  await sendFix(51.5012, -0.1);
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledTimes(2);
  expect(mockSpeakNavigationPrompt.mock.calls[1]![0]).toMatch(/^In .*turn right onto High Street$/);
});

test('advances steps as the rider reaches each maneuver, and arrives at the destination', async () => {
  const { result } = await startNavigation();

  await sendFix(51.502, -0.1);
  expect(result.current.navigationStepIndex).toBe(1);
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('Turn right onto High Street');

  await sendFix(51.502, -0.097);
  expect(result.current.navigationStepIndex).toBe(2);
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('Turn left onto Station Road');
  // Advancing a step must not re-subscribe the GPS watcher.
  expect(mockWatchNavigationLocation).toHaveBeenCalledTimes(1);

  mockSpeakNavigationPrompt.mockClear();
  await sendFix(51.5039, -0.097);

  expect(result.current.activeRoute).toBeNull();
  expect(result.current.navigationDestination).toBeNull();
  expect(result.current.navigationStepIndex).toBe(0);
  expect(result.current.navigationNotice).toBe('You’ve arrived.');
  expect(mockStopNavigationPrompt).toHaveBeenCalled();
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('You’ve arrived.');
  expect(mockRemove).toHaveBeenCalled();
});

test('arriving shows the ride time and the distance actually ridden, until dismissed', async () => {
  const { result } = await startNavigation();
  expect(result.current.navigationArrival).toBeNull();
  await act(async () => { jest.advanceTimersByTime(60_000); });
  await sendFix(51.5, -0.1);
  await sendFix(51.502, -0.1);
  await sendFix(51.502, -0.097);
  await act(async () => { jest.advanceTimersByTime(5 * 60_000); });
  await sendFix(51.5039, -0.097);

  const arrival = result.current.navigationArrival!;
  expect(arrival.label).toBe(DESTINATION.label ?? null);
  expect(arrival.seconds).toBe(6 * 60);
  // 222 m north, 208 m east, 211 m north again.
  expect(arrival.distanceMeters).toBeGreaterThan(600);
  expect(arrival.distanceMeters).toBeLessThan(680);

  await act(async () => { result.current.dismissNavigationArrival(); });
  expect(result.current.navigationArrival).toBeNull();
});

test('stopping a route early shows no arrival card', async () => {
  const { result } = await startNavigation();
  await sendFix(51.5, -0.1);
  await act(async () => { result.current.finishInAppNavigation(); });
  expect(result.current.navigationArrival).toBeNull();
});

test('muting silences prompts and stops speech without re-subscribing GPS', async () => {
  const { result } = await startNavigation();
  mockStopNavigationPrompt.mockClear();
  mockSpeakNavigationPrompt.mockClear();

  await act(async () => {
    result.current.setNavigationMuted(true);
  });
  expect(mockStopNavigationPrompt).toHaveBeenCalled();

  await sendFix(51.5, -0.1);
  await sendFix(51.502, -0.1);

  expect(result.current.navigationStepIndex).toBe(1);
  expect(mockSpeakNavigationPrompt).not.toHaveBeenCalled();
  expect(mockWatchNavigationLocation).toHaveBeenCalledTimes(1);
});

test('shows the ways there before Start, and starts the one chosen', async () => {
  const twisty: InAppNavigationRoute = { ...ROUTE, durationSeconds: 400, steps: ROUTE.steps.slice(1) };
  const client = { getDrivingRoute: jest.fn(async () => ({ ...twisty, alternatives: [{ ...ROUTE, alternatives: [] }] })) };
  const rendered = await renderNavigation({ client: client as never });
  const { result } = rendered;
  await act(async () => { await result.current.startInAppNavigation(DESTINATION); });

  // No guidance yet: the preview, on the fastest way (Google's second here).
  expect(result.current.activeRoute).toBeNull();
  const preview = result.current.routePreview!;
  expect(preview.target).toBe(DESTINATION);
  expect(preview.choices.map((choice) => choice.label)).toEqual(['Alternative', 'Fastest']);
  expect(preview.index).toBe(1);
  expect(preview.routes.every((route) => !('alternatives' in route))).toBe(true);
  expect(mockWatchNavigationLocation).not.toHaveBeenCalled();

  await act(async () => { result.current.chooseRoutePreview(0); });
  expect(result.current.routePreview?.index).toBe(0);
  // One that doesn't exist changes nothing.
  await act(async () => { result.current.chooseRoutePreview(5); });
  expect(result.current.routePreview?.index).toBe(0);

  await act(async () => { result.current.startRoutePreview(); });
  expect(result.current.routePreview).toBeNull();
  expect(result.current.activeRoute?.steps).toEqual(twisty.steps);
  expect(result.current.activeRoute).not.toHaveProperty('alternatives');
  expect(result.current.navigationStepIndex).toBe(0);
  // Nothing to start once it has gone.
  const current = result.current.activeRoute;
  await act(async () => { result.current.startRoutePreview(); });
  expect(result.current.activeRoute).toBe(current);
});

test('re-plans the preview with new avoid settings, and leaves it be when none comes back', async () => {
  const noMotorway: InAppNavigationRoute = { ...ROUTE, durationSeconds: 700 };
  const client = { getDrivingRoute: jest.fn()
    .mockResolvedValueOnce({ ...ROUTE, alternatives: [noMotorway] })
    .mockResolvedValueOnce(noMotorway)
    .mockRejectedValueOnce(new Error('directions_no_route')) };
  const { result } = await renderNavigation({ client: client as never });
  // Nothing to re-plan before there is a preview.
  await act(async () => { expect(await result.current.replanRoutePreview({ highways: true, tolls: false, ferries: false })).toBe(false); });
  await act(async () => { await result.current.startInAppNavigation(DESTINATION); });
  const avoid = { highways: true, tolls: false, ferries: false };
  let ok = false;
  await act(async () => { ok = await result.current.replanRoutePreview(avoid); });
  expect(ok).toBe(true);
  expect(client.getDrivingRoute).toHaveBeenLastCalledWith({ lat: 51.5, lon: -0.1 }, DESTINATION, avoid);
  expect(result.current.routePreview?.routes).toEqual([noMotorway]);
  expect(result.current.routePreview?.index).toBe(0);
  expect(result.current.navigationLoading).toBe(false);

  await act(async () => { ok = await result.current.replanRoutePreview({ ...avoid, ferries: true }); });
  expect(ok).toBe(false);
  expect(result.current.routePreview?.routes).toEqual([noMotorway]);
  expect(result.current.navigationLoading).toBe(false);
});

test('a riding style asks again off motorways and shows the bendiest way, for this trip only', async () => {
  const straight = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 }));
  const zigzag = Array.from({ length: 40 }, (_, i) => ({ lat: 51.5 + i * 0.001, lon: -0.1 + (i % 2) * 0.0008 }));
  const quick: InAppNavigationRoute = { ...ROUTE, durationSeconds: 600, coordinates: straight };
  const bendy: InAppNavigationRoute = { ...ROUTE, durationSeconds: 900, coordinates: zigzag };
  const client = { getDrivingRoute: jest.fn()
    .mockResolvedValueOnce(quick)
    .mockResolvedValueOnce({ ...quick, alternatives: [bendy] })
    .mockRejectedValueOnce(new Error('directions_no_route')) };
  const { result } = await renderNavigation({ client: client as never, routeAvoidance: { highways: false, tolls: true, ferries: false } });
  await act(async () => { expect(await result.current.setRoutePreviewStyle('twisty')).toBe(false); });
  await act(async () => { await result.current.startInAppNavigation(DESTINATION); });
  expect(result.current.routePreview?.style).toBe('fastest');
  // The same style again asks nothing.
  await act(async () => { expect(await result.current.setRoutePreviewStyle('fastest')).toBe(false); });
  expect(client.getDrivingRoute).toHaveBeenCalledTimes(1);

  let ok = false;
  await act(async () => { ok = await result.current.setRoutePreviewStyle('twisty'); });
  expect(ok).toBe(true);
  expect(client.getDrivingRoute).toHaveBeenLastCalledWith({ lat: 51.5, lon: -0.1 }, DESTINATION, { highways: true, tolls: true, ferries: false });
  expect(result.current.routePreview?.style).toBe('twisty');
  expect(result.current.routePreview?.index).toBe(1);

  // None that way: the style and the routes stay as they were.
  await act(async () => { ok = await result.current.setRoutePreviewStyle('no_motorways'); });
  expect(ok).toBe(false);
  expect(result.current.routePreview?.style).toBe('twisty');
  expect(result.current.routePreview?.routes).toHaveLength(2);
});

test('closing the route preview starts nothing; without a preview the fastest starts at once', async () => {
  const slower: InAppNavigationRoute = { ...ROUTE, durationSeconds: 900 };
  const client = { getDrivingRoute: jest.fn(async () => ({ ...slower, alternatives: [ROUTE] })) };
  const { result } = await renderNavigation({ client: client as never });
  await act(async () => { await result.current.startInAppNavigation(DESTINATION); });
  expect(result.current.routePreview).not.toBeNull();
  await act(async () => { result.current.closeRoutePreview(); });
  expect(result.current.routePreview).toBeNull();
  expect(result.current.activeRoute).toBeNull();

  await act(async () => { await result.current.startInAppNavigation(DESTINATION, { preview: false }); });
  expect(result.current.routePreview).toBeNull();
  expect(result.current.activeRoute?.durationSeconds).toBe(ROUTE.durationSeconds);
});

test('switches to a faster route found in live traffic, and says so', async () => {
  const slow: InAppNavigationRoute = { ...ROUTE, durationSeconds: 2700, steps: ROUTE.steps.map((step) => ({ ...step, durationSeconds: 900 })) };
  const faster: InAppNavigationRoute = { ...ROUTE, durationSeconds: 1500, steps: ROUTE.steps.map((step) => ({ ...step, durationSeconds: 500 })) };
  const client = {
    getDrivingRoute: jest.fn()
      .mockResolvedValueOnce(slow)
      .mockRejectedValueOnce(new Error('no signal'))
      .mockResolvedValueOnce({ ...slow, durationSeconds: 2600 })
      .mockResolvedValueOnce(faster),
  };
  const { result } = await startNavigation({ client: client as never });
  await sendFix(51.5, -0.1);
  mockSpeakNavigationPrompt.mockClear();

  // No answer, then a route that saves too little: stay put.
  await act(async () => { await jest.advanceTimersByTimeAsync(FASTER_ROUTE_CHECK_MS); });
  await act(async () => { await jest.advanceTimersByTimeAsync(FASTER_ROUTE_CHECK_MS); });
  expect(result.current.activeRoute).toBe(slow);
  expect(mockSpeakNavigationPrompt).not.toHaveBeenCalled();

  await act(async () => { await jest.advanceTimersByTimeAsync(FASTER_ROUTE_CHECK_MS); });
  expect(client.getDrivingRoute).toHaveBeenLastCalledWith({ lat: 51.5, lon: -0.1 }, DESTINATION, expect.anything());
  expect(result.current.activeRoute).toBe(faster);
  // (The test sends no GPS for 15 minutes, so the card's notice has moved
  // on to the lost-signal warning by now; what was said is what counts.)
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith(expect.stringMatching(/^Faster route found\. Saves \d+ min\.$/));
});

test('finds stops along the rest of the route and routes through one until the rider gets there', async () => {
  const viaRoute: InAppNavigationRoute = { ...ROUTE, durationSeconds: 400 };
  const client = {
    getDrivingRoute: jest.fn().mockResolvedValueOnce(ROUTE).mockResolvedValueOnce(viaRoute).mockRejectedValueOnce(new Error('no signal')),
    searchAlongRoute: jest.fn(async () => ({ places: [
      { id: 'far', name: 'BP', address: '', lat: 51.503, lon: -0.097, travelSeconds: 900 },
      { id: 'near', name: 'Shell', address: '', lat: 51.502, lon: -0.099, travelSeconds: 100 },
    ] })),
  };
  const { result } = await startNavigation({ client: client as never });
  await sendFix(51.5, -0.1);

  let stops: Awaited<ReturnType<typeof result.current.findStopsOnTheWay>> = [];
  await act(async () => { stops = await result.current.findStopsOnTheWay('petrol station'); });
  expect(client.searchAlongRoute).toHaveBeenCalledWith('petrol station', expect.arrayContaining([{ lat: 51.5, lon: -0.1 }]));
  expect(stops.map((stop) => stop.place.name)).toEqual(['Shell', 'BP']);

  mockSpeakNavigationPrompt.mockClear();
  let added = false;
  await act(async () => { added = await result.current.addNavigationStop({ lat: 51.502, lon: -0.099, name: 'Shell' }); });
  expect(added).toBe(true);
  expect(client.getDrivingRoute).toHaveBeenLastCalledWith({ lat: 51.5, lon: -0.1 }, DESTINATION, expect.anything(), { lat: 51.502, lon: -0.099, label: 'Shell' });
  expect(result.current.activeRoute).toBe(viaRoute);
  expect(result.current.navigationStop).toEqual({ lat: 51.502, lon: -0.099, label: 'Shell' });
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('Stop added: Shell.');

  // Reaching it says so and clears it.
  await sendFix(51.502, -0.099);
  expect(result.current.navigationStop).toBeNull();
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('You’ve reached Shell.');

  // A stop that can't be routed leaves things as they were.
  await act(async () => { added = await result.current.addNavigationStop({ lat: 51.503, lon: -0.097, name: 'BP' }); });
  expect(added).toBe(false);
  expect(result.current.navigationStop).toBeNull();
  expect(result.current.navigationNotice).toBe('Couldn’t add that stop. Try again.');
});

test('finding or adding stops needs a route and a position', async () => {
  const { result } = await renderNavigation({ currentLocation: null });
  let stops: unknown[] = ['x'];
  let added = true;
  await act(async () => {
    stops = await result.current.findStopsOnTheWay('cafe');
    added = await result.current.addNavigationStop({ lat: 1, lon: 1, name: 'X' });
  });
  expect(stops).toEqual([]);
  expect(added).toBe(false);
});

test('reroutes only after staying off route for the grace period', async () => {
  const rerouted: InAppNavigationRoute = { ...ROUTE, steps: ROUTE.steps.slice(1) };
  const client = { getDrivingRoute: jest.fn().mockResolvedValueOnce(ROUTE).mockResolvedValueOnce(rerouted) };
  const { result } = await startNavigation({ client });

  // ~200m east of the first step's path.
  await sendFix(51.5005, -0.097);
  await act(async () => { jest.advanceTimersByTime(5_000); });
  await sendFix(51.5005, -0.097);
  expect(client.getDrivingRoute).toHaveBeenCalledTimes(1);

  await act(async () => { jest.advanceTimersByTime(5_000); });
  mockSpeakNavigationPrompt.mockClear();
  await sendFix(51.5005, -0.097);

  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('Rerouting.');
  expect(client.getDrivingRoute).toHaveBeenCalledTimes(2);
  expect(client.getDrivingRoute).toHaveBeenLastCalledWith({ lat: 51.5005, lon: -0.097 }, DESTINATION, { highways: false, tolls: false, ferries: false });
  expect(result.current.activeRoute).toStrictEqual(rerouted);
  // A reroute takes Google's best way; it doesn't offer choices mid-ride.
  expect(result.current.routePreview).toBeNull();
  expect(result.current.navigationStepIndex).toBe(0);
  expect(result.current.navigationNotice).toBe('Route updated.');
  // The new route restarts the GPS feed, but the prompt audio session stays up.
  expect(mockReleaseNavigationAudioSession).not.toHaveBeenCalled();
  expect(mockAcquireNavigationAudioSession).toHaveBeenCalledTimes(1);
});

test('a fix too uncertain to judge (tunnel, tall buildings) never reroutes', async () => {
  const { props, result } = await startNavigation();

  // The same 200m-off position as above, but with 85m accuracy throughout.
  for (let i = 0; i < 4; i += 1) {
    await sendFix(51.5005, -0.097, 8, 0, 85);
    await act(async () => { jest.advanceTimersByTime(5_000); });
  }

  expect(props.client.getDrivingRoute).toHaveBeenCalledTimes(1);
  expect(result.current.navigationNotice).not.toBe('Rerouting…');
});

test('returning to the route resets the off-route grace timer', async () => {
  const { props } = await startNavigation();

  await sendFix(51.5005, -0.097);
  await act(async () => { jest.advanceTimersByTime(8_000); });
  await sendFix(51.5006, -0.1);
  await act(async () => { jest.advanceTimersByTime(8_000); });
  await sendFix(51.5005, -0.097);

  expect(props.client.getDrivingRoute).toHaveBeenCalledTimes(1);
});

test('shows a caution notice when a reroute request fails', async () => {
  const client = {
    getDrivingRoute: jest.fn().mockResolvedValueOnce(ROUTE).mockRejectedValueOnce(new Error('offline')),
  };
  const { result } = await startNavigation({ client });

  await sendFix(51.5005, -0.097);
  await act(async () => { jest.advanceTimersByTime(10_000); });
  await sendFix(51.5005, -0.097);

  expect(result.current.activeRoute).toBe(ROUTE);
  expect(result.current.navigationNotice).toBe('Couldn’t reroute. Continue with caution.');
});

test('flags a stale GPS signal and clears the notice when fixes resume', async () => {
  const { result } = await startNavigation();

  await act(async () => { jest.advanceTimersByTime(NAV_GPS_STALE_AFTER_MS + 2_000); });
  expect(result.current.navigationNotice).toBe(NAV_GPS_STALE_NOTICE);

  await sendFix(51.5005, -0.1);
  expect(result.current.navigationNotice).toBeNull();
});

test('reports removed location permission when the GPS watcher fails', async () => {
  mockWatchNavigationLocation.mockImplementation(async () => { throw new Error('denied'); });
  mockGetForegroundPermissionsAsync.mockResolvedValue({ granted: false });
  const { result, props } = await startNavigation({ currentLocationAccuracyRef: { current: 12 } });

  expect(result.current.navigationNotice).toBe(NAV_GPS_PERMISSION_NOTICE);
  expect(props.currentLocationAccuracyRef.current).toBeNull();
  expect(result.current.navigationSpeedMps).toBeNull();
});

test('finishing early resets navigation state and removes the GPS watcher', async () => {
  const { result, props } = await startNavigation();
  mockSpeakNavigationPrompt.mockClear();

  await act(async () => {
    result.current.setNavigationMuted(true);
  });
  await act(async () => {
    result.current.finishInAppNavigation();
  });

  expect(result.current.activeRoute).toBeNull();
  expect(result.current.navigationNotice).toBeNull();
  expect(result.current.navigationMuted).toBe(false);
  expect(result.current.navigationFollowing).toBe(true);
  expect(props.mapRef.current!.animateCamera).toHaveBeenLastCalledWith({ heading: 0, pitch: 0 }, { duration: 350 });
  expect(mockSpeakNavigationPrompt).not.toHaveBeenCalled();
  expect(mockRemove).toHaveBeenCalled();
  expect(mockReleaseNavigationAudioSession).toHaveBeenCalled();
});

test('unmounting stops speech, the GPS watcher and the prompt audio session', async () => {
  const { unmount } = await startNavigation();
  mockStopNavigationPrompt.mockClear();

  await unmount();

  expect(mockRemove).toHaveBeenCalled();
  expect(mockStopNavigationPrompt).toHaveBeenCalled();
  expect(mockReleaseNavigationAudioSession).toHaveBeenCalled();
});

test('the camera follows the rider only while following is on', async () => {
  const { result, props } = await startNavigation();
  const map = props.mapRef.current!;

  map.animateCamera.mockClear();
  await sendFix(51.5005, -0.1);
  expect(map.animateCamera).toHaveBeenCalledTimes(1);
  expect(map.animateCamera.mock.calls[0]![0]).toEqual(expect.objectContaining({
    center: expect.objectContaining({ latitude: expect.any(Number), longitude: expect.any(Number) }),
    heading: expect.any(Number),
    pitch: expect.any(Number),
    zoom: expect.any(Number),
  }));

  await act(async () => { result.current.stopFollowingRoute(); });
  expect(result.current.navigationFollowing).toBe(false);
  map.animateCamera.mockClear();
  await sendFix(51.5006, -0.1);
  expect(map.animateCamera).not.toHaveBeenCalled();

  await act(async () => { result.current.resumeFollowingRoute(); });
  expect(result.current.navigationFollowing).toBe(true);
  await sendFix(51.5007, -0.1);
  expect(map.animateCamera).toHaveBeenCalledTimes(1);
});

test('uses setCamera instead of animating when reduce motion is on', async () => {
  const { props } = await startNavigation({ reduceMotionEnabled: true });
  const map = props.mapRef.current!;
  map.setCamera.mockClear();
  map.animateCamera.mockClear();

  await sendFix(51.5005, -0.1);

  expect(map.setCamera).toHaveBeenCalledTimes(1);
  expect(map.animateCamera).not.toHaveBeenCalled();
});

test('leaves the camera alone until the map is ready', async () => {
  const { props } = await startNavigation({ mapReady: false });
  const map = props.mapRef.current!;

  await sendFix(51.5005, -0.1);

  expect(map.animateCamera).not.toHaveBeenCalled();
  expect(map.setCamera).not.toHaveBeenCalled();
});

test('fitRoute frames the whole route and pauses following', async () => {
  const { result, props } = await renderNavigation();
  const map = props.mapRef.current!;

  await act(async () => { result.current.fitRoute(ROUTE); });

  expect(map.fitToCoordinates).toHaveBeenCalledWith(
    ROUTE.coordinates.map((c) => ({ latitude: c.lat, longitude: c.lon })),
    // Top clears the inset, banner and a 24pt margin (more than the 170 floor here).
    { edgePadding: { top: 172, right: 64, bottom: 180, left: 64 }, animated: true },
  );
  expect(map.animateCamera).toHaveBeenCalledWith({ heading: 0, pitch: 0 }, { duration: 250 });
  expect(result.current.navigationFollowing).toBe(false);
});

test('fitRoute ignores degenerate routes', async () => {
  const { result, props } = await renderNavigation();

  await act(async () => { result.current.fitRoute({ ...ROUTE, coordinates: [ROUTE.coordinates[0]!] }); });

  expect(props.mapRef.current!.fitToCoordinates).not.toHaveBeenCalled();
  expect(result.current.navigationFollowing).toBe(true);
});

test('measures where the map drew the rider once the camera settles', async () => {
  const { props } = await startNavigation();
  const map = props.mapRef.current! as ReturnType<typeof fakeMap> & { pointForCoordinate?: jest.Mock };
  map.pointForCoordinate = jest.fn(async () => ({ x: 160, y: 520 }));

  await sendFix(51.5005, -0.1);
  // The camera glides for a second with the puck, then checks where the
  // map drew it: on the route, 8 m on at 8 m/s.
  await act(async () => { jest.advanceTimersByTime(1_100); });

  expect(map.pointForCoordinate).toHaveBeenCalledWith({
    latitude: expect.closeTo(51.5005 + 8 / 111_195, 6),
    longitude: expect.closeTo(-0.1, 6),
  });
  map.animateCamera.mockClear();
  await sendFix(51.5006, -0.1);
  expect(map.animateCamera).toHaveBeenCalledTimes(1);
});

test('the "Route updated." notice clears itself', async () => {
  const rerouted: InAppNavigationRoute = { ...ROUTE, steps: ROUTE.steps.slice(1) };
  const client = { getDrivingRoute: jest.fn().mockResolvedValueOnce(ROUTE).mockResolvedValueOnce(rerouted) };
  const { result } = await startNavigation({ client });
  await sendFix(51.5005, -0.097);
  await act(async () => { jest.advanceTimersByTime(10_000); });
  await sendFix(51.5005, -0.097);
  expect(result.current.navigationNotice).toBe('Route updated.');

  await act(async () => { jest.advanceTimersByTime(10_000); });
  expect(result.current.navigationNotice).toBeNull();
});

test('places the navigation puck on the route and ahead of a late fix', async () => {
  const { result, props } = await startNavigation();
  // 8 m east of the northbound road, heading north at 10 m/s, taken 1 s ago.
  await act(async () => {
    lastPositionCallback()({
      timestamp: Date.now() - 1000,
      coords: { latitude: 51.501, longitude: -0.09988, accuracy: 8, speed: 10, heading: 0 },
    } as never);
  });
  // Off-route checks still see the raw fix.
  expect(props.setCurrentLocation).toHaveBeenLastCalledWith({ lat: 51.501, lon: -0.09988 });
  const puck = result.current.navigationPuck!;
  expect(puck.glideMs).toBe(1000);
  // Snapped onto the road...
  expect(puck.now.lon).toBeCloseTo(-0.1, 6);
  // ...10 m on for the fix's age, and 10 m more by the end of the glide.
  expect((puck.now.lat - 51.501) * 111_195).toBeCloseTo(10, 0);
  expect((puck.target.lat - 51.501) * 111_195).toBeCloseTo(20, 0);
  // Riding north with the map turned heading-up, the cone points straight up.
  expect(puck.coneDegrees).toBe(0);

  await act(async () => { result.current.finishInAppNavigation(); });
  expect(result.current.navigationPuck).toBeNull();
});


/** A short scenic itinerary that follows the same synthetic road as ROUTE. */
const SCENIC_ROUTE = {
  ...CURATED_ROUTES[0]!,
  start: { lat: 51.5, lon: -0.1, label: 'Route start' },
  waypoints: [
    { lat: 51.501, lon: -0.1, label: 'First viewpoint' },
    { lat: 51.502, lon: -0.1, label: 'Second viewpoint' },
  ],
  end: { lat: 51.504, lon: -0.097, label: 'Route finish' },
};

test('curated navigation starts from a fresh GPS fix through every unfinished stop', async () => {
  const { result, props } = await renderNavigation();
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });

  // Already within the start's arrival radius: skip only that checkpoint.
  expect(props.requestCurrentLocation).toHaveBeenCalledWith(true, Location.Accuracy.High);
  expect(props.client.getDrivingRoute).toHaveBeenCalledWith(
    { lat: 51.5, lon: -0.1 },
    { lat: SCENIC_ROUTE.end.lat, lon: SCENIC_ROUTE.end.lon, label: SCENIC_ROUTE.name },
    { highways: false, tolls: false, ferries: false },
    undefined,
    SCENIC_ROUTE.waypoints,
  );
  expect(result.current.activeRoute).toBe(ROUTE);
  expect(result.current.curatedRemainingStops.map((stop) => stop.label)).toEqual(['First viewpoint', 'Second viewpoint']);
  expect(props.setSelectedPlace).toHaveBeenCalledWith(null);
  expect(props.setNavigationTarget).toHaveBeenCalledWith(null);
  expect(props.setSelectedHazardId).toHaveBeenCalledWith(null);
  expect(result.current.navigationLoading).toBe(false);
});

test('uncertain start GPS keeps the route start in the itinerary', async () => {
  const requestCurrentLocation = jest.fn(async () => ({ lat: 51.5, lon: -0.1, accuracyMeters: 120 }));
  const { result, props } = await renderNavigation({ requestCurrentLocation });
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });

  expect(requestCurrentLocation).toHaveBeenCalledWith(true, Location.Accuracy.High);
  expect(props.client.getDrivingRoute).toHaveBeenCalledWith(
    { lat: 51.5, lon: -0.1 },
    { lat: SCENIC_ROUTE.end.lat, lon: SCENIC_ROUTE.end.lon, label: SCENIC_ROUTE.name },
    { highways: false, tolls: false, ferries: false },
    undefined,
    [SCENIC_ROUTE.start, ...SCENIC_ROUTE.waypoints],
  );
  expect(result.current.curatedRemainingStops.map((stop) => stop.label)).toEqual(['Route start', 'First viewpoint', 'Second viewpoint']);
});

test('missing start GPS accuracy also retains the route start', async () => {
  const requestCurrentLocation = jest.fn(async () => ({ lat: 51.5, lon: -0.1 }));
  const { result, props } = await renderNavigation({ requestCurrentLocation });
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });

  expect(props.client.getDrivingRoute).toHaveBeenCalledWith(
    { lat: 51.5, lon: -0.1 },
    expect.objectContaining({ label: SCENIC_ROUTE.name }),
    expect.any(Object),
    undefined,
    [SCENIC_ROUTE.start, ...SCENIC_ROUTE.waypoints],
  );
  expect(result.current.curatedRemainingStops).toHaveLength(3);
});

test('curated checkpoint progression is ordered and rejects uncertain GPS', async () => {
  const { result } = await renderNavigation();
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });

  // GPS proximity to a later stop must not skip an earlier scenic stop.
  await sendFix(51.502, -0.1);
  expect(result.current.curatedRemainingStops).toHaveLength(2);

  // A noisy GPS fix cannot mark a stop as passed.
  await sendFix(51.501, -0.1, 8, 0, 100);
  expect(result.current.curatedRemainingStops).toHaveLength(2);

  mockSpeakNavigationPrompt.mockClear();
  await sendFix(51.501, -0.1, 8, 0, 5);
  expect(result.current.curatedRemainingStops.map((stop) => stop.label)).toEqual(['Second viewpoint']);
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('Passed First viewpoint.');

  await sendFix(51.502, -0.1);
  expect(result.current.curatedRemainingStops).toHaveLength(0);
});

test('rerouting retains the scenic checkpoints not yet reached', async () => {
  const { result, props } = await renderNavigation();
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });
  await sendFix(51.5005, -0.097);
  await act(async () => { jest.advanceTimersByTime(10_000); });
  await sendFix(51.5005, -0.097);

  expect(props.client.getDrivingRoute).toHaveBeenLastCalledWith(
    { lat: 51.5005, lon: -0.097 },
    { lat: SCENIC_ROUTE.end.lat, lon: SCENIC_ROUTE.end.lon, label: SCENIC_ROUTE.name },
    { highways: false, tolls: false, ferries: false },
    null,
    SCENIC_ROUTE.waypoints,
  );
  expect(result.current.curatedRemainingStops.map((stop) => stop.label)).toEqual(['First viewpoint', 'Second viewpoint']);
});

test('adding a fuel stop keeps it ahead of the unfinished scenic itinerary', async () => {
  const { result, props } = await renderNavigation();
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });
  let added = false;
  await act(async () => {
    added = await result.current.addNavigationStop({ lat: 51.5008, lon: -0.1, name: 'Petrol' });
  });

  expect(added).toBe(true);
  expect(props.client.getDrivingRoute).toHaveBeenLastCalledWith(
    { lat: 51.5, lon: -0.1 },
    { lat: SCENIC_ROUTE.end.lat, lon: SCENIC_ROUTE.end.lon, label: SCENIC_ROUTE.name },
    { highways: false, tolls: false, ferries: false },
    { lat: 51.5008, lon: -0.1, label: 'Petrol' },
    SCENIC_ROUTE.waypoints,
  );
  expect(result.current.curatedRemainingStops).toHaveLength(2);

  await act(async () => { result.current.finishInAppNavigation(); });
  expect(result.current.curatedRemainingStops).toEqual([]);
});

/** A single provider leg ending at the scenic finish exposes premature arrival. */
const SCENIC_SINGLE_STEP_ROUTE: InAppNavigationRoute = {
  ...ROUTE,
  steps: [{
    ...ROUTE.steps[0]!,
    end: ROUTE.steps[ROUTE.steps.length - 1]!.end,
    coordinates: ROUTE.coordinates,
    distanceMeters: ROUTE.distanceMeters,
    durationSeconds: ROUTE.durationSeconds,
  }],
};

test('reaching the finish before the scenic checkpoints re-routes through them instead of arriving', async () => {
  const client = { getDrivingRoute: jest.fn(async () => SCENIC_SINGLE_STEP_ROUTE) };
  const { result } = await renderNavigation({ client });
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });
  await sendFix(51.504, -0.097, 0, 0, 5);

  expect(result.current.navigationArrival).toBeNull();
  expect(result.current.activeRoute).not.toBeNull();
  expect(result.current.curatedRemainingStops.map((stop) => stop.label)).toEqual(['First viewpoint', 'Second viewpoint']);
  expect(client.getDrivingRoute).toHaveBeenCalledTimes(2);
  expect(client.getDrivingRoute).toHaveBeenLastCalledWith(
    { lat: 51.504, lon: -0.097 },
    { lat: SCENIC_ROUTE.end.lat, lon: SCENIC_ROUTE.end.lon, label: SCENIC_ROUTE.name },
    { highways: false, tolls: false, ferries: false },
    null,
    SCENIC_ROUTE.waypoints,
  );
});

test('uncertain GPS at the finish neither ends a scenic journey nor triggers a recovery request', async () => {
  const client = { getDrivingRoute: jest.fn(async () => SCENIC_SINGLE_STEP_ROUTE) };
  const { result } = await renderNavigation({ client });
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });
  await sendFix(51.504, -0.097, 0, 0, 120);

  expect(result.current.activeRoute).not.toBeNull();
  expect(result.current.curatedRemainingStops).toHaveLength(2);
  expect(client.getDrivingRoute).toHaveBeenCalledTimes(1);
});

test('failed finish recovery retains scenic stops and does not retry every GPS fix', async () => {
  const client = {
    getDrivingRoute: jest.fn().mockResolvedValueOnce(SCENIC_SINGLE_STEP_ROUTE)
      .mockRejectedValue(new Error('temporarily unavailable')),
  };
  const { result } = await renderNavigation({ client });
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });
  await sendFix(51.504, -0.097, 0, 0, 5);
  expect(client.getDrivingRoute).toHaveBeenCalledTimes(2);
  expect(result.current.navigationArrival).toBeNull();
  expect(result.current.curatedRemainingStops).toHaveLength(2);
  expect(result.current.navigationNotice).toBe('Couldn’t restore the remaining planned stops. Continue with caution.');

  await sendFix(51.504, -0.097, 0, 0, 5);
  expect(client.getDrivingRoute).toHaveBeenCalledTimes(2);
  await act(async () => { jest.advanceTimersByTime(30_001); });
  await sendFix(51.504, -0.097, 0, 0, 5);
  expect(client.getDrivingRoute).toHaveBeenCalledTimes(3);
});

test('scenic navigation completes normally after all planned checkpoints are reached', async () => {
  const client = { getDrivingRoute: jest.fn(async () => SCENIC_SINGLE_STEP_ROUTE) };
  const { result } = await renderNavigation({ client });
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });
  await sendFix(51.501, -0.1, 0, 0, 5);
  await sendFix(51.502, -0.1, 0, 0, 5);
  expect(result.current.curatedRemainingStops).toHaveLength(0);

  await sendFix(51.504, -0.097, 0, 0, 5);
  expect(result.current.activeRoute).toBeNull();
  expect(result.current.navigationArrival?.label).toBe(SCENIC_ROUTE.name);
  expect(client.getDrivingRoute).toHaveBeenCalledTimes(1);
});

test('curated navigation does not start without a fresh location fix', async () => {
  const requestCurrentLocation = jest.fn(async () => null);
  const { result, props } = await renderNavigation({ requestCurrentLocation });
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });

  expect(requestCurrentLocation).toHaveBeenCalledWith(true, Location.Accuracy.High);
  expect(props.client.getDrivingRoute).not.toHaveBeenCalled();
  expect(result.current.activeRoute).toBeNull();
  expect(result.current.navigationLoading).toBe(false);
});

test('a failed complete scenic-route request leaves navigation stopped', async () => {
  const client = { getDrivingRoute: jest.fn().mockRejectedValue(new Error('route unavailable')) };
  const { result } = await renderNavigation({ client });
  await act(async () => { await result.current.startCuratedNavigation(SCENIC_ROUTE); });

  expect(Alert.alert).toHaveBeenCalledWith(
    'Couldn’t plan the scenic route',
    'Couldn’t calculate the full route through every planned stop. Check road conditions and try again.',
  );
  expect(result.current.activeRoute).toBeNull();
  expect(result.current.curatedRemainingStops).toEqual([]);
  expect(result.current.navigationLoading).toBe(false);
});
