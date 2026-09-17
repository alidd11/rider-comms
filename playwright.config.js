import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  outputDir: 'test-results/playwright',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Keep UI tests deterministic: service-worker-originated cross-origin
    // fetches bypass page.route in WebKit and would hit the real backend.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory dist/pwa',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'phone-small', use: { ...devices['iPhone SE'], browserName: 'chromium' } },
    { name: 'phone-modern', use: { ...devices['iPhone 15 Pro'], browserName: 'chromium' } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 15 Pro'], browserName: 'webkit' } },
    { name: 'tablet-portrait', use: { browserName: 'chromium', viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true } },
    { name: 'phone-landscape', use: { browserName: 'chromium', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
  ],
});
