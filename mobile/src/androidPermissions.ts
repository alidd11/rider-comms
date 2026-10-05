import { PermissionsAndroid, Platform, type Permission } from 'react-native';

// Runtime permissions that make a feature work fully but aren't required for
// it to run. Each is skipped below the Android version that introduced it.
const OPTIONAL_PERMISSION_API_LEVEL = {
  // Android 12+: without it, Bluetooth headsets and helmet intercoms aren't
  // offered as an audio route for voice chat.
  BLUETOOTH_CONNECT: 31,
  // Android 13+: without it, the "voice is on" and "navigation is on"
  // foreground-service notifications are hidden from the notification shade.
  POST_NOTIFICATIONS: 33,
} as const;

export type OptionalAndroidPermission = keyof typeof OPTIONAL_PERMISSION_API_LEVEL;

/**
 * Asks for any of these the rider hasn't decided on yet. Never throws: a
 * denial, or a device that can't ask, leaves the feature running without
 * that extra.
 */
export async function requestOptionalAndroidPermissions(names: OptionalAndroidPermission[]): Promise<void> {
  if (Platform.OS !== 'android') return;
  const permissions = names
    .filter((name) => Number(Platform.Version) >= OPTIONAL_PERMISSION_API_LEVEL[name])
    .map((name) => PermissionsAndroid.PERMISSIONS[name] as Permission);
  if (permissions.length === 0) return;
  try {
    const missing: Permission[] = [];
    for (const permission of permissions) {
      if (!(await PermissionsAndroid.check(permission))) missing.push(permission);
    }
    if (missing.length > 0) await PermissionsAndroid.requestMultiple(missing);
  } catch {
    // Treated like a denial.
  }
}
