import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { RiderProfile } from '@rider-comms/shared';
import { ApiError } from '../../src/api/client';
import type { RiderCommsClient } from '../../src/api/client';
import { SettingsProvider, useSettings } from '../../src/settings/SettingsContext';

const RIDER_ID = 'me';



let mockAuthValue: { riderId: string; client: Partial<RiderCommsClient> } | null = null;

jest.mock('../../src/auth/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

function fakeProfile(overrides: Partial<RiderProfile> = {}): RiderProfile {
  return {
    riderId: RIDER_ID,
    displayName: 'Rider',
    handle: '@rider',
    avatarId: 'default',
    zoneTier: 'free',
    unitSystem: 'mi',
    notifyNearby: false,
    notifyInvites: false,
    notifyChat: false,
    shareLocation: false,
    instagramUsername: '',
    instagramVisibility: 'friends',
    tiktokUsername: '',
    tiktokVisibility: 'friends',
    updatedAt: 0,
    ...overrides,
  };
}

async function renderSettings(client: Partial<RiderCommsClient>) {
  mockAuthValue = { riderId: RIDER_ID, client };
  return renderHook(() => useSettings(), {
    wrapper: ({ children }) => <SettingsProvider>{children}</SettingsProvider>,
  });
}

// The provider's cache-read and server-fetch effects race each other, and
// the AsyncStorage jest mock consistently resolves after a plain async
// client mock in this environment -- whichever resolves last wins. Seeding
// the cache with the same values the server mock returns makes the test
// deterministic regardless of which side of the race actually wins.
async function seedCache(profile: Partial<RiderProfile>): Promise<void> {
  const { riderId: _id, updatedAt: _at, ...value } = fakeProfile(profile);
  await AsyncStorage.setItem(`@rider-comms/settings/profile/${RIDER_ID}`, JSON.stringify(value));
}

beforeEach(() => {
});

afterEach(async () => {
  await AsyncStorage.clear();
});

test('loads the profile from the server and caches it locally', async () => {
  await seedCache({ displayName: 'Alex', handle: '@alex' });
  const client = {
    getProfile: jest.fn(async () => fakeProfile({ displayName: 'Alex', handle: '@alex' })),
  };
  const { result } = await renderSettings(client);

  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.displayName).toBe('Alex');
  expect(result.current.handle).toBe('@alex');

  const cached = await AsyncStorage.getItem(`@rider-comms/settings/profile/${RIDER_ID}`);
  expect(JSON.parse(cached!).displayName).toBe('Alex');
});

test('falls back to a cached profile when the server fetch fails', async () => {
  await AsyncStorage.setItem(
    `@rider-comms/settings/profile/${RIDER_ID}`,
    JSON.stringify({ displayName: 'Cached Rider' }),
  );
  const client = { getProfile: jest.fn(async () => { throw new Error('network down'); }) };
  const { result } = await renderSettings(client);

  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.displayName).toBe('Cached Rider');
});

test('optimistically applies a setting change and persists it to the server', async () => {
  const client = {
    getProfile: jest.fn(async () => fakeProfile()),
    updateProfile: jest.fn(async () => fakeProfile({ displayName: 'New Name' })),
  };
  const { result } = await renderSettings(client);
  await waitFor(() => expect(result.current.loaded).toBe(true));

  await act(() => {
    result.current.setDisplayName('New Name');
  });

  expect(result.current.displayName).toBe('New Name');
  await waitFor(() => expect(client.updateProfile).toHaveBeenCalledWith(RIDER_ID, { displayName: 'New Name' }));
  await waitFor(() => expect(result.current.saving).toBe(false));
});

test('rolls back an optimistic change and surfaces a specific alert when the handle is taken', async () => {
  await seedCache({ handle: '@original' });
  // client.updateProfile's rejection is deferred rather than immediate: a
  // mock that rejects on its very next microtask lets act() drain the
  // entire optimistic-update-then-rollback cycle before it even returns,
  // so there's no way to observe the transient optimistic state at all --
  // the assertion right after firing the action would just see the
  // already-settled (rolled-back) value.
  let rejectSave!: (error: unknown) => void;
  const saveAttempt = new Promise<RiderProfile>((_resolve, reject) => { rejectSave = reject; });
  const client = {
    getProfile: jest.fn(async () => { throw new Error('offline'); }),
    updateProfile: jest.fn(() => saveAttempt),
  };
  const { result } = await renderSettings(client);
  await waitFor(() => expect(result.current.handle).toBe('@original'));

  await act(() => {
    result.current.setHandle('@taken');
  });
  expect(result.current.handle).toBe('@taken');

  await act(async () => {
    rejectSave(new ApiError(409, { error: 'handle_taken' }));
    await saveAttempt.catch(() => undefined);
  });

  expect(result.current.handle).toBe('@original');
  expect(result.current.profileError).toBe('That handle is already in use. Choose another one.');
});

test('does not roll back a field the rider has since changed again', async () => {
  await seedCache({ displayName: 'Original' });
  // The first save is deferred (see above) so the second edit can land
  // optimistically while it is still in flight -- proving the update is
  // superseded before its own save fails, rather than the two edits each
  // completing their whole round trip before the next one starts.
  let rejectFirstSave!: (error: unknown) => void;
  const firstSave = new Promise<RiderProfile>((_resolve, reject) => { rejectFirstSave = reject; });
  const client = {
    getProfile: jest.fn(async () => { throw new Error('offline'); }),
    updateProfile: jest.fn()
      .mockImplementationOnce(() => firstSave)
      .mockImplementationOnce(async () => fakeProfile({ displayName: 'Second edit' })),
  };
  const { result } = await renderSettings(client);
  await waitFor(() => expect(result.current.displayName).toBe('Original'));

  await act(() => {
    result.current.setDisplayName('First edit');
  });
  await act(() => {
    result.current.setDisplayName('Second edit');
  });
  expect(result.current.displayName).toBe('Second edit');

  await act(async () => {
    rejectFirstSave(new Error('network down'));
    await firstSave.catch(() => undefined);
  });

  // The first save's rollback guard sees displayName has since moved on to
  // 'Second edit' and skips reverting it.
  expect(result.current.displayName).toBe('Second edit');

  await waitFor(() => expect(client.updateProfile).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.saving).toBe(false));
  expect(result.current.displayName).toBe('Second edit');
});

test('resetAll clears local state and the server profile', async () => {
  await seedCache({ displayName: 'Custom Name' });
  const client = {
    getProfile: jest.fn(async () => fakeProfile({ displayName: 'Custom Name' })),
    updateProfile: jest.fn(async () => fakeProfile()),
  };
  const { result } = await renderSettings(client);
  await waitFor(() => expect(result.current.displayName).toBe('Custom Name'));

  await act(() => {
    result.current.resetAll();
  });

  expect(result.current.displayName).toBe('Rider');
  await waitFor(() => expect(client.updateProfile).toHaveBeenCalled());
  expect(await AsyncStorage.getItem(`@rider-comms/settings/profile/${RIDER_ID}`)).toBeNull();
});

test('restores and persists the navigation provider per rider, ignoring unknown values', async () => {
  await seedCache({});
  await AsyncStorage.setItem(`@rider-comms/settings/navigation-provider/${RIDER_ID}`, 'waze');
  const { result } = await renderSettings({ getProfile: jest.fn(async () => fakeProfile()) });
  await waitFor(() => expect(result.current.navigationProvider).toBe('waze'));

  await act(async () => { result.current.setNavigationProvider('in_app'); });
  expect(result.current.navigationProvider).toBe('in_app');
  expect(await AsyncStorage.getItem(`@rider-comms/settings/navigation-provider/${RIDER_ID}`)).toBe('in_app');

  await act(async () => { result.current.setNavigationProvider('mapquest' as never); });
  expect(result.current.navigationProvider).toBe('google_maps');
});

test('Ride Safe defaults on, restores a saved choice and persists changes', async () => {
  await seedCache({});
  await AsyncStorage.setItem(`@rider-comms/settings/ride-safe/${RIDER_ID}`, 'false');
  const { result } = await renderSettings({ getProfile: jest.fn(async () => fakeProfile()) });
  await waitFor(() => expect(result.current.rideSafeLoaded).toBe(true));
  expect(result.current.rideSafeEnabled).toBe(false);

  await act(async () => { result.current.setRideSafeEnabled(true); });
  expect(result.current.rideSafeEnabled).toBe(true);
  expect(await AsyncStorage.getItem(`@rider-comms/settings/ride-safe/${RIDER_ID}`)).toBe('true');
});

test('normalises names, handles and social usernames before saving', async () => {
  await seedCache({});
  const updateProfile = jest.fn(async () => fakeProfile());
  const { result } = await renderSettings({ getProfile: jest.fn(async () => fakeProfile()), updateProfile });
  await waitFor(() => expect(result.current.loaded).toBe(true));

  await act(async () => {
    result.current.setDisplayName('   ');
    result.current.setHandle('  ');
    result.current.setInstagramUsername(' @moto_maya ');
    result.current.setTiktokUsername('@maya.rides');
  });
  await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(4));
  expect(updateProfile).toHaveBeenNthCalledWith(1, RIDER_ID, { displayName: 'Rider' });
  expect(updateProfile).toHaveBeenNthCalledWith(2, RIDER_ID, { handle: '@rider' });
  expect(updateProfile).toHaveBeenNthCalledWith(3, RIDER_ID, { instagramUsername: 'moto_maya' });
  expect(updateProfile).toHaveBeenNthCalledWith(4, RIDER_ID, { tiktokUsername: 'maya.rides' });
});

test.each([
  [new ApiError(400, { error: 'handle must start with @' }), 'Use a handle that starts with @ and contains only letters, numbers, or underscores.'],
  [new Error('offline'), 'Your profile change could not be saved. Check your connection and try again.'],
])('explains a failed save (%s) and rolls it back', async (error, message) => {
  await seedCache({ handle: '@alex' });
  const updateProfile = jest.fn(async () => { throw error; });
  const { result } = await renderSettings({ getProfile: jest.fn(async () => fakeProfile({ handle: '@alex' })), updateProfile });
  await waitFor(() => expect(result.current.loaded).toBe(true));

  await act(async () => { result.current.setHandle('@bad handle'); });
  await waitFor(() => expect(result.current.profileError).toBe(message));
  expect(result.current.handle).toBe('@alex');
  expect(result.current.saving).toBe(false);

  await act(async () => { result.current.clearProfileError(); });
  expect(result.current.profileError).toBeNull();
});

test('refreshProfile applies the server snapshot and updates the cache', async () => {
  await seedCache({ displayName: 'Alex' });
  const getProfile = jest.fn(async () => fakeProfile({ displayName: 'Alex' }));
  const { result } = await renderSettings({ getProfile });
  await waitFor(() => expect(result.current.loaded).toBe(true));

  getProfile.mockResolvedValueOnce(fakeProfile({ displayName: 'Alex (edited on another device)' }));
  await act(async () => { await result.current.refreshProfile(); });
  expect(result.current.displayName).toBe('Alex (edited on another device)');
  expect(JSON.parse((await AsyncStorage.getItem(`@rider-comms/settings/profile/${RIDER_ID}`)) ?? '{}').displayName)
    .toBe('Alex (edited on another device)');
});

test('refreshProfile waits for a queued local save instead of overwriting it', async () => {
  await seedCache({ displayName: 'Alex' });
  let finishSave!: () => void;
  const updateProfile = jest.fn(() => new Promise<RiderProfile>((resolve) => { finishSave = () => resolve(fakeProfile({ displayName: 'Local edit' })); }));
  const getProfile = jest.fn(async () => fakeProfile({ displayName: 'Alex' }));
  const { result } = await renderSettings({ getProfile, updateProfile });
  await waitFor(() => expect(result.current.loaded).toBe(true));

  await act(async () => { result.current.setDisplayName('Local edit'); });
  getProfile.mockResolvedValue(fakeProfile({ displayName: 'Local edit' }));
  let refreshed = false;
  const refresh = result.current.refreshProfile().then(() => { refreshed = true; });
  await act(async () => { await Promise.resolve(); });
  expect(refreshed).toBe(false);

  await act(async () => { finishSave(); await refresh; });
  expect(result.current.displayName).toBe('Local edit');
});
