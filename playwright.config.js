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
    { name: 'phone-small', grepInvert: /@viewport/, use: { ...devices['iPhone SE'], browserName: 'chromium' } },
    { name: 'phone-modern', grepInvert: /@viewport/, use: { ...devices['iPhone 15 Pro'], browserName: 'chromium' } },
    // iPhone 17 Pro Max: 440 × 956 CSS px at 3×. Reuse the nearest
    // Playwright iPhone UA/touch profile, but override the physical viewport
    // so implementation screenshots and visual contracts target the device
    // used by the approved Rider Comms mockups.
    { name: 'iphone-17-pro-max-webkit', grepInvert: /@viewport/, use: { ...devices['iPhone 15 Pro'], browserName: 'webkit', viewport: { width: 440, height: 956 }, screen: { width: 440, height: 956 }, colorScheme: 'dark' } },
    { name: 'tablet-portrait', grepInvert: /@viewport/, use: { browserName: 'chromium', viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true } },
    { name: 'phone-landscape', grepInvert: /@viewport/, use: { browserName: 'chromium', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },

    // These projects run only the geometry-contract audit. Device descriptors
    // provide realistic touch/scale/UA inputs; standalone and safe-area values
    // remain explicit synthetic fixtures because Playwright cannot launch an
    // actual Home Screen-installed iOS PWA.
    { name: 'viewport-iphone-se-webkit', grep: /@viewport/, use: { ...devices['iPhone SE'], browserName: 'webkit' } },
    { name: 'viewport-iphone-17-pro-max-webkit-dark', grep: /@viewport/, use: { ...devices['iPhone 15 Pro'], browserName: 'webkit', viewport: { width: 440, height: 956 }, screen: { width: 440, height: 956 }, colorScheme: 'dark' } },
    { name: 'viewport-iphone-landscape-webkit', grep: /@viewport/, use: { ...devices['iPhone 15 Pro landscape'], browserName: 'webkit' } },
    { name: 'viewport-ipad-webkit', grep: /@viewport/, use: { ...devices['iPad (gen 11)'], browserName: 'webkit' } },
    { name: 'viewport-ipad-landscape-webkit', grep: /@viewport/, use: { ...devices['iPad (gen 11) landscape'], browserName: 'webkit' } },
    { name: 'viewport-pixel-chromium', grep: /@viewport/, use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'viewport-pixel-landscape-chromium', grep: /@viewport/, use: { ...devices['Pixel 7 landscape'], browserName: 'chromium' } },
    { name: 'viewport-android-tablet-chromium', grep: /@viewport/, use: { ...devices['Galaxy Tab S9'], browserName: 'chromium' } },
    { name: 'viewport-desktop-chromium', grep: /@viewport/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'viewport-desktop-webkit', grep: /@viewport/, use: { ...devices['Desktop Safari'], browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
  ],
});
