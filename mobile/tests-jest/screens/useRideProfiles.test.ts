import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PublicRiderProfile, RiderCommsClient } from '../../src/api/client';
import { useRideProfiles } from '../../src/screens/useRideProfiles';

function fakeProfile(riderId: string): PublicRiderProfile {
  return {
    riderId,
    displayName: riderId,
    handle: `@${riderId}`,
    avatarId: 'default',
    instagramUsername: '',
    tiktokUsername: '',
  };
}

function fakeClient(getPublicProfiles: RiderCommsClient['getPublicProfiles']): RiderCommsClient {
  return { getPublicProfiles } as unknown as RiderCommsClient;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('fetches profiles for everyone in the roster except the current rider', async () => {
  const getPublicProfiles = jest.fn(async (ids: string[]) => {
    const profiles: Record<string, PublicRiderProfile> = {};
    for (const id of ids) profiles[id] = fakeProfile(id);
    return profiles;
  });
  const client = fakeClient(getPublicProfiles);
  const roster = ['me', 'a', 'b'];

  const { result } = renderHook(() => useRideProfiles(client, 'me', roster));

  await waitFor(() => expect(result.current).toEqual({ a: fakeProfile('a'), b: fakeProfile('b') }));
  expect(getPublicProfiles).toHaveBeenCalledWith(['a', 'b']);
});

test('returns an empty map and skips fetching when no one else is in the roster', async () => {
  const getPublicProfiles = jest.fn(async () => ({}));
  const client = fakeClient(getPublicProfiles);
  const roster = ['me'];

  const { result } = renderHook(() => useRideProfiles(client, 'me', roster));

  await waitFor(() => expect(result.current).toEqual({}));
  expect(getPublicProfiles).not.toHaveBeenCalled();
});

test('re-fetches on the refresh interval and keeps the latest profiles', async () => {
  let call = 0;
  const getPublicProfiles = jest.fn(async (ids: string[]) => {
    call += 1;
    const profiles: Record<string, PublicRiderProfile> = {};
    for (const id of ids) profiles[id] = { ...fakeProfile(id), displayName: `${id}-v${call}` };
    return profiles;
  });
  const client = fakeClient(getPublicProfiles);
  const roster = ['me', 'a'];

  const { result } = renderHook(() => useRideProfiles(client, 'me', roster));

  await waitFor(() => expect(result.current.a?.displayName).toBe('a-v1'));

  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  await waitFor(() => expect(result.current.a?.displayName).toBe('a-v2'));

  expect(getPublicProfiles).toHaveBeenCalledTimes(2);
});

test('keeps the last successful profiles when a refresh throws', async () => {
  let call = 0;
  const getPublicProfiles = jest.fn(async (ids: string[]) => {
    call += 1;
    if (call === 2) throw new Error('network error');
    const profiles: Record<string, PublicRiderProfile> = {};
    for (const id of ids) profiles[id] = fakeProfile(id);
    return profiles;
  });
  const client = fakeClient(getPublicProfiles);
  const roster = ['me', 'a'];

  const { result } = renderHook(() => useRideProfiles(client, 'me', roster));

  await waitFor(() => expect(result.current).toEqual({ a: fakeProfile('a') }));

  await act(async () => {
    jest.advanceTimersByTime(30_000);
  });
  await waitFor(() => expect(getPublicProfiles).toHaveBeenCalledTimes(2));

  expect(result.current).toEqual({ a: fakeProfile('a') });
});

test('stops refreshing after unmount', async () => {
  const getPublicProfiles = jest.fn(async (ids: string[]) => {
    const profiles: Record<string, PublicRiderProfile> = {};
    for (const id of ids) profiles[id] = fakeProfile(id);
    return profiles;
  });
  const client = fakeClient(getPublicProfiles);
  const roster = ['me', 'a'];

  const { unmount } = renderHook(() => useRideProfiles(client, 'me', roster));
  await waitFor(() => expect(getPublicProfiles).toHaveBeenCalledTimes(1));

  unmount();

  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(getPublicProfiles).toHaveBeenCalledTimes(1);
});
