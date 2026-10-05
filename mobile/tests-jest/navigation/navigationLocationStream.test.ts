type TaskBody = { data?: { locations?: unknown[] }; error?: unknown };

const mockStartLocationUpdatesAsync = jest.fn();
const mockStopLocationUpdatesAsync = jest.fn(async (..._args: unknown[]) => undefined);
const mockHasStartedLocationUpdatesAsync = jest.fn(async (..._args: unknown[]) => true);
const mockWatchPositionAsync = jest.fn();
const mockDefineTask = jest.fn();

jest.mock('expo-location', () => ({
  startLocationUpdatesAsync: (...args: unknown[]) => mockStartLocationUpdatesAsync(...args),
  stopLocationUpdatesAsync: (...args: unknown[]) => mockStopLocationUpdatesAsync(...args),
  hasStartedLocationUpdatesAsync: (...args: unknown[]) => mockHasStartedLocationUpdatesAsync(...args),
  watchPositionAsync: (...args: unknown[]) => mockWatchPositionAsync(...args),
  Accuracy: { High: 4 },
  ActivityType: { AutomotiveNavigation: 2 },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: (...args: unknown[]) => mockDefineTask(...args),
}));

// jest-expo runs as iOS (Platform.OS is inlined), which covers the native
// path; Android takes the same branch.
type StreamModule = typeof import('../../src/navigationLocationStream');

function loadStream(): { stream: StreamModule; runTask: (body: TaskBody) => Promise<void> } {
  let stream!: StreamModule;
  // A fresh copy per test: the module keeps listener state and defines its
  // task on load. Jest can't isolate dynamic imports here, so require it.
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    stream = require('../../src/navigationLocationStream');
  });
  const call = mockDefineTask.mock.calls[mockDefineTask.mock.calls.length - 1]!;
  return { stream, runTask: call[1] as (body: TaskBody) => Promise<void> };
}

const fix = (lat: number) => ({ coords: { latitude: lat, longitude: -0.1 }, timestamp: 0 });

beforeEach(() => {
  mockStartLocationUpdatesAsync.mockReset().mockResolvedValue(undefined);
  mockStopLocationUpdatesAsync.mockClear();
  mockHasStartedLocationUpdatesAsync.mockReset().mockResolvedValue(true);
  mockWatchPositionAsync.mockReset();
  mockDefineTask.mockClear();
});

test('defines the navigation task as the module loads', async () => {
  const { stream } = loadStream();
  expect(mockDefineTask).toHaveBeenCalledWith(stream.NAVIGATION_LOCATION_TASK, expect.any(Function));
});

test('starts locked-screen updates and forwards every fix in order', async () => {
  const { stream, runTask } = loadStream();
  const listener = jest.fn();

  const watch = await stream.watchNavigationLocation(listener);

  expect(watch.background).toBe(true);
  expect(mockStartLocationUpdatesAsync).toHaveBeenCalledWith(
    stream.NAVIGATION_LOCATION_TASK,
    expect.objectContaining({
      accuracy: 4,
      timeInterval: 2000,
      distanceInterval: 5,
      activityType: 2,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: expect.objectContaining({ notificationTitle: 'Rider Comms navigation' }),
    }),
  );
  expect(mockWatchPositionAsync).not.toHaveBeenCalled();

  await runTask({ data: { locations: [fix(1), fix(2)] } });
  expect(listener.mock.calls.map(([location]) => location.coords.latitude)).toEqual([1, 2]);

  await runTask({ error: new Error('lost'), data: { locations: [fix(3)] } });
  expect(listener).toHaveBeenCalledTimes(2);
});

test('stops updates when the last listener leaves, only once', async () => {
  const { stream } = loadStream();
  const first = await stream.watchNavigationLocation(jest.fn());
  const second = await stream.watchNavigationLocation(jest.fn());
  expect(mockStartLocationUpdatesAsync).toHaveBeenCalledTimes(1);

  first.remove();
  first.remove();
  await stream.stopStaleNavigationLocationUpdates();
  expect(mockStopLocationUpdatesAsync).not.toHaveBeenCalled();

  second.remove();
  await stream.stopStaleNavigationLocationUpdates();
  expect(mockStopLocationUpdatesAsync).toHaveBeenCalledWith(stream.NAVIGATION_LOCATION_TASK);
});

test('a fix with nobody navigating ends a leftover registration', async () => {
  const { stream, runTask } = loadStream();
  await runTask({ data: { locations: [fix(1)] } });
  expect(mockStopLocationUpdatesAsync).toHaveBeenCalledWith(stream.NAVIGATION_LOCATION_TASK);
});

test('startup cleanup leaves nothing to stop when no task is registered', async () => {
  mockHasStartedLocationUpdatesAsync.mockResolvedValue(false);
  const { stream } = loadStream();
  await stream.stopStaleNavigationLocationUpdates();
  expect(mockStopLocationUpdatesAsync).not.toHaveBeenCalled();
});

test('falls back to the foreground watcher when background updates are unavailable', async () => {
  const { stream, runTask } = loadStream();
  const remove = jest.fn();
  mockStartLocationUpdatesAsync.mockRejectedValue(new Error('ForegroundServiceStartNotAllowedException'));
  mockWatchPositionAsync.mockResolvedValue({ remove });
  const listener = jest.fn();

  const watch = await stream.watchNavigationLocation(listener);

  expect(watch.background).toBe(false);
  expect(mockWatchPositionAsync).toHaveBeenCalledWith({ accuracy: 4, timeInterval: 2000, distanceInterval: 5 }, listener);
  // The failed start must not leave the listener receiving task batches.
  mockHasStartedLocationUpdatesAsync.mockResolvedValue(false);
  await runTask({ data: { locations: [fix(1)] } });
  expect(listener).not.toHaveBeenCalled();
  watch.remove();
  expect(remove).toHaveBeenCalled();
});
