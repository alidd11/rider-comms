import * as React from 'react';
import { AppState, Linking } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { MovementSafetyProvider, useMovementSafety } from '../../src/safety/MovementSafetyContext';

const mockHasServicesEnabledAsync = jest.fn();
const mockGetForegroundPermissionsAsync = jest.fn();
const mockRequestForegroundPermissionsAsync = jest.fn();
const mockWatchPositionAsync = jest.fn();

jest.mock('expo-location', () => ({
  hasServicesEnabledAsync: (...args: unknown[]) => mockHasServicesEnabledAsync(...args),
  getForegroundPermissionsAsync: (...args: unknown[]) => mockGetForegroundPermissionsAsync(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestForegroundPermissionsAsync(...args),
  watchPositionAsync: (...args: unknown[]) => mockWatchPositionAsync(...args),
  Accuracy: { Balanced: 3 },
}));

let mockSettingsValue = { rideSafeEnabled: true, rideSafeLoaded: true };

jest.mock('../../src/settings/SettingsContext', () => ({
  useSettings: () => mockSettingsValue,
}));

function fix(lat: number, lon: number, timestamp: number, speed: number) {
  return { coords: { latitude: lat, longitude: lon, accuracy: 5, speed }, timestamp };
}

async function renderMovementSafety() {
  return renderHook(() => useMovementSafety(), {
    wrapper: ({ children }) => <MovementSafetyProvider>{children}</MovementSafetyProvider>,
  });
}

beforeEach(() => {
  mockSettingsValue = { rideSafeEnabled: true, rideSafeLoaded: true };
  AppState.currentState = 'active';
  mockHasServicesEnabledAsync.mockReset().mockResolvedValue(true);
  mockGetForegroundPermissionsAsync.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
  mockRequestForegroundPermissionsAsync.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
  mockWatchPositionAsync.mockReset().mockResolvedValue({ remove: jest.fn() });
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('reports services_disabled when Location Services are off', async () => {
  mockHasServicesEnabledAsync.mockResolvedValue(false);
  const { result } = await renderMovementSafety();

  await waitFor(() => expect(result.current.locationAccess).toBe('services_disabled'));
  expect(result.current.trackingError).toBe('Location Services are turned off.');
  expect(mockGetForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('reports promptable when permission has not been granted yet', async () => {
  mockGetForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  const { result } = await renderMovementSafety();

  await waitFor(() => expect(result.current.locationAccess).toBe('promptable'));
  expect(mockWatchPositionAsync).not.toHaveBeenCalled();
});

test('reports blocked when permission was permanently denied', async () => {
  mockGetForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  const { result } = await renderMovementSafety();

  await waitFor(() => expect(result.current.locationAccess).toBe('blocked'));
});

test('does not start tracking while Ride Safe is disabled, even with permission granted', async () => {
  mockSettingsValue = { rideSafeEnabled: false, rideSafeLoaded: true };
  const { result } = await renderMovementSafety();

  await waitFor(() => expect(result.current.locationAccess).toBe('granted'));
  expect(mockWatchPositionAsync).not.toHaveBeenCalled();
  expect(result.current.movementState).toBe('unknown');
});

test('waits for settings to load before deciding location access', async () => {
  mockSettingsValue = { rideSafeEnabled: true, rideSafeLoaded: false };
  const { result } = await renderMovementSafety();

  expect(result.current.locationAccess).toBe('checking');
  expect(mockGetForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('confirms moving after sustained above-threshold speed and locks distracting controls', async () => {
  const { result } = await renderMovementSafety();
  await waitFor(() => expect(mockWatchPositionAsync).toHaveBeenCalled());
  const onPosition = mockWatchPositionAsync.mock.calls[0]![1] as (position: unknown) => void;

  await act(async () => {
    onPosition(fix(51.5, -0.1, 1_000, 10));
  });
  await act(async () => {
    onPosition(fix(51.5, -0.1, 3_500, 10));
  });

  await waitFor(() => expect(result.current.movementState).toBe('moving'));
  expect(result.current.lockedForSafety).toBe(true);
});

test('surfaces a specific message and stays unavailable when starting tracking throws', async () => {
  mockWatchPositionAsync.mockRejectedValue(new Error('GPS unavailable'));
  const { result } = await renderMovementSafety();

  await waitFor(() => expect(result.current.locationAccess).toBe('unavailable'));
  expect(result.current.trackingError).toBe('Location tracking could not start. Try again or check device settings.');
  expect(result.current.movementState).toBe('unknown');
});

test('requestLocationAccess starts tracking once permission is granted', async () => {
  mockGetForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  const { result } = await renderMovementSafety();
  await waitFor(() => expect(result.current.locationAccess).toBe('promptable'));

  mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  // start() re-checks permission itself rather than trusting the request's
  // own result, so the follow-up getForegroundPermissionsAsync() call also
  // needs to reflect the newly granted state.
  mockGetForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  await act(async () => {
    await result.current.requestLocationAccess();
  });

  await waitFor(() => expect(result.current.locationAccess).toBe('granted'));
  expect(mockWatchPositionAsync).toHaveBeenCalled();
});

test('requestLocationAccess reports blocked with a specific message when denied permanently', async () => {
  mockGetForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  const { result } = await renderMovementSafety();
  await waitFor(() => expect(result.current.locationAccess).toBe('promptable'));

  mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  await act(async () => {
    await result.current.requestLocationAccess();
  });

  expect(result.current.locationAccess).toBe('blocked');
  expect(result.current.trackingError).toBe('Location access is blocked in device settings.');
});

test('openLocationSettings opens the OS settings screen', async () => {
  const { result } = await renderMovementSafety();
  await waitFor(() => expect(result.current.locationAccess).toBe('granted'));

  await act(async () => {
    await result.current.openLocationSettings();
  });

  expect(Linking.openSettings).toHaveBeenCalled();
});

test('stops tracking and clears movement state when the app goes to the background', async () => {
  const remove = jest.fn();
  mockWatchPositionAsync.mockResolvedValue({ remove });
  const { result } = await renderMovementSafety();
  await waitFor(() => expect(mockWatchPositionAsync).toHaveBeenCalled());
  const onPosition = mockWatchPositionAsync.mock.calls[0]![1] as (position: unknown) => void;
  await act(async () => {
    onPosition(fix(51.5, -0.1, 1_000, 10));
  });
  await act(async () => {
    onPosition(fix(51.5, -0.1, 3_500, 10));
  });
  await waitFor(() => expect(result.current.movementState).toBe('moving'));

  const appStateCalls = (AppState.addEventListener as jest.Mock).mock.calls;
  const listener = appStateCalls[appStateCalls.length - 1]![1] as (state: string) => void;
  await act(async () => {
    listener('background');
  });

  expect(remove).toHaveBeenCalled();
  expect(result.current.movementState).toBe('unknown');
});
