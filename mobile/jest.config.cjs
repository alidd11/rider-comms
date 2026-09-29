/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  rootDir: '.',
  testMatch: ['<rootDir>/tests-jest/**/*.test.tsx', '<rootDir>/tests-jest/**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  // Coverage instrumentation makes the first render of heavy screens slow;
  // the default 5s is too tight there. Real hangs still fail.
  testTimeout: 20_000,
};
