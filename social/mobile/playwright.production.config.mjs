import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.mjs';

/**
 * Tests the same bundle shipped to Railway: no fictional creators, posts,
 * videos, events or merchants. The ordinary screenshot suite intentionally
 * uses fixtures; this second export prevents false confidence in live UX.
 */
export default defineConfig({
  ...base,
  testDir: './tests-production',
  projects: [
    { name: 'production-ios-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'production-mobile-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'production-desktop-chromium', use: {
      ...devices['Desktop Chrome'], browserName: 'chromium',
      viewport: { width: 1365, height: 800 },
    } },
  ],
});