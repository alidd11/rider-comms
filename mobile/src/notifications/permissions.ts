/**
 * Requests the real OS notification permission (iOS alert/sound/badge
 * prompt; Android 13+'s POST_NOTIFICATIONS runtime prompt) the first time a
 * rider turns on any of the notification toggles in Settings.
 *
 * There's no push-delivery backend yet (no device-token registration
 * endpoint, no Expo/FCM/APNs send integration — see spec.md Section 5's
 * "Push notification service" and Section 7's background-execution notes),
 * so this only covers the permission itself: it makes the toggle in
 * Settings correspond to a real OS grant instead of a client-only
 * preference with nothing behind it. Wiring an actual push send is a
 * separate, larger piece of work.
 */
import * as Notifications from 'expo-notifications';

let requested = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (requested && !existing.canAskAgain) return false;
  requested = true;
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}
