// Expo reads app.json first and passes it in here. This file only adds the
// values that must not live in the repository.
//
// GOOGLE_MAPS_ANDROID_API_KEY: react-native-maps draws the map with Google
// Maps on Android, which needs an API key (Maps SDK for Android, restricted
// to com.ridercomms.app and the app's signing certificate). Without one the
// Android map can't load. iOS uses Apple Maps and needs no key. Set it as an
// EAS environment variable; LAUNCH_CHECKLIST.md has the steps.
//
// EAS_PROJECT_ID: the app's Expo project id (from `eas init`). Push
// notifications need it to get this phone's Expo push token; without it the
// Notifications switch says the build isn't set up for notifications yet.
module.exports = ({ config }) => {
  const easProjectId = process.env.EAS_PROJECT_ID?.trim() || config.extra?.eas?.projectId;
  const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim() || undefined;
  if (
    !androidGoogleMapsApiKey &&
    process.env.EAS_BUILD_PLATFORM === 'android' &&
    process.env.EAS_BUILD_PROFILE === 'production'
  ) {
    throw new Error('GOOGLE_MAPS_ANDROID_API_KEY must be set for production Android builds, or the map will not load.');
  }
  return {
    ...config,
    extra: { ...config.extra, ...(easProjectId ? { eas: { ...config.extra?.eas, projectId: easProjectId } } : {}) },
    plugins: config.plugins.map((plugin) =>
      plugin === 'react-native-maps' ? ['react-native-maps', { androidGoogleMapsApiKey }] : plugin,
    ),
  };
};
