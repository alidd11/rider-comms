// Opt-in external service smoke: validates real MapLibre/OpenFreeMap rendering.
// Normal CI must not depend on the availability of community CDN/tile hosts.
import { expect, test } from '@playwright/test';

test.skip(process.env.RIDER_MAPS_LIVE_TILE_QA !== '1',
  'Research-only live tile smoke requires explicit opt-in and external network');

test('Rider Comms Maps beta renders real tiles and captures day/night screenshots', async ({ page }, testInfo) => {
  test.setTimeout(150_000); // Public tile styles may load slowly on a research network.
  // Static public sample geography only. No staff login, rider GPS or Google
  // Maps requests are used here.
  const tileResponses = [];
  page.on('response', (response) => {
    if (/^https:\/\/(tiles\.openfreemap\.org|assets\.openfreemap\.com)\//.test(response.url()) && response.ok()) {
      tileResponses.push(response.url());
    }
  });
  await page.goto('/map-beta/');
  await expect(page.locator('#mapBetaSandbox')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.locator('script[src]')).toHaveCount(0);

  const map = page.frameLocator('#mapBetaSandbox');
  const status = map.locator('#status');
  const canvas = map.locator('.maplibregl-canvas');

  await expect(status).toHaveAttribute('data-load-state', 'loaded', { timeout: 45000 });
  await expect(canvas).toBeVisible();
  expect(tileResponses.length).toBeGreaterThan(0);
  const geometry = await canvas.evaluate((el) => ({ width: el.width, height: el.height }));
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.height).toBeGreaterThan(0);
  await testInfo.attach('maps-beta-real-tiles-day.png', {
    body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
  });

  await map.locator('#nightStyle').click();
  await expect(map.locator('#nightStyle')).toHaveAttribute('aria-pressed', 'true');
  await expect(status).toHaveAttribute('data-load-state', 'loaded', { timeout: 45000 });
  await testInfo.attach('maps-beta-real-tiles-night.png', {
    body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
  });

  await map.locator('#demoOverlay').click();
  await expect(map.locator('#demoOverlay')).toHaveAttribute('aria-pressed', 'true');
  await expect(status).toContainText(/Illustrative overlay shown|synthetic overlay visible/);
  await testInfo.attach('maps-beta-synthetic-overlay.png', {
    body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
  });
});
