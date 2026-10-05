// App Store / Play review guard for native permissions. Expo plugins add
// purpose strings for every API their SDKs link ("Allow $(PRODUCT_NAME) to
// access your camera"), whether or not the app uses it, and Apple rejects
// vague purpose strings under guideline 5.1.1. Android libraries likewise
// declare permissions the app never requests. Keep every key accurate and
// strip the unused Android permissions.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { expo } = JSON.parse(await readFile(new URL('../mobile/app.json', import.meta.url), 'utf8'));
const pluginOptions = new Map((expo.plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin : [plugin, {}])));

const requiredStrings = {
  '@config-plugins/react-native-webrtc': ['cameraPermission'],
  'expo-secure-store': ['faceIDPermission'],
  'expo-location': ['locationAlwaysAndWhenInUsePermission', 'locationAlwaysPermission', 'motionUsagePermission'],
};
for (const [plugin, keys] of Object.entries(requiredStrings)) {
  assert.ok(pluginOptions.has(plugin), `${plugin} must stay configured in mobile/app.json`);
  for (const key of keys) {
    const value = pluginOptions.get(plugin)?.[key];
    assert.ok(typeof value === 'string' && value.startsWith('Rider Comms'), `${plugin} needs an accurate ${key}, not the plugin's generic default`);
  }
}
for (const [key, value] of Object.entries(expo.ios?.infoPlist ?? {})) {
  if (key.endsWith('UsageDescription')) assert.ok(!String(value).includes('$(PRODUCT_NAME)'), `${key} must be specific to Rider Comms`);
}
// Background location is only for navigation the rider starts, under the
// "While Using" permission (see APP_REVIEW.md). Never ask for Always access.
const location = pluginOptions.get('expo-location') ?? {};
assert.ok(expo.ios?.infoPlist?.UIBackgroundModes?.includes('location'), 'iOS needs the location background mode for locked-screen navigation');
assert.ok(expo.ios?.infoPlist?.UIBackgroundModes?.includes('audio'), 'iOS needs the audio background mode for voice and turn prompts');
assert.equal(location.isAndroidBackgroundLocationEnabled, false, 'Android must not request ACCESS_BACKGROUND_LOCATION');
assert.equal(location.isAndroidForegroundServiceEnabled, true, 'Android navigation runs as a location foreground service');
assert.ok((expo.android?.permissions ?? []).includes('FOREGROUND_SERVICE_LOCATION'), 'Android needs FOREGROUND_SERVICE_LOCATION for navigation');
assert.ok((expo.android?.blockedPermissions ?? []).includes('android.permission.ACCESS_BACKGROUND_LOCATION'), 'ACCESS_BACKGROUND_LOCATION must stay blocked');
const whenInUse = String(expo.ios?.infoPlist?.NSLocationWhenInUseUsageDescription ?? '');
assert.ok(whenInUse.startsWith('Rider Comms') && whenInUse.includes('navigation'), 'The While Using string must explain locked-screen navigation');

// WebRTC can trigger iOS's local network prompt; without this string the
// prompt has no explanation.
const localNetwork = String(expo.ios?.infoPlist?.NSLocalNetworkUsageDescription ?? '');
assert.ok(localNetwork.startsWith('Rider Comms'), 'NSLocalNetworkUsageDescription must explain the voice connection');
// Android 13+ hides foreground-service notifications without it, and the
// voice and navigation services both post one.
assert.ok((expo.android?.permissions ?? []).includes('POST_NOTIFICATIONS'), 'Android needs POST_NOTIFICATIONS for the service notifications');
// The Android map needs a Google Maps key, injected from the environment.
const appConfig = await readFile(new URL('../mobile/app.config.js', import.meta.url), 'utf8');
assert.ok(appConfig.includes('GOOGLE_MAPS_ANDROID_API_KEY') && appConfig.includes('androidGoogleMapsApiKey'), 'mobile/app.config.js must pass the Android Google Maps key to react-native-maps');

const blocked = new Set(expo.android?.blockedPermissions ?? []);
for (const permission of ['CAMERA', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW']) {
  assert.ok(blocked.has(`android.permission.${permission}`), `Unused Android permission ${permission} must be blocked`);
  assert.ok(!(expo.android?.permissions ?? []).includes(permission), `${permission} must not be requested`);
}

console.log('Native permission strings and Android permissions valid');
