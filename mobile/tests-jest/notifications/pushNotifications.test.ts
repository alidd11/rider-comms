import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import {
  disablePush,
  enablePush,
  notificationRoute,
  pushEnabledOnDevice,
  PushNotConfiguredError,
} from '../../src/notifications/pushNotifications';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: null, easConfig: null } }));
// The mock above is a plain object, so each test can set the project id.
const mockConstants = Constants as unknown as { expoConfig: unknown };

const mocked = Notifications as jest.Mocked<typeof Notifications>;

function fakeClient() {
  return { registerPushToken: jest.fn(async () => ({})), unregisterPushToken: jest.fn(async () => ({})) };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  // Each test starts with a phone that hasn't been asked (mocks persist otherwise).
  mocked.getPermissionsAsync.mockReset().mockResolvedValue({ status: 'undetermined' } as never);
  mocked.requestPermissionsAsync.mockReset().mockResolvedValue({ status: 'denied' } as never);
  mockConstants.expoConfig = { extra: { eas: { projectId: 'project-1' } } };
});

test('turning notifications on asks once, registers the phone and remembers it', async () => {
  mocked.getPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined' } as never);
  mocked.requestPermissionsAsync.mockResolvedValueOnce({ status: 'granted' } as never);
  mocked.getPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
  const client = fakeClient();
  expect(await enablePush(client, 'r1')).toBe(true);
  expect(mocked.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-1' });
  expect(client.registerPushToken).toHaveBeenCalledWith('ExponentPushToken[test-token-000]');
  expect(await pushEnabledOnDevice('r1')).toBe(true);
  // Another account on the same phone hasn't turned them on.
  expect(await pushEnabledOnDevice('r2')).toBe(false);

  await disablePush(client, 'r1');
  expect(client.unregisterPushToken).toHaveBeenCalledWith('ExponentPushToken[test-token-000]');
  expect(await pushEnabledOnDevice('r1')).toBe(false);
});

test('declining the prompt registers nothing', async () => {
  const client = fakeClient();
  expect(await enablePush(client, 'r1')).toBe(false);
  expect(client.registerPushToken).not.toHaveBeenCalled();
});

test('a build without an Expo project id says so instead of failing silently', async () => {
  mockConstants.expoConfig = { extra: {} };
  mocked.getPermissionsAsync.mockResolvedValueOnce({ status: 'granted' } as never);
  await expect(enablePush(fakeClient(), 'r1')).rejects.toBeInstanceOf(PushNotConfiguredError);
});

test('notification routes open Friends or a chat, and nothing else', () => {
  expect(notificationRoute({ route: '#friends' })).toEqual({ screen: 'friends' });
  expect(notificationRoute({ route: '#chat:rider_abc-1' })).toEqual({ screen: 'chat', riderId: 'rider_abc-1' });
  expect(notificationRoute({ route: 'https://evil.example' })).toBeNull();
  expect(notificationRoute(null)).toBeNull();
});
