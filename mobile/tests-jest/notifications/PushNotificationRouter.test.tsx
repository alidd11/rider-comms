import * as React from 'react';
import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { PushNotificationRouter } from '../../src/notifications/PushNotificationRouter';

const mockSyncPush = jest.fn(async () => undefined);
jest.mock('../../src/notifications/pushNotifications', () => ({
  ...jest.requireActual('../../src/notifications/pushNotifications'),
  syncPush: (...args: unknown[]) => mockSyncPush(...(args as [])),
}));
jest.mock('../../src/auth/AuthContext', () => ({ useAuth: () => ({ client: {}, riderId: 'me' }) }));
jest.mock('../../src/friends/FriendsContext', () => ({
  useFriends: () => ({ friends: [{ riderId: 'sam', displayName: 'Sam', avatarId: 'ember' }] }),
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

function fakeNavigation(ready = true) {
  return { isReady: jest.fn(() => ready), navigate: jest.fn() };
}

function tapResponse(route: unknown) {
  return { notification: { request: { content: { data: { route } } } } } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getLastNotificationResponseAsync.mockResolvedValue(null);
});

test('a tapped message opens that chat; a friend request opens Friends', async () => {
  let onTap: ((response: never) => void) | undefined;
  const remove = jest.fn();
  mocked.addNotificationResponseReceivedListener.mockImplementation((listener) => {
    onTap = listener as never;
    return { remove } as never;
  });
  const navigation = fakeNavigation();
  const view = await render(<PushNotificationRouter navigationRef={navigation as never} />);
  expect(mockSyncPush).toHaveBeenCalledWith({}, 'me');

  await act(async () => { onTap?.(tapResponse('#chat:sam')); });
  expect(navigation.navigate).toHaveBeenLastCalledWith('FriendChat', { riderId: 'sam', displayName: 'Sam', avatarId: 'ember' });

  await act(async () => { onTap?.(tapResponse('#friends')); });
  expect(navigation.navigate).toHaveBeenLastCalledWith('Tabs', { screen: 'Friends' });

  // A chat with someone no longer a friend falls back to Friends.
  await act(async () => { onTap?.(tapResponse('#chat:gone')); });
  expect(navigation.navigate).toHaveBeenLastCalledWith('Tabs', { screen: 'Friends' });

  // Anything else is ignored.
  navigation.navigate.mockClear();
  await act(async () => { onTap?.(tapResponse('https://example.com')); });
  expect(navigation.navigate).not.toHaveBeenCalled();

  await view.unmount();
  expect(remove).toHaveBeenCalled();
});

test('the tap that launched the app is opened once navigation is ready, then cleared', async () => {
  mocked.getLastNotificationResponseAsync.mockResolvedValue(tapResponse('#chat:sam'));
  mocked.addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() } as never);
  const navigation = fakeNavigation();
  await render(<PushNotificationRouter navigationRef={navigation as never} />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(navigation.navigate).toHaveBeenCalledWith('FriendChat', { riderId: 'sam', displayName: 'Sam', avatarId: 'ember' });
  expect(mocked.clearLastNotificationResponseAsync).toHaveBeenCalled();
});

test('nothing opens until navigation is ready', async () => {
  let onTap: ((response: never) => void) | undefined;
  mocked.addNotificationResponseReceivedListener.mockImplementation((listener) => {
    onTap = listener as never;
    return { remove: jest.fn() } as never;
  });
  const navigation = fakeNavigation(false);
  await render(<PushNotificationRouter navigationRef={navigation as never} />);
  await act(async () => { onTap?.(tapResponse('#friends')); });
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('a launching tap waits for navigation to become ready', async () => {
  jest.useFakeTimers();
  try {
    mocked.getLastNotificationResponseAsync.mockResolvedValue(tapResponse('#friends'));
    mocked.addNotificationResponseReceivedListener.mockReturnValue({ remove: jest.fn() } as never);
    let ready = false;
    const navigation = { isReady: jest.fn(() => ready), navigate: jest.fn() };
    await render(<PushNotificationRouter navigationRef={navigation as never} />);
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(navigation.navigate).not.toHaveBeenCalled();
    ready = true;
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(navigation.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Friends' });
  } finally {
    jest.useRealTimers();
  }
});
