/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  rootDir: '.',
  testMatch: ['<rootDir>/tests-jest/**/*.test.tsx', '<rootDir>/tests-jest/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  // Coverage instrumentation makes the first render of heavy screens slow;
  // the default 5s is too tight there. Real hangs still fail.
  testTimeout: 20_000,
  // The API client and the subscription flow have their own node:test
  // suites (tests/client.test.ts, tests/subscriptions.test.ts) and are
  // counted in that coverage report; Jest screens only load them.
  coveragePathIgnorePatterns: ['/node_modules/', '<rootDir>/src/api/client.ts', '<rootDir>/src/billing/subscriptionFlow.ts'],
};
