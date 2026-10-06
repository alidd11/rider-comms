import { Alert } from 'react-native';
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
import { useInAppNavigation } from '../../src/screens/useInAppNavigation';

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
    requestCurrentLocation: jest.fn(async () => ({ lat: 51.5, lon: -0.1 })),
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
    ),
    { initialProps: props },
  ) };
}

let mockRemove: jest.Mock;

function lastPositionCallback(): PositionCallback {
  const calls = mockWatchNavigationLocation.mock.calls;
  return calls[calls.length - 1]![0] as PositionCallback;
}

async function sendFix(lat: number, lon: number, speed: number | null = 8, heading: number | null = 0) {
  await act(async () => {
    lastPositionCallback()({ coords: { latitude: lat, longitude: lon, accuracy: 5, speed, heading } });
  });
}

async function startNavigation(overrides: Partial<Props> = {}) {
  const rendered = await renderNavigation(overrides);
  await act(async () => {
    await rendered.result.current.startInAppNavigation(DESTINATION);
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

  expect(props.client.getDrivingRoute).toHaveBeenCalledWith({ lat: 51.5, lon: -0.1 }, DESTINATION, { highways: false, tolls: false });
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
    'In-app navigation is not configured on the Rider Comms server yet. Choose Google Maps, Waze or Apple Maps in Settings.',
  ],
  [new ApiError(404, { error: 'directions_no_route' }), 'No driving route was found for that destination.'],
  [
    new ApiError(500, { error: 'upstream_failed' }),
    'Rider Comms could not calculate that route. Try again or choose another navigation app.',
  ],
  [
    new Error('network down'),
    'Rider Comms could not calculate that route. Try again or choose another navigation app.',
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
  expect(mockSpeakNavigationPrompt.mock.calls[0]![0]).toMatch(/^In .*Turn right onto High Street$/);

  // Still stage 1: no repeat.
  await sendFix(51.5001, -0.1);
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledTimes(1);

  // ~89m to the turn: stage 2.
  await sendFix(51.5012, -0.1);
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledTimes(2);
  expect(mockSpeakNavigationPrompt.mock.calls[1]![0]).toMatch(/^In .*Turn right onto High Street$/);
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
  expect(result.current.navigationNotice).toBe('You have arrived.');
  expect(mockStopNavigationPrompt).toHaveBeenCalled();
  expect(mockSpeakNavigationPrompt).toHaveBeenCalledWith('You have arrived at your destination.');
  expect(mockRemove).toHaveBeenCalled();
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
  expect(client.getDrivingRoute).toHaveBeenLastCalledWith({ lat: 51.5005, lon: -0.097 }, DESTINATION, { highways: false, tolls: false });
  expect(result.current.activeRoute).toBe(rerouted);
  expect(result.current.navigationStepIndex).toBe(0);
  expect(result.current.navigationNotice).toBe('Route updated.');
  // The new route restarts the GPS feed, but the prompt audio session stays up.
  expect(mockReleaseNavigationAudioSession).not.toHaveBeenCalled();
  expect(mockAcquireNavigationAudioSession).toHaveBeenCalledTimes(1);
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
  expect(result.current.navigationNotice).toBe('Could not reroute. Continue with caution.');
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
