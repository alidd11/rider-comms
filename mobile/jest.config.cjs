/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  rootDir: '.',
  testMatch: ['<rootDir>/tests-jest/**/*.test.tsx', '<rootDir>/tests-jest/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  // Coverage instrumentation makes the first render of heavy screens slow;
  // the default 5s is too tight there. Real hangs still fail.
  testTimeout: 20_000,
  // The API client has its own node:test suite (tests/client.test.ts) and
  // is counted in that coverage report; Jest screens only load it.
  coveragePathIgnorePatterns: ['/node_modules/', '<rootDir>/src/api/client.ts'],
};
