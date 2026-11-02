import { PermissionsAndroid, Platform } from 'react-native';
import { requestOptionalAndroidPermissions } from '../../src/androidPermissions';

function setPlatform(os: string, version: number) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
}

let check: jest.SpyInstance;
let requestMultiple: jest.SpyInstance;

beforeEach(() => {
  check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  requestMultiple = jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  setPlatform('ios', 17);
});

test('does nothing off Android', async () => {
  setPlatform('ios', 17);
  await requestOptionalAndroidPermissions(['BLUETOOTH_CONNECT', 'POST_NOTIFICATIONS']);
  expect(check).not.toHaveBeenCalled();
});

test('asks only for permissions the Android version has and the rider hasn’t decided on', async () => {
  setPlatform('android', 33);
  check.mockImplementation(async (permission: string) => permission === PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  await requestOptionalAndroidPermissions(['BLUETOOTH_CONNECT', 'POST_NOTIFICATIONS']);
  expect(requestMultiple).toHaveBeenCalledWith([PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS]);
});

test('skips permissions newer than the device and asks nothing when all are granted', async () => {
  setPlatform('android', 30);
  await requestOptionalAndroidPermissions(['BLUETOOTH_CONNECT', 'POST_NOTIFICATIONS']);
  expect(check).not.toHaveBeenCalled();
  setPlatform('android', 34);
  check.mockResolvedValue(true);
  await requestOptionalAndroidPermissions(['POST_NOTIFICATIONS']);
  expect(requestMultiple).not.toHaveBeenCalled();
});

test('treats a failure to ask like a denial', async () => {
  setPlatform('android', 33);
  check.mockRejectedValue(new Error('no activity'));
  await expect(requestOptionalAndroidPermissions(['POST_NOTIFICATIONS'])).resolves.toBeUndefined();
});
