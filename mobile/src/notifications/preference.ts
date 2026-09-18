export type NotificationPermissionRequester = () => Promise<boolean>;

/**
 * Resolves the user-facing notification preference before it is persisted.
 * Turning a preference off never needs OS permission. Turning it on only
 * becomes true after the operating system has actually granted permission.
 */
export async function resolveNotificationPreference(
  next: boolean,
  requestPermission: NotificationPermissionRequester,
): Promise<boolean> {
  if (!next) return false;
  return requestPermission();
}
