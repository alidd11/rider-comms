const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const FOREGROUND_SERVICE_PERMISSION = 'android.permission.FOREGROUND_SERVICE';
const MICROPHONE_SERVICE_PERMISSION = 'android.permission.FOREGROUND_SERVICE_MICROPHONE';
const WAKE_LOCK_PERMISSION = 'android.permission.WAKE_LOCK';
const SERVICE_NAMES = [
  'com.supersami.foregroundservice.ForegroundService',
  'com.supersami.foregroundservice.ForegroundServiceTask',
];

function ensurePermission(manifest, name) {
  manifest['uses-permission'] = manifest['uses-permission'] || [];
  if (!manifest['uses-permission'].some((entry) => entry?.$?.['android:name'] === name)) {
    manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

function ensureMetadata(application, name, value) {
  application['meta-data'] = application['meta-data'] || [];
  const existing = application['meta-data'].find((entry) => entry?.$?.['android:name'] === name);
  if (existing) {
    existing.$['android:value'] = value;
    return;
  }
  application['meta-data'].push({
    $: {
      'android:name': name,
      'android:value': value,
    },
  });
}

function ensureVoiceService(application, name) {
  application.service = application.service || [];
  const existing = application.service.find((entry) => entry?.$?.['android:name'] === name);
  const attributes = existing?.$ || {};
  Object.assign(attributes, {
    'android:name': name,
    'android:foregroundServiceType': 'microphone',
    'android:exported': 'false',
  });
  if (existing) existing.$ = attributes;
  else application.service.push({ $: attributes });
}

module.exports = function withAndroidVoiceForegroundService(config) {
  return withAndroidManifest(config, (nextConfig) => {
    const manifest = nextConfig.modResults.manifest;
    ensurePermission(manifest, FOREGROUND_SERVICE_PERMISSION);
    ensurePermission(manifest, MICROPHONE_SERVICE_PERMISSION);
    ensurePermission(manifest, WAKE_LOCK_PERMISSION);

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(nextConfig.modResults);
    ensureMetadata(
      application,
      'com.supersami.foregroundservice.notification_channel_name',
      'Rider Comms voice',
    );
    ensureMetadata(
      application,
      'com.supersami.foregroundservice.notification_channel_description',
      'Keeps an active Rider Comms voice session connected in the background.',
    );
    for (const serviceName of SERVICE_NAMES) ensureVoiceService(application, serviceName);

    return nextConfig;
  });
};
