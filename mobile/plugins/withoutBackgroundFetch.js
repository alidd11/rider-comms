const { withInfoPlist } = require('@expo/config-plugins');

// expo-task-manager's own plugin always adds the `fetch` background mode.
// Rider Comms only uses the task manager for navigation location updates,
// never background fetch, and App Review expects every declared background
// mode to be used.
module.exports = function withoutBackgroundFetch(config) {
  return withInfoPlist(config, (nextConfig) => {
    const modes = nextConfig.modResults.UIBackgroundModes;
    if (Array.isArray(modes)) {
      nextConfig.modResults.UIBackgroundModes = modes.filter((mode) => mode !== 'fetch');
    }
    return nextConfig;
  });
};
