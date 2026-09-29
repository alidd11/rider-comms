import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiError } from '../../src/api/client';
import type { RiderCommsClient } from '../../src/api/client';
import type { ActiveRide } from '../../src/ride/RideContext';
import { usePresence } from '../../src/screens/usePresence';

jest.mock('../../src/audio/microphone', () => ({
  preflightVoiceMicrophone: jest.fn(async () => undefined),
  microphoneErrorMessage: jest.fn(() => 'Microphone unavailable message'),
}));
import { preflightVoiceMicrophone } from '../../src/audio/microphone';

const FIX = { lat: 51.5, lon: -0.1, accuracyMeters: 5, recordedAt: 1_000 };

interface Props {
  client: Partial<RiderCommsClient>;
  activeRide: ActiveRide | null;
  shareLocation: boolean;
  setShareLocation: jest.Mock;
  lockedForSafety: boolean;
  riderId: string;
  requestCurrentLocation: jest.Mock;
  setLocationUnavailable: jest.Mock;
  setError: jest.Mock;
}

async function renderPresence(overrides: Partial<Props> = {}) {
  const props: Props = {
    activeRide: null,
    shareLocation: true,
    setShareLocation: jest.fn(),
    lockedForSafety: false,
    riderId: 'me',
    requestCurrentLocation: jest.fn(async () => FIX),
    setLocationUnavailable: jest.fn(),
    setError: jest.fn(),
    ...overrides,
    client: {
      updatePresence: jest.fn(async () => ({ inZoneWith: [], transitions: [], radiusMiles: 1 })),
      leavePresence: jest.fn(async () => ({})),
      getMe: jest.fn(async () => ({ riderId: 'me', username: 'me', emailVerified: true })),
      updateProfile: jest.fn(async () => ({}) as never),
      ...overrides.client,
    },
  };

  return { props, ...await renderHook(
    (p: Props) => usePresence(
      p.client as RiderCommsClient,
      p.activeRide,
      p.shareLocation,
      p.setShareLocation,
      p.lockedForSafety,
      p.riderId,
      p.requestCurrentLocation,
      p.setLocationUnavailable,
      p.setError,
    ),
    { initialProps: props },
  ) };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('polls presence while live and reports who is in zone', async () => {
  const client = {
    updatePresence: jest.fn(async () => ({ inZoneWith: ['a', 'b'], transitions: [], radiusMiles: 1 })),
  };
  const requestCurrentLocation = jest.fn(async () => FIX);
  const { result } = await renderPresence({ client, requestCurrentLocation });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  await waitFor(() => expect(result.current.ridersInZone).toEqual(['a', 'b']));
  expect(requestCurrentLocation).toHaveBeenCalledWith(false, Location.Accuracy.High, false);
  expect(client.updatePresence).toHaveBeenCalledWith(FIX.lat, FIX.lon, FIX.accuracyMeters, FIX.recordedAt);
});

test('leaves presence and clears the zone as soon as it stops being live', async () => {
  const client = { leavePresence: jest.fn(async () => ({})) };
  const { result } = await renderPresence({ client, shareLocation: true });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });
  await waitFor(() => expect(result.current.publicLive).toBe(true));

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  expect(result.current.publicLive).toBe(false);
  expect(result.current.ridersInZone).toEqual([]);
  expect(client.leavePresence).toHaveBeenCalled();
});

test('ends the live session when shareLocation is turned off elsewhere', async () => {
  const { result, rerender, props } = await renderPresence({ shareLocation: true });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });
  await waitFor(() => expect(result.current.publicLive).toBe(true));

  await rerender({ ...props, shareLocation: false });

  await waitFor(() => expect(result.current.publicLive).toBe(false));
});

test('ends the live session when a private ride starts', async () => {
  const { result, rerender, props } = await renderPresence();

  await act(async () => {
    await result.current.handleNearbyToggle();
  });
  await waitFor(() => expect(result.current.publicLive).toBe(true));

  await rerender({ ...props, activeRide: { rideId: 'r1' } as unknown as ActiveRide });

  await waitFor(() => expect(result.current.publicLive).toBe(false));
});

test('surfaces a friendly message and stays live when a presence tick fails generically', async () => {
  const setError = jest.fn();
  const client = { updatePresence: jest.fn(async () => { throw new Error('network down'); }) };
  const { result } = await renderPresence({ client, setError });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  await waitFor(() => expect(setError).toHaveBeenCalledWith('network down'));
  expect(result.current.publicLive).toBe(true);
});

test('turns itself off when the server says location sharing is disabled', async () => {
  const setError = jest.fn();
  const client = {
    updatePresence: jest.fn(async () => {
      throw new ApiError(403, { error: 'location_sharing_disabled' });
    }),
  };
  const { result } = await renderPresence({ client, setError });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  await waitFor(() => expect(result.current.publicLive).toBe(false));
  expect(setError).toHaveBeenCalledWith('Nearby location sharing is off. Tap Go live to enable it again.');
});

test('explains a rejected location jump and stays live so the next steady fix recovers', async () => {
  const setError = jest.fn();
  const client = {
    updatePresence: jest.fn(async () => {
      throw new ApiError(422, { error: 'implausible_location_jump' });
    }),
  };
  const { result } = await renderPresence({ client, setError });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  await waitFor(() => expect(setError).toHaveBeenCalledWith('Your location jumped unexpectedly. Waiting for a steadier GPS fix.'));
  expect(result.current.publicLive).toBe(true);
});

test('go-live blocks with an alert while locked for safety, without calling the client', async () => {
  const client = { getMe: jest.fn() };
  const { result } = await renderPresence({ client, lockedForSafety: true });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  expect(Alert.alert).toHaveBeenCalledWith('Nearby Voice unavailable while moving', expect.any(String));
  expect(client.getMe).not.toHaveBeenCalled();
  expect(result.current.publicLive).toBe(false);
});

test('go-live blocks with an alert when the email is not verified', async () => {
  const client = { getMe: jest.fn(async () => ({ riderId: 'me', username: 'me', emailVerified: false })) };
  const { result } = await renderPresence({ client });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  expect(Alert.alert).toHaveBeenCalledWith('Verify your email', expect.any(String));
  expect(result.current.publicLive).toBe(false);
});

test('go-live blocks with an alert when the microphone preflight fails', async () => {
  (preflightVoiceMicrophone as jest.Mock).mockRejectedValueOnce(new Error('NotAllowedError'));
  const { result } = await renderPresence();

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  expect(Alert.alert).toHaveBeenCalledWith('Microphone unavailable', 'Microphone unavailable message');
  expect(result.current.publicLive).toBe(false);
});

test('go-live confirms shareLocation on the server before flipping local state', async () => {
  const setShareLocation = jest.fn();
  const client = { updateProfile: jest.fn(async () => ({}) as never) };
  const { result } = await renderPresence({ client, setShareLocation });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  expect(client.updateProfile).toHaveBeenCalledWith('me', { shareLocation: true });
  expect(setShareLocation).toHaveBeenCalledWith(true);
  expect(result.current.publicLive).toBe(true);
});

test('go-live alerts and stays off when the server rejects the shareLocation update', async () => {
  const setShareLocation = jest.fn();
  const client = { updateProfile: jest.fn(async () => { throw new Error('403'); }) };
  const { result } = await renderPresence({ client, setShareLocation });

  await act(async () => {
    await result.current.handleNearbyToggle();
  });

  expect(Alert.alert).toHaveBeenCalledWith('Nearby Voice unavailable', expect.any(String));
  expect(setShareLocation).not.toHaveBeenCalled();
  expect(result.current.publicLive).toBe(false);
});
