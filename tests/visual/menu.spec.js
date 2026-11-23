// Premium Rider Cockpit menu IA, navigation and responsive screenshots.
import { expect, test } from '@playwright/test';
import { assertNoViewportOverflow, mockAuthenticatedApi } from './helpers.js';

test('rider menu is grouped, legible and keeps every destination reachable', async ({ page }, testInfo) => {
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  await page.locator('#mapAvatarButton').click();
  const menu = page.locator('#appMenu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-labelledby', 'appMenuTitle');
  await expect(page.locator('#appMenuTitle')).toHaveText('Menu');
  await expect(page.locator('.app-menu-group-title')).toHaveText(['Ride & explore', 'Account & support']);
  await expect(page.locator('#appMenuStatsHeading')).toHaveText('Your rides');
  await expect(page.locator('.app-menu-section-heading > span')).toHaveText('On this device');
  await expect(page.locator('#appMenuStats')).toHaveAttribute('aria-label', 'Ride totals on this device');
  // Rider Social may be present only for server-entitled riders. Check the
  // six unconditional destinations by their original route keys instead of
  // assuming a fixed row count in the presence of that optional entry.
  for (const [selector, label] of [
    ['[data-menu-nav="ride"]', 'Ride'],
    ['[data-menu-nav="friends"]', 'Friends'],
    ['[data-menu-nav="routes"]', 'Routes'],
    ['[data-menu-sheet="plans"]', 'Your plan'],
    ['[data-menu-nav="settings"]', 'Settings'],
    ['[data-menu-sheet="help"]', 'Help & Support'],
  ]) {
    await expect(menu.locator(selector).locator('.app-menu-row-label')).toHaveText(label);
  }
  await expect(page.locator('#appMenuViewProfile')).toBeVisible();
  await assertNoViewportOverflow(page);

  const overflow = await menu.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, 'Menu content must not overflow horizontally').toBeLessThanOrEqual(1);
  await menu.screenshot({ path: testInfo.outputPath(`premium-menu-${testInfo.project.name}.png`) });

  // The last action must still be reachable on a short phone with scroll.
  const help = page.locator('#appMenu [data-menu-sheet="help"]');
  await help.scrollIntoViewIfNeeded();
  await expect(help).toBeInViewport({ ratio: 0.9 });
  await help.click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#sheetTitle')).toHaveText('Help & Support');
});

test('rider menu profile remains a direct, accessible destination', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  await page.locator('#mapAvatarButton').click();
  await expect(page.locator('#appMenuName')).toHaveText('Alex Rider');
  await expect(page.locator('#appMenuHandle')).toHaveText('@alex_rides');
  await page.locator('#appMenuViewProfile').click();
  await expect(page.locator('#appMenu')).toBeHidden();
  await expect(page.locator('#sheetTitle')).toHaveText('Profile');
});
