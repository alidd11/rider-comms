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
assert.notEqual(expo.ios?.infoPlist?.UIBackgroundModes?.includes('location'), true, 'Location is foreground-only (see APP_REVIEW.md)');

const blocked = new Set(expo.android?.blockedPermissions ?? []);
for (const permission of ['CAMERA', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW']) {
  assert.ok(blocked.has(`android.permission.${permission}`), `Unused Android permission ${permission} must be blocked`);
  assert.ok(!(expo.android?.permissions ?? []).includes(permission), `${permission} must not be requested`);
}

console.log('Native permission strings and Android permissions valid');
