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

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${devServerHost ?? 'localhost'}:${BACKEND_PORT}`;

/**
 * Google Places API key for the map's search bar (see src/api/places.ts).
 * Deliberately bundled via EXPO_PUBLIC_* rather than proxied through the
 * backend: Places/Maps keys for native apps are restricted by app
 * bundle-id/SHA1 fingerprint in the Google Cloud console, not by request
 * origin, so shipping the key in the app binary is the standard approach
 * here (unlike a server secret) — see .env.example. Empty by default;
 * search gracefully reports "unavailable" rather than erroring when unset.
 */
export const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';
