// Curated routes.
import { expect, test } from '@playwright/test';
import { mockAuthenticatedApi, assertNoViewportOverflow, openFromMenu } from './helpers.js';

test('PWA route discovery previews route shape and hands the start back to the map', async ({ page }, testInfo) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();

  await openFromMenu(page, 'routes');
  const firstRoute = page.locator('.curated-route-card').first();
  await expect(firstRoute).toBeVisible();
  await expect(firstRoute.locator('.route-trace-card')).toBeHidden();
  const routeCardBox = await firstRoute.boundingBox();
  expect(routeCardBox).not.toBeNull();
  expect(routeCardBox.width / routeCardBox.height).toBeGreaterThan(2);

  await firstRoute.click();
  await expect(page.locator('.route-detail')).toBeVisible();
  await expect(page.locator('.route-trace-detail')).toBeVisible();
  await expect(page.locator('[data-guide-route-start]')).toBeVisible();

  await page.locator('[data-guide-route-start]').click();
  await expect(page.locator('[data-screen="map"]')).toHaveClass(/active/);
  await expect(page.locator('#destinationCard')).toBeVisible();
  await expect(page.locator('#destinationCard')).toContainText('start');
  await expect(page.locator('#destinationCard .destination-primary-action')).toBeVisible();
  await expect(page.locator('#destinationCard .destination-primary-action')).toContainText('Start route');
  await expect(page.locator('.screen-map .map-actions')).toBeHidden();
  const destinationGeometry = await page.evaluate(() => {
    const card = document.querySelector('#destinationCard');
    const primary = document.querySelector('#destinationCard .destination-primary-action');
    const dismiss = document.querySelector('#destinationCard .destination-card-dismiss');
    return {
      cardRadius: card ? parseFloat(getComputedStyle(card).borderTopLeftRadius) : NaN,
      primaryRadius: primary ? parseFloat(getComputedStyle(primary).borderTopLeftRadius) : NaN,
      dismissRadius: dismiss ? parseFloat(getComputedStyle(dismiss).borderTopLeftRadius) : NaN,
    };
  });
  expect(destinationGeometry.cardRadius).toBe(16);
  expect(destinationGeometry.primaryRadius).toBe(14);
  expect(destinationGeometry.dismissRadius).toBe(20);
  await assertNoViewportOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-destination-navigation-final.png'), fullPage: true });
});

test('PWA Routes shows only roads that suit the rider’s vehicle', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  await openFromMenu(page, 'routes');
  const count = page.locator('.routes-count');
  await expect(count).toHaveText('21 rides');
  await page.evaluate(() => window.RiderCuratedRoutes.setVehicle('scooter'));
  await expect(count).toHaveText('15 rides');
  await page.evaluate(() => window.RiderCuratedRoutes.setVehicle('motorcycle_small'));
  await expect(count).toHaveText('21 rides');
});
