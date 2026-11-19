// Routes detail preview is independent from live turn-by-turn navigation.
// Tests use the local Google Maps mock; no real network/geolocation is needed.
import { expect, test } from '@playwright/test';
import { mockAuthenticatedApi, openFromMenu } from './helpers.js';

test('PWA calculates the actual road preview only after opening a curated route', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.google?.maps?.DirectionsService));
  await page.evaluate(() => {
    // The Surrey Hills circuit has four intermediate waypoints: five route
    // legs must be returned before we display a real road preview.
    window.__riderCommsTestRouteRequests = [];
    window.__riderCommsTestRoute = {
      routes: [{
        legs: Array.from({ length: 5 }, () => ({
          distance: { value: 12_000 },
          duration: { value: 1200 },
        })),
      }],
    };
  });

  await openFromMenu(page, 'routes');
  await expect(page.locator('.curated-route-card')).toHaveCount(21);
  expect(await page.evaluate(() => window.__riderCommsTestRouteRequests.length)).toBe(0);

  await page.locator('.curated-route-card').first().click();
  await expect(page.locator('.route-detail')).toBeVisible();
  await expect(page.locator('[data-road-preview].ready')).toBeVisible();
  await expect(page.locator('[data-road-preview-fallback]')).toBeHidden();
  await expect(page.locator('[data-road-preview-metrics]')).toContainText('37 mi');
  await expect(page.locator('[data-road-preview-metrics]')).toContainText('100 min');
  const requests = await page.evaluate(() => window.__riderCommsTestRouteRequests);
  expect(requests).toHaveLength(1);
  expect(requests[0].waypoints).toHaveLength(4);
  expect(requests[0].optimizeWaypoints).toBe(false);
  expect(requests[0].provideRouteAlternatives).toBe(false);
  await expect(page.locator('[data-start-full-route]')).toBeVisible();
});

test('PWA does not mislabel the waypoint sketch if road preview fails', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await openFromMenu(page, 'routes');
  await page.locator('.curated-route-card').first().click();
  await expect(page.locator('[data-road-preview-metrics]')).toHaveText('Road preview unavailable. Waypoint sketch only.');
  await expect(page.locator('[data-road-preview-fallback]')).toBeVisible();
  await expect(page.locator('[data-road-preview].ready')).toHaveCount(0);
  await expect(page.locator('[data-start-full-route]')).toBeVisible();
});

test('PWA road preview honours the rider’s saved navigation avoidances', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  // Exercise the real settings controls rather than writing localStorage
  // behind the app's in-memory state (which can then overwrite the fixture).
  await openFromMenu(page, 'settings');
  await page.locator('#settingsList [data-settings-open="mapNavigation"]').click();
  for (const preference of ['avoidHighways', 'avoidTolls', 'avoidFerries']) {
    const toggle = page.locator(`#sheetBody [data-toggle="${preference}"]`);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#closeSheetAll').click();
  await page.evaluate(() => { window.__riderCommsTestRouteRequests = []; });
  await openFromMenu(page, 'routes');
  await page.locator('.curated-route-card').first().click();
  await expect.poll(() => page.evaluate(() => window.__riderCommsTestRouteRequests.length)).toBe(1);
  const request = (await page.evaluate(() => window.__riderCommsTestRouteRequests))[0];
  expect(request).toMatchObject({
    avoidHighways: true,
    avoidTolls: true,
    avoidFerries: true,
    optimizeWaypoints: false,
  });
});
