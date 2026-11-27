// Premium Rider Cockpit menu IA, navigation and responsive screenshots.
import { expect, test } from '@playwright/test';
import { assertNoViewportOverflow, mockAuthenticatedApi, RIDER_ID } from './helpers.js';

test('rider menu is grouped, legible and keeps every destination reachable', async ({ page }, testInfo) => {
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  await page.locator('#mapAvatarButton').click();
  const menu = page.locator('#appMenu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-labelledby', 'appMenuTitle');
  await expect(page.locator('#appMenuTitle')).toHaveText('Menu');
  await expect(page.locator('.app-menu-group-title')).toHaveText(['Ride & explore', 'Account & support']);
  await expect(page.locator('#appMenuStatsHeading')).toHaveText('Recent rides');
  await expect(page.locator('.app-menu-section-heading > span')).toHaveText('Last 10 · this device');
  await expect(page.locator('#appMenuStats')).toHaveAttribute('aria-label', 'Recent ride totals on this device');
  // No rides on this device yet: a line saying what will show, not a row of zeros.
  await expect(page.locator('#appMenuStats')).toBeHidden();
  await expect(page.locator('#appMenuStatsEmpty')).toHaveText('No rides yet. Your time and distance show here after your first ride.');
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

test('touch-first menu rows do not retain a sticky hover highlight', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  const touchOnly = await page.evaluate(() => matchMedia('(hover: none)').matches);
  test.skip(!touchOnly, 'Only touch-first devices can reproduce sticky iOS hover');
  await page.locator('#mapAvatarButton').click();
  const row = page.locator('#appMenu [data-menu-nav="settings"]');
  await row.scrollIntoViewIfNeeded();
  // Exercise a real tap while keeping this menu open to inspect its released
  // background. The capture listener affects the fixture only, never the app.
  await row.evaluate((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, once: true });
  });
  await row.tap();
  await expect(page.locator('#appMenu')).toBeVisible();
  await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('menu remains stationary when it fits and scrolls only on genuinely short viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Phone-height layout contract');
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '59px'));
  await page.setViewportSize({ width: 440, height: 956 });
  await page.locator('#mapAvatarButton').click();
  const menu = page.locator('#appMenu');
  await expect(menu).toBeVisible();
  await expect.poll(() => menu.evaluate((element) => ({
    fits: element.scrollHeight <= element.clientHeight + 2,
    scrollable: element.classList.contains('app-menu-needs-scroll'),
  }))).toEqual({ fits: true, scrollable: false });
  await menu.evaluate((element) => { element.scrollTop = 40; });
  expect(await menu.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(menu.locator('[data-menu-sheet="help"]')).toBeInViewport();

  // When the window is genuinely too short, keep the bottom actions and
  // accessibility text reachable rather than trapping them off-screen.
  await page.setViewportSize({ width: 440, height: 610 });
  await expect.poll(() => menu.evaluate((element) => element.classList.contains('app-menu-needs-scroll'))).toBe(true);
  const help = menu.locator('[data-menu-sheet="help"]');
  await help.scrollIntoViewIfNeeded();
  await expect(help).toBeInViewport({ ratio: 0.9 });
});

test('PWA menu totals the rides kept on this device once there are some', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.addInitScript((riderId) => {
    localStorage.setItem(`riderComms.rideHistory.${riderId}`, JSON.stringify([
      { endedAt: Date.now(), durationMs: 5_400_000, riders: 3, distanceMeters: 80_467 },
      { endedAt: Date.now() - 86_400_000, durationMs: 900_000, riders: 1, distanceMeters: null },
    ]));
  }, RIDER_ID);
  await page.goto('/');
  await page.locator('#mapAvatarButton').click();
  await expect(page.locator('#appMenuStatsEmpty')).toBeHidden();
  await expect(page.locator('#appMenuStatRides')).toHaveText('2');
  await expect(page.locator('#appMenuStatTime')).toHaveText('1h 45m');
  await expect(page.locator('#appMenuStatDistance')).toHaveText('50.0');
});
