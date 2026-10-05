/**
 * The GPS feed for turn-by-turn navigation, kept running while the phone is
 * locked or Rider Comms is in the background.
 *
 * `watchPositionAsync` stops delivering fixes as soon as the app leaves the
 * screen, so a rider who pocketed the phone lost step advances, turn prompts
 * and rerouting. This feed uses expo-location's task-based updates instead:
 *
 * - iOS keeps delivering under the existing "While Using" permission because
 *   the rider started navigation in the app. The `location` background mode
 *   allows it, and iOS shows the blue location pill while it runs.
 * - Android runs it as a location foreground service with a notification,
 *   which also needs only the foreground permission.
 *
 * Neither path asks for "Always" location, and updates stop as soon as
 * navigation ends. If the background feed can't start (Expo Go, a build
 * without the background mode, or Android refusing the service) navigation
 * falls back to the foreground-only watcher instead of failing.
 */
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { requestOptionalAndroidPermissions } from './androidPermissions';

export const NAVIGATION_LOCATION_TASK = 'rider-comms-navigation-location';

type NavigationLocationListener = (location: Location.LocationObject) => void;

export interface NavigationLocationWatch {
  /** True when fixes keep arriving with the screen locked. */
  background: boolean;
  remove: () => void;
}

const FOREGROUND_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 2000,
  distanceInterval: 5,
};

const BACKGROUND_OPTIONS: Location.LocationTaskOptions = {
  ...FOREGROUND_OPTIONS,
  activityType: Location.ActivityType.AutomotiveNavigation,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'Rider Comms navigation',
    notificationBody: 'Turn-by-turn directions are on.',
    killServiceOnDestroy: true,
  },
};

const listeners = new Set<NavigationLocationListener>();
let backgroundRunning = false;
let operation: Promise<void> = Promise.resolve();

function serialize(step: () => Promise<void>): Promise<void> {
  const next = operation.then(step, step);
  operation = next.catch(() => {});
  return next;
}

// Must run when the JS bundle loads, not inside a component: the OS can
// deliver a batch before React mounts, and iOS needs the task defined to
// hand over updates at all.
TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  NAVIGATION_LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    if (listeners.size === 0) {
      // Nothing is navigating: a registration left over from a crash or a
      // force-quit. Stop it rather than track the rider for no reason.
      await serialize(stopBackgroundUpdates);
      return;
    }
    for (const location of data.locations) {
      for (const listener of [...listeners]) listener(location);
    }
  },
);

async function startBackgroundUpdates(): Promise<void> {
  if (backgroundRunning) return;
  // Shows the "navigation is on" notification on Android 13+. Navigation
  // keeps working if the rider says no.
  await requestOptionalAndroidPermissions(['POST_NOTIFICATIONS']);
  await Location.startLocationUpdatesAsync(NAVIGATION_LOCATION_TASK, BACKGROUND_OPTIONS);
  backgroundRunning = true;
}

async function stopBackgroundUpdates(): Promise<void> {
  // A new navigation may have started while this stop was queued.
  if (listeners.size > 0) return;
  backgroundRunning = false;
  const registered = await Location.hasStartedLocationUpdatesAsync(NAVIGATION_LOCATION_TASK).catch(() => false);
  if (registered) await Location.stopLocationUpdatesAsync(NAVIGATION_LOCATION_TASK).catch(() => {});
}

export async function watchNavigationLocation(
  listener: NavigationLocationListener,
): Promise<NavigationLocationWatch> {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    listeners.add(listener);
    try {
      await serialize(startBackgroundUpdates);
      let removed = false;
      return {
        background: true,
        remove: () => {
          if (removed) return;
          removed = true;
          listeners.delete(listener);
          if (listeners.size === 0) void serialize(stopBackgroundUpdates);
        },
      };
    } catch {
      listeners.delete(listener);
    }
  }

  const subscription = await Location.watchPositionAsync(FOREGROUND_OPTIONS, listener);
  return { background: false, remove: () => subscription.remove() };
}

/**
 * Called once at startup. If the app was killed mid-navigation the OS can
 * keep the old registration alive; nothing is navigating yet, so end it.
 */
export function stopStaleNavigationLocationUpdates(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return Promise.resolve();
  return serialize(stopBackgroundUpdates);
}
