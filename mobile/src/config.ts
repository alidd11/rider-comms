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

export const API_BASE_URL = `http://${devServerHost ?? 'localhost'}:${BACKEND_PORT}`;
