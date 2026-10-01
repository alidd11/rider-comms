import Constants from 'expo-constants';

const BACKEND_PORT = 4000;

/**
 * On a physical device "localhost" means the phone itself, not the
 * computer running the backend. `hostUri` is the address Expo Go used to
 * reach this app's own dev server (LAN IP, Tailscale IP, tunnel host —
 * whatever the developer is actually using), so reusing its hostname for
 * the backend works under the same network setup without hardcoding an IP.
 * Falls back to localhost for the iOS/Android simulator, where it's correct.
 */
const devServerHost = Constants.expoConfig?.hostUri?.split(':')[0];

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL;

// A release build without EXPO_PUBLIC_API_URL would otherwise talk plain
// HTTP to a host that doesn't exist on riders' phones. eas.json sets it for
// every store profile; fail at startup rather than ship a broken build.
if (!configuredApiUrl && typeof __DEV__ !== 'undefined' && !__DEV__) {
  throw new Error('EXPO_PUBLIC_API_URL must be set for release builds');
}

export const API_BASE_URL = configuredApiUrl ?? `http://${devServerHost ?? 'localhost'}:${BACKEND_PORT}`;
