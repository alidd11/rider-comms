import * as React from 'react';
import { AppState } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '../../src/api/client';
import type { RiderCommsClient, RideResponse } from '../../src/api/client';
import { RideProvider, useRide } from '../../src/ride/RideContext';

const RIDER_ID = 'me';

const mockRequestForegroundPermissionsAsync = jest.fn();
const mockGetForegroundPermissionsAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestForegroundPermissionsAsync(...args),
  getForegroundPermissionsAsync: (...args: unknown[]) => mockGetForegroundPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: unknown[]) => mockGetCurrentPositionAsync(...args),
  Accuracy: { Balanced: 3 },
}));

let mockAuthValue: { riderId: string; client: Partial<RiderCommsClient> } | null = null;

jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

function setAuthClient(client: Partial<RiderCommsClient>): void {
  mockAuthValue = { riderId: RIDER_ID, client };
}

function fakeRide(overrides: Partial<RideResponse> = {}): RideResponse {
  return {
    rideId: 'ride-1',
    createdBy: RIDER_ID,
    createdAt: 0,
    memberIds: [RIDER_ID],
    shareRideLocation: false,
    code: 'ABC123',
    ...overrides,
  };
}

async function renderRide(client: Partial<RiderCommsClient>) {
  setAuthClient(client);
  return renderHook(() => useRide(), {
    wrapper: ({ children }) => <RideProvider>{children}</RideProvider>,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  mockRequestForegroundPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  mockGetForegroundPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  mockGetCurrentPositionAsync.mockReset().mockResolvedValue({ coords: { latitude: 51.5, longitude: -0.1 } });
});

afterEach(() => {
  jest.useRealTimers();
});

test('restores an active ride from the server on mount', async () => {
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: fakeRide({ memberIds: [RIDER_ID, 'friend'] }) })),
  };
  const { result } = await renderRide(client);

  await waitFor(() => expect(result.current.activeRide?.rideId).toBe('ride-1'));
  expect(result.current.roster).toEqual([RIDER_ID, 'friend']);
  expect(result.current.activeRide?.isHost).toBe(true);
});

test('restores to no active ride when the server reports none', async () => {
  const client = { getCurrentRide: jest.fn(async () => ({ ride: null })) };
  const { result } = await renderRide(client);

  await waitFor(() => expect(client.getCurrentRide).toHaveBeenCalled());
  expect(result.current.activeRide).toBeNull();
  expect(result.current.roster).toEqual([]);
});

test('retries the restore after a transient failure', async () => {
  const client = {
    getCurrentRide: jest.fn(async () => { throw new Error('network down'); }),
  };
  await renderRide(client);

  await waitFor(() => expect(client.getCurrentRide).toHaveBeenCalledTimes(1));

  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  await waitFor(() => expect(client.getCurrentRide).toHaveBeenCalledTimes(2));
});

test('startRide sets local state immediately as host, with roster of just the rider', async () => {
  const client = { getCurrentRide: jest.fn(async () => ({ ride: null })) };
  const { result } = await renderRide(client);
  await waitFor(() => expect(result.current.activeRide).toBeNull());

  await act(async () => {
    await result.current.startRide({ rideId: 'new-ride', isHost: true, code: 'XYZ789' });
  });

  expect(result.current.activeRide).toEqual({ rideId: 'new-ride', isHost: true, code: 'XYZ789', shareRideLocation: false });
  expect(result.current.roster).toEqual([RIDER_ID]);
});

test('startRide requests location sharing when asked to', async () => {
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: null })),
    setRideLocationSharing: jest.fn(async () => ({ enabled: true })),
  };
  const { result } = await renderRide(client);
  await waitFor(() => expect(result.current.activeRide).toBeNull());

  await act(async () => {
    await result.current.startRide({ rideId: 'new-ride', isHost: true }, true);
  });

  expect(mockRequestForegroundPermissionsAsync).toHaveBeenCalled();
  expect(client.setRideLocationSharing).toHaveBeenCalledWith('new-ride', true);
  expect(result.current.shareRideLocation).toBe(true);
});

test('setRideLocationSharing refuses to enable sharing without location permission', async () => {
  mockRequestForegroundPermissionsAsync.mockResolvedValue({ granted: false });
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: fakeRide() })),
    setRideLocationSharing: jest.fn(),
  };
  const { result } = await renderRide(client);
  await waitFor(() => expect(result.current.activeRide?.rideId).toBe('ride-1'));

  let enabled: boolean | undefined;
  await act(async () => {
    enabled = await result.current.setRideLocationSharing(true);
  });

  expect(enabled).toBe(false);
  expect(client.setRideLocationSharing).not.toHaveBeenCalled();
});

test('leaveRide ends the ride as host and clears local state', async () => {
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: fakeRide() })),
    endRide: jest.fn(async () => ({})),
  };
  const { result } = await renderRide(client);
  await waitFor(() => expect(result.current.activeRide?.rideId).toBe('ride-1'));

  await act(async () => {
    await result.current.leaveRide();
  });

  expect(client.endRide).toHaveBeenCalledWith('ride-1');
  expect(result.current.activeRide).toBeNull();
});

test('leaveRide leaves (rather than ends) the ride as a non-host member', async () => {
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: fakeRide({ createdBy: 'someone-else' }) })),
    leaveRide: jest.fn(async () => ({})),
  };
  const { result } = await renderRide(client);
  await waitFor(() => expect(result.current.activeRide?.rideId).toBe('ride-1'));

  await act(async () => {
    await result.current.leaveRide();
  });

  expect(client.leaveRide).toHaveBeenCalledWith('ride-1');
  expect(result.current.activeRide).toBeNull();
});

test('leaveRide keeps local state when the server call fails', async () => {
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: fakeRide() })),
    endRide: jest.fn(async () => { throw new Error('network down'); }),
  };
  const { result } = await renderRide(client);
  await waitFor(() => expect(result.current.activeRide?.rideId).toBe('ride-1'));

  await act(async () => {
    await result.current.leaveRide();
  });

  expect(result.current.activeRide?.rideId).toBe('ride-1');
});

test('removeRider is a no-op for a non-host or when removing yourself', async () => {
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: fakeRide({ createdBy: 'someone-else', memberIds: [RIDER_ID, 'friend'] }) })),
    removeRideMember: jest.fn(),
  };
  const { result } = await renderRide(client);
  await waitFor(() => expect(result.current.roster).toEqual([RIDER_ID, 'friend']));

  await act(async () => {
    await result.current.removeRider('friend');
  });

  expect(client.removeRideMember).not.toHaveBeenCalled();
});

test('removeRider drops a member from the roster and their last-known location', async () => {
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: fakeRide({ memberIds: [RIDER_ID, 'friend'] }) })),
    removeRideMember: jest.fn(async () => fakeRide({ memberIds: [RIDER_ID] })),
  };
  const { result } = await renderRide(client);
  await waitFor(() => expect(result.current.roster).toEqual([RIDER_ID, 'friend']));

  await act(async () => {
    await result.current.removeRider('friend');
  });

  expect(client.removeRideMember).toHaveBeenCalledWith('ride-1', 'friend');
  expect(result.current.roster).toEqual([RIDER_ID]);
});

test('polls the ride and clears local state when the server says it is gone', async () => {
  let call = 0;
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: fakeRide() })),
    getRide: jest.fn(async () => {
      call += 1;
      if (call === 2) throw new ApiError(404, { error: 'not_found' });
      return fakeRide();
    }),
  };
  const { result } = await renderRide(client);
  await waitFor(() => expect(result.current.activeRide?.rideId).toBe('ride-1'));
  await waitFor(() => expect(client.getRide).toHaveBeenCalledTimes(1));

  await act(async () => {
    jest.advanceTimersByTime(5_000);
  });

  await waitFor(() => expect(result.current.activeRide).toBeNull());
});

test('ticks a location update to the server while ride location sharing is on', async () => {
  const client = {
    getCurrentRide: jest.fn(async () => ({ ride: fakeRide({ shareRideLocation: true }) })),
    updateRideLocation: jest.fn(async () => ({
      locations: [{ riderId: RIDER_ID, lat: 51.5, lon: -0.1, updatedAt: 0 }],
    })),
  };
  const { result } = await renderRide(client);

  await waitFor(() => expect(client.updateRideLocation).toHaveBeenCalledWith('ride-1', 51.5, -0.1));
  await waitFor(() => expect(result.current.rideLocations).toHaveLength(1));
});
