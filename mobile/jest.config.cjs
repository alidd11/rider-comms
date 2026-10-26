const NODE_TESTED_MODULES = [
  'api/client.ts', 'api/directions.ts', 'api/places.ts', 'api/placesCache.ts',
  'audio/audioEngine.ts', 'audio/mediaControls.ts', 'audio/navigationPromptController.ts',
  'billing/subscriptionFlow.ts',
  'friends/messageDay.ts', 'friends/messageState.ts', 'friends/requestState.ts', 'friends/socialEventState.ts', 'friends/socialRefresh.ts',
  'musicApps.ts', 'navigationCamera.ts', 'navigationGpsHealth.ts', 'navigationGuidance.ts', 'navigationLinks.ts',
  'navigationLiveActivity.ts', 'navigationManeuver.ts', 'navigationPreference.ts', 'navigationRoadEvents.ts',
  'rideSafePreference.ts', 'routeOptionsPreference.ts',
  'routes/curatedRoutes.ts', 'routes/routeDiscovery.ts', 'routes/routeImages.ts',
  'safety/movementAdapter.ts', 'search/recentPlaces.ts', 'settings/avatars.ts', 'settings/plans.ts',
  'voice/proximityVoiceState.ts',
];

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  rootDir: '.',
  testMatch: ['<rootDir>/tests-jest/**/*.test.tsx', '<rootDir>/tests-jest/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  // Coverage instrumentation makes the first render of heavy screens slow;
  // the default 5s is too tight there. Real hangs still fail.
  testTimeout: 20_000,
  // Plain logic modules with their own node:test suites (tests/*.test.ts)
  // are counted in that coverage report; Jest screens only load them, so
  // counting them here too would report the same lines as untested. The
  // shared package is likewise counted in its own report.
  coveragePathIgnorePatterns: ['/node_modules/', '/shared/src/', ...NODE_TESTED_MODULES.map((file) => `<rootDir>/src/${file}`)],
};
