// Settings, plans, profile, account, sign-in and the Terms.
import { expect, test } from '@playwright/test';
import { RIDER_ID, PROFILE, mockAuthenticatedApi, assertNoViewportOverflow, openTab, openSettingsPage, openFromMenu, openOwnProfile } from './helpers.js';

test('PWA Notifications page: this device, then which kinds', async ({ page }) => {
  let profile = { ...PROFILE, notifyInvites: true, notifyChat: true };
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname !== `/riders/${RIDER_ID}/profile`) return null;
    if (request.method() === 'PUT') profile = { ...profile, ...JSON.parse(request.postData() || '{}') };
    return { body: profile };
  });
  await page.goto('/');
  await openFromMenu(page, 'settings');
  await page.locator('[data-settings-open="notifications"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Notifications');
  await expect(page.locator('#sheetBody .settings-row-label')).toHaveText(['Notifications on this device', 'Friend requests', 'Messages']);
  await expect(page.locator('#pushDeviceToggle')).toHaveAttribute('aria-pressed', 'false');
  // Both kinds start on; switching one off saves it to the profile.
  const messages = page.locator('#sheetBody [data-toggle="notifyChat"]');
  await expect(messages).toHaveAttribute('aria-pressed', 'true');
  await messages.click();
  await expect(messages).toHaveAttribute('aria-pressed', 'false');
  expect(profile.notifyChat).toBe(false);
});


test('PWA Rider Comms Maps beta entry is absent for non-admin roles', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => url.pathname === '/admin/me'
    ? { body: { role: 'moderator', permissions: [] } } : null);
  await page.goto('/#settings');
  await page.locator('[data-settings-open="mapNavigation"]').click();
  await expect(page.locator('#sheetBody .settings-page-heading')).toHaveText(['Route options', 'Saved places']);
  await expect(page.locator('#openMapBetaPreview')).toHaveCount(0);
  await expect(page.locator('#mapBetaAdminEntry')).toBeHidden();
});

test('PWA Rider Comms Maps beta requires fresh admin permission at launch', async ({ page }) => {
  let role = 'admin';
  let roleChecks = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => {
    if (url.pathname !== '/admin/me') return null;
    roleChecks += 1;
    return { body: { role, permissions: [] } };
  });
  await page.goto('/#settings');
  await page.locator('[data-settings-open="mapNavigation"]').click();
  const beta = page.locator('#openMapBetaPreview');
  await expect(beta).toBeVisible();
  await expect(page.locator('#sheetBody .settings-page-heading')).toHaveText(['Route options', 'Admin beta', 'Saved places']);

  // The staff role can be revoked while Settings remains open.
  role = 'moderator';
  await beta.click();
  await expect(page.locator('#openMapBetaPreview')).toHaveCount(0);
  await expect(page.locator('#mapBetaAdminEntry')).toBeHidden();
  expect(roleChecks).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveURL(/#settings$/);
});


test('PWA admin beta stays inside the app and can return to the classic map', async ({ page }) => {
  let checks = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => {
    if (url.pathname !== '/admin/me') return null;
    checks += 1;
    return { body: { role: 'admin', permissions: [] } };
  });
  await page.goto('/#settings');
  await page.locator('[data-settings-open="mapNavigation"]').click();
  await page.locator('#openMapBetaPreview').click();
  const dialog = page.locator('#riderMapBetaDialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#riderMapBetaFrame')).toHaveAttribute('src', './map-beta/');
  await expect(page.locator('#riderMapBetaFrame')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.frameLocator('#riderMapBetaFrame').locator('.return-classic')).toBeVisible();
  const mapChild = page.frameLocator('#riderMapBetaFrame').frameLocator('#mapBetaSandbox');
  await expect(mapChild.locator('#map')).toBeVisible();
  const storageIsolated = await page.frameLocator('#riderMapBetaFrame').locator('body').evaluate(() => {
    try { window.localStorage.getItem('rider-comms-session-v1'); return false; } catch { return true; }
  });
  expect(storageIsolated).toBe(true);
  await expect(page).toHaveURL(/#settings$/);
  await page.locator('.rider-map-beta-return').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#sheetTitle')).toHaveText('Map & navigation');

  // Open a second time: the embedded link also closes the preview.
  await page.locator('#openMapBetaPreview').click();
  await expect(dialog).toBeVisible();
  await expect(page.frameLocator('#riderMapBetaFrame').locator('.return-classic')).toBeVisible();
  await page.frameLocator('#riderMapBetaFrame').locator('.return-classic').click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#settings$/);
  expect(checks).toBeGreaterThanOrEqual(3);
});

test('direct standalone map URL cannot run third-party code in the top-level Rider Comms origin', async ({ page }) => {
  await page.goto('/map-beta/');
  await expect(page.locator('.return-classic')).toBeVisible();
  await expect(page.locator('#mapBetaSandbox')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.locator('#map')).toHaveCount(0);
  // Third-party scripts, when fetched, must run in the opaque-origin child.
  const topLevelScripts = await page.locator('script').evaluateAll((scripts) => scripts.map((s) => s.src));
  expect(topLevelScripts.every((url) => !url || !url.includes('unpkg.com'))).toBe(true);
  const child = page.frameLocator('#mapBetaSandbox');
  await expect(child.locator('#map')).toBeVisible();
  const denied = await child.locator('body').evaluate(() => {
    try { window.localStorage.getItem('rider-comms-session-v1'); return false; }
    catch { return true; }
  });
  expect(denied).toBe(true);
});

test('standalone map sandbox reports blocked MapLibre CDN instead of infinite loading', async ({ page }) => {
  // Public geography only: verify failure state without a logged-in session.
  await page.route('https://unpkg.com/**', (route) => route.abort());
  await page.goto('/map-beta/');
  await expect(page.locator('#mapBetaSandbox')).toHaveAttribute('sandbox', 'allow-scripts');
  const map = page.frameLocator('#mapBetaSandbox');
  await expect(map.locator('#status')).toHaveAttribute('data-load-state', 'error', { timeout: 15000 });
  await expect(map.locator('#status')).toContainText('Couldn’t load the prototype map');
  // A failed CDN import must leave no apparently working map controls.
  for (const id of ['#dayStyle', '#nightStyle', '#demoOverlay', '#resetCamera']) {
    await expect(map.locator(id)).toBeDisabled();
  }
  await expect(page.locator('#map')).toHaveCount(0);
  // Synthetic lane guidance is fully offline and is NOT legal permission.
  await map.locator('#laneGuidanceDemo summary').click();
  await expect(map.locator('#laneAccessStatus')).toHaveAttribute('data-example-access', 'illustrative_permitted');
  await expect(map.locator('#laneAccessStatus')).toContainText('synthetic timetable');
  await map.locator('#laneEvening').click();
  await expect(map.locator('#laneAccessStatus')).toHaveAttribute('data-example-access', 'illustrative_prohibited');
  await expect(map.locator('#laneAccessStatus')).toContainText('not permitted');
  await expect(map.locator('#laneGuidanceDemo')).toContainText('always follow signs');
  // The explicit retry reconstructs the same opaque document. No new
  // permission, third-party top-level script or PWA session is introduced.
  await map.locator('body').evaluate(() => { window.__retrySentinel = true; });
  await page.locator('#retryMapBeta').click();
  await expect.poll(async () => map.locator('body').evaluate(() => Boolean(window.__retrySentinel)))
    .toBe(false);
  await expect(page.locator('#mapBetaSandbox')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(map.locator('#status')).toHaveAttribute('data-load-state', 'error', { timeout: 15000 });
});

test('PWA admin beta traps Tab and Shift+Tab above Settings, with reusable close button', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => url.pathname === '/admin/me'
    ? { body: { role: 'admin', permissions: [] } } : null);
  await page.goto('/#settings');
  await page.locator('[data-settings-open="mapNavigation"]').click();
  const entry = page.locator('#openMapBetaPreview');
  const dialog = page.locator('#riderMapBetaDialog');
  for (let index = 0; index < 2; index += 1) {
    await entry.click();
    await expect(dialog).toBeVisible();
    await expect(page.locator('.rider-map-beta-return')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.querySelector('#riderMapBetaDialog')
      .contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('#riderMapBetaDialog')
      .contains(document.activeElement))).toBe(true);
    await page.locator('.rider-map-beta-return').click();
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
    await expect(page.locator('#sheetTitle')).toHaveText('Map & navigation');
    await expect(page.locator('#riderMapBetaFrame')).toHaveCount(0);
  }
});

test('PWA admin beta Escape closes when focus is inside either sandboxed iframe', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => url.pathname === '/admin/me'
    ? { body: { role: 'admin', permissions: [] } } : null);
  await page.goto('/#settings');
  await page.locator('[data-settings-open="mapNavigation"]').click();
  const entry = page.locator('#openMapBetaPreview');
  const dialog = page.locator('#riderMapBetaDialog');
  await entry.click();
  const outer = page.frameLocator('#riderMapBetaFrame');
  await outer.locator('.return-classic').focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await entry.click();
  const nested = page.frameLocator('#riderMapBetaFrame').frameLocator('#mapBetaSandbox');
  await expect(nested.locator('#map')).toBeVisible();
  await nested.locator('#map').evaluate((el) => { el.tabIndex = 0; el.focus(); });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await expect(page.locator('#sheetTitle')).toHaveText('Map & navigation');
});

test('PWA admin beta closes on Ride Safe lock or cross-tab session change', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => url.pathname === '/admin/me'
    ? { body: { role: 'admin', permissions: [] } } : null);
  await page.goto('/#settings');
  await page.locator('[data-settings-open="mapNavigation"]').click();
  const entry = page.locator('#openMapBetaPreview');
  const dialog = page.locator('#riderMapBetaDialog');
  await entry.click();
  await page.evaluate(() => {
    window.RiderMovementSafety.isLockedForSafety = () => true;
  });
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await page.evaluate(() => {
    window.RiderMovementSafety.isLockedForSafety = (state) => state === 'moving';
  });
  await entry.click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'rider-comms-session-v1', newValue: null }));
  });
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
});

test('PWA admin beta closes on periodic role revocation without reopening Settings', async ({ page }) => {
  let role = 'admin';
  let checks = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => {
    if (url.pathname !== '/admin/me') return null;
    checks += 1;
    return { body: { role, permissions: [] } };
  });
  await page.clock.install();
  await page.goto('/#settings');
  await page.locator('[data-settings-open="mapNavigation"]').click();
  const entry = page.locator('#openMapBetaPreview');
  await entry.click();
  await expect(page.locator('#riderMapBetaDialog')).toBeVisible();
  role = 'moderator';
  await page.clock.fastForward(30_100);
  await expect(page.locator('#riderMapBetaDialog')).toHaveCount(0);
  await expect(entry).toBeFocused();
  await expect(page.locator('#sheetTitle')).toHaveText('Map & navigation');
  expect(checks).toBeGreaterThanOrEqual(3);
});

test('PWA admin map preview supports Escape and restores Settings focus', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => url.pathname === '/admin/me'
    ? { body: { role: 'admin', permissions: [] } } : null);
  await page.goto('/#settings');
  await page.locator('[data-settings-open="mapNavigation"]').click();
  await page.locator('#openMapBetaPreview').click();
  await expect(page.locator('#riderMapBetaDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#riderMapBetaDialog')).toHaveCount(0);
  await expect(page.locator('#openMapBetaPreview')).toBeFocused();
  await expect(page.locator('#sheetTitle')).toHaveText('Map & navigation');
});

test('PWA Settings is a real settings list matching the native app', async ({ page }, testInfo) => {
  let profile = { ...PROFILE };
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname !== `/riders/${RIDER_ID}/profile`) return null;
    if (request.method() === 'PUT') profile = { ...profile, ...JSON.parse(request.postData() || '{}') };
    return { body: profile };
  });
  await page.goto('/#settings');

  // The root lists categories, each opening its own page.
  await expect(page.locator('#settingsList .settings-section-title')).toHaveText(['Riding', 'Account']);
  await expect(page.locator('#settingsList .settings-row-label')).toHaveText([
    'General', 'Map & navigation', 'Voice and sound', 'Notifications', 'Ride Safe', 'Vehicle details', 'Account and login', 'Privacy', 'Your plan', 'Help & Support',
  ]);
  await expect(page.locator('#settingsList .settings-category-icon')).toHaveCount(10);
  // The current choice shows in grey beside its category.
  await expect(page.locator('[data-settings-open="general"] .settings-row-value')).toHaveText('Miles');
  await expect(page.locator('#settingsList [data-settings-open="mapNavigation"] .settings-row-value')).toHaveText('Google Maps');
  await expect(page.locator('[data-settings-open="rideSafe"] .settings-row-value')).toHaveText('On');
  await expect(page.locator('[data-settings-open="vehicle"] .settings-row-value')).toHaveText('Motorcycle');
  await expect(page.locator('[data-settings-open="plan"] .settings-row-value')).toHaveText('Free');
  // The version lives on the About page, not under the list.
  await expect(page.locator('#settingsList')).not.toContainText('Version');
  // The whole list fits a phone screen without scrolling: an installed app
  // on an iPhone SE (375 x 667) and on a 6.1-inch iPhone (393 x 852).
  if (testInfo.project.name === 'phone-modern') {
    const size = page.viewportSize();
    for (const viewport of [{ width: 375, height: 667 }, { width: 393, height: 852 }]) {
      await page.setViewportSize(viewport);
      const overflow = await page.locator('.screen[data-screen="settings"]').evaluate((screen) => screen.scrollHeight - screen.clientHeight);
      expect(overflow, `Settings scrolls by ${overflow}px at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(0);
      await expect(page.locator('#settingsList [data-settings-open="help"]')).toBeInViewport({ ratio: 1 });
    }
    await page.setViewportSize(size);
  }
  await expect(page.locator('.settings-page')).not.toContainText('Offline Maps');
  await expect(page.locator('.settings-page')).not.toContainText('Communication');
  // The profile lives in the avatar menu only.
  await expect(page.locator('.settings-profile-row')).toHaveCount(0);

  // Each page has a centred title between back and close.
  await page.locator('[data-settings-open="general"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('General');
  await expect(page.locator('#closeSheetAll')).toBeVisible();
  // Distance units is a segmented control that saves straight away.
  await expect(page.locator('[data-unit-segment="mi"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-unit-segment="km"]').click();
  await expect(page.locator('[data-unit-segment="km"]')).toHaveAttribute('aria-checked', 'true');
  expect(profile.unitSystem).toBe('km');
  await page.locator('#closeSheet').click();
  await expect(page.locator('#sheetBackdrop')).toBeHidden();

  // A page opened from a category page goes back to it; X closes them all.
  await page.locator('[data-settings-open="mapNavigation"]').click();
  await expect(page.locator('[data-settings-open="navigationApp"] .settings-row-value')).toHaveText('Google Maps');
  await expect(page.locator('#sheetBody .settings-page-heading')).toHaveText(['Route options', 'Saved places']);
  await expect(page.locator('#sheetBody [data-toggle]')).toHaveCount(3);
  await openSettingsPage(page, 'navigationApp');
  await expect(page.locator('#sheetTitle')).toHaveText('Navigation app');
  await page.locator('#closeSheet').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Map & navigation');
  await page.locator('#closeSheetAll').click();
  await expect(page.locator('#sheetBackdrop')).toBeHidden();

  // Voice and sound: whether new routes speak directions, shown on its row.
  await expect(page.locator('[data-settings-open="voiceSound"] .settings-row-value')).toHaveText('Spoken');
  await page.locator('[data-settings-open="voiceSound"]').click();
  const spoken = page.locator('#sheetBody [data-toggle="spokenDirections"]');
  await expect(spoken).toHaveAttribute('aria-pressed', 'true');
  await spoken.click();
  await expect(spoken).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#closeSheetAll').click();

  // Ride Safe: the switch, then what it locks and what keeps working.
  await page.locator('[data-settings-open="rideSafe"]').click();
  await expect(page.locator('#sheetBody .settings-page-heading')).toHaveText(['Locked while you’re moving', 'Still works']);
  await expect(page.locator('#sheetBody .settings-info-list li').first()).toHaveText('Messages and friends');
  await page.locator('#closeSheetAll').click();

  // Vehicle details: a picker in two groups; Routes then shows only roads that suit it.
  await page.locator('[data-settings-open="vehicle"]').click();
  await expect(page.locator('#sheetBody .settings-page-heading')).toHaveText(['Motorcycles', 'Cars and vans']);
  await expect(page.locator('#sheetBody [data-vehicle-option]')).toHaveText(['Motorcycle', 'Small motorcycle (up to 125cc)', 'Scooter or moped', 'Car', 'Van or motorhome']);
  await expect(page.locator('[data-vehicle-option="motorcycle_large"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-vehicle-option="scooter"]').click();
  await expect(page.locator('[data-vehicle-option="scooter"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-vehicle-option="motorcycle_large"]')).toHaveAttribute('aria-checked', 'false');
  const savedState = await page.evaluate(() => Object.keys(localStorage).map((key) => {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }).find((value) => value && typeof value === 'object' && 'vehicleCategory' in value));
  expect(savedState.vehicleCategory).toBe('scooter');
  expect(savedState.spokenDirections).toBe(false);
  await page.locator('[data-vehicle-option="car"]').click();
  await expect(page.locator('[data-vehicle-option="car"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#closeSheetAll').click();
  await expect(page.locator('[data-settings-open="vehicle"] .settings-row-value')).toHaveText('Car');

  // Your plan and Help & Support open the same pages as the menu.
  await page.locator('#settingsList [data-settings-open="plan"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Your plan');
  await page.locator('#closeSheetAll').click();
  await page.locator('#settingsList [data-settings-open="help"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Help & Support');
  await page.locator('#closeSheetAll').click();

  // Sign out lives in Account and login, with reset and delete.
  await page.locator('[data-settings-open="account"]').click();
  await expect(page.locator('#sheetBody .settings-page-heading')).toHaveText(['Login info', 'Advanced']);
  await expect(page.locator('#sheetBody .settings-row-label')).toHaveText(['Email', 'Signed-in devices', 'Sign out', 'Reset settings', 'Delete account']);
  await page.locator('#closeSheetAll').click();

  // About is the last section of Help & Support.
  await page.locator('#settingsList [data-settings-open="help"]').click();
  await expect(page.locator('#sheetBody .settings-page-heading').last()).toHaveText('About');
  await expect(page.locator('#sheetBody')).toContainText('Version 0.3.0 · PWA');
  await page.screenshot({ path: testInfo.outputPath('settings-approved-mockup-parity.png'), fullPage: true });
  await assertNoViewportOverflow(page);
});

test('PWA settings sheets own the bottom edge without competing with app chrome', async ({ page }, testInfo) => {
  await mockAuthenticatedApi(page, 'unknown');
  await page.goto('/#settings');
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));

  const nav = page.locator('.bottom-nav');
  const app = page.locator('#app');
  const settingsScreen = page.locator('[data-screen="settings"]');
  // Map, Ride and Friends are menu rows: there is no tab bar.
  await expect(nav).toHaveCount(0);

  await openSettingsPage(page, 'blockedRiders');
  await expect(page.locator('#sheetBackdrop')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/sheet-open/);
  await expect(app).toHaveAttribute('inert', '');
  await expect(nav).toBeHidden();
  await expect(settingsScreen).toHaveCSS('overflow', 'hidden');
  await page.locator('.sheet').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });

  const sheetBox = await page.locator('.sheet').boundingBox();
  const viewport = page.viewportSize();
  expect(sheetBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs((sheetBox.y + sheetBox.height) - viewport.height)).toBeLessThanOrEqual(1);
  const sheetPaddingBottom = await page.locator('.sheet').evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom));
  expect(sheetPaddingBottom).toBeGreaterThanOrEqual(34);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-settings-privacy-sheet.png`),
    fullPage: true,
  });

  await page.locator('#closeSheetAll').click();
  await expect(page.locator('html')).not.toHaveClass(/sheet-open/);
  await expect(app).not.toHaveAttribute('inert', '');
  await expect(nav).toBeHidden();
});

test('PWA plan screen shows every plan and sends buying to the mobile app', async ({ page }) => {
  const updates = [];
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/billing') return { body: { tier: 'premium', expiresAt: null, purchasesEnabled: false } };
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'GET') return { body: { ...PROFILE, zoneTier: 'premium' } };
      if (request.method() === 'PUT') updates.push(JSON.parse(request.postData() || '{}'));
    }
    return null;
  });
  await page.goto('/#settings');

  // The plan's page is Your plan: the menu and the Settings root link to it,
  // and Account settings don't repeat it.
  await expect(page.locator('#settingsList [data-settings-open="plan"]')).toHaveCount(1);
  await expect(page.locator('.plan-card')).toHaveCount(0);

  await openTab(page, 'map');
  await page.locator('#mapAvatarButton').click();
  await expect(page.locator('#appMenuPlan')).toHaveText('Premium');
  await page.locator('[data-menu-sheet="plans"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Your plan');
  const planSection = page.locator('[data-settings-section="plans"]');
  await expect(planSection).toBeVisible();
  await expect(page.locator('.plan-card')).toHaveCount(3);
  await expect(page.locator('[data-plan-tier="free"]')).toContainText('1 mi Nearby range');
  // A summary of the current plan first; "Free" isn't repeated as a price.
  await expect(page.locator('.plan-summary')).toContainText('Premium');
  await expect(page.locator('.plan-summary')).toContainText('6 mi Nearby range');
  await expect(page.locator('[data-plan-tier="free"] .plan-price')).toHaveCount(0);
  await expect(page.locator('[data-plan-tier="premium"]')).toContainText('£4.99 / month');
  await expect(page.locator('[data-plan-tier="premium_plus"]')).toContainText('20 mi Nearby range');
  await expect(page.locator('[data-plan-tier="premium_plus"]')).toContainText('£9.99 / month');
  await expect(page.locator('[data-plan-tier="premium"] .plan-pill')).toHaveText('Current');
  await expect(page.locator('.plan-pill', { hasText: 'Current' })).toHaveCount(1);
  // Nothing is bought, cancelled or changed from the web.
  await expect(planSection).toContainText('App Store or Google Play subscription settings');
  await expect(planSection.locator('button')).toHaveCount(0);
  await expect(planSection.locator('a')).toHaveCount(0);
  expect(updates).toEqual([]);
});

test('PWA Help & Support leads with contact, then questions, safety and legal pages', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await page.locator('#mapAvatarButton').click();
  await page.locator('[data-menu-sheet="help"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Help & Support');
  await expect(page.locator('.help-contact')).toHaveAttribute('href', 'support.html');
  const questions = page.locator('.faq-item');
  await expect(questions).toHaveCount(7);
  await expect(questions.first().locator('p')).toBeHidden();
  await questions.first().locator('summary').click();
  await expect(questions.first().locator('p')).toBeVisible();
  await expect(page.locator('.help-links .settings-row')).toHaveText(['Privacy Policy', 'Terms of Service', 'Community Guidelines']);
  // No browser-only wording on a page the native app mirrors.
  await expect(page.locator('#sheetBody')).not.toContainText('kept in this browser');
});

test('PWA navigation preference offers Rider Comms, Google Maps, Waze and Apple Maps', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#settings');

  await openSettingsPage(page, 'navigationApp');
  const options = page.locator('[data-navigation-option]');
  await expect(options).toHaveCount(4);
  await expect(page.locator('[data-navigation-option="google_maps"]')).toHaveAttribute('aria-checked', 'true');

  await page.locator('[data-navigation-option="waze"]').click();
  await expect(page.locator('[data-navigation-option="waze"]')).toHaveAttribute('aria-checked', 'true');
  // Back to Map & navigation, which shows the new choice.
  await page.locator('#closeSheet').click();
  await expect(page.locator('[data-settings-open="navigationApp"] .settings-row-value')).toHaveText('Waze');
  await openSettingsPage(page, 'navigationApp');
  await expect(page.locator('[data-navigation-option="waze"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#closeSheet').click();

  await page.reload();
  await openSettingsPage(page, 'navigationApp');
  await expect(page.locator('[data-navigation-option="waze"]')).toHaveAttribute('aria-checked', 'true');
});

test('PWA route options avoid motorways and tolls and survive a reload', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#settings');

  // The switches are on the Map & navigation page.
  await page.locator('[data-settings-open="mapNavigation"]').click();
  const motorways = page.locator('#sheetBody [data-toggle="avoidHighways"]');
  const tolls = page.locator('#sheetBody [data-toggle="avoidTolls"]');
  await expect(motorways).toHaveAttribute('aria-pressed', 'false');
  await expect(tolls).toHaveAttribute('aria-pressed', 'false');

  await motorways.click();
  await expect(motorways).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#appNotification')).toContainText('avoid motorways');
  await assertNoViewportOverflow(page);

  await page.reload();
  await page.locator('[data-settings-open="mapNavigation"]').click();
  await expect(page.locator('[data-toggle="avoidHighways"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-toggle="avoidTolls"]')).toHaveAttribute('aria-pressed', 'false');
});

test('PWA View profile is your profile, separate from editing it and from Account settings', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await openOwnProfile(page);

  const body = page.locator('#sheetBody');
  await expect(page.locator('.my-profile-hero')).toContainText(PROFILE.displayName);
  await expect(page.locator('.my-profile-hero .rider-avatar-svg')).toBeVisible();
  // The bio is shared with Rider Social.
  await expect(page.locator('.my-profile-bio')).toHaveText(PROFILE.bio);
  await expect(body).toContainText('Connected profiles');
  // Nothing from other pages is repeated here.
  for (const absent of ['Signed-in devices', 'Delete account', 'Reset settings', 'Choose your Nearby range']) {
    await expect(body).not.toContainText(absent);
  }
  await expect(body.locator('input, select')).toHaveCount(0);

  await page.locator('#sheetBody [data-settings-open="editProfile"]').first().click();
  await expect(page.locator('#sheetTitle')).toHaveText('Edit profile');
  await expect(page.locator('#editName')).toHaveValue(PROFILE.displayName);
  await expect(page.locator('#editBio')).toHaveValue(PROFILE.bio);
  await expect(page.locator('#editBio')).toHaveAttribute('maxlength', '160');
  await expect(page.locator('#sheetInstagramVisibility')).toBeVisible();
  await expect(body).not.toContainText('Signed-in devices');
  // Back from Edit profile returns to the profile, not the map.
  await page.locator('#closeSheet').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Profile');
  await page.locator('#closeSheet').click();
  await expect(page.locator('#sheetBackdrop')).toBeHidden();

  // Settings has the account rows, never the profile or the plan.
  await openFromMenu(page, 'settings');
  await page.locator('[data-settings-open="account"]').click();
  await expect(page.locator('#sheetBody')).toContainText('Signed-in devices');
  await expect(page.locator('#sheetBody')).toContainText('Delete account');
  await expect(page.locator('#editName')).toHaveCount(0);
  await expect(page.locator('.plan-card')).toHaveCount(0);
});

test('PWA profile avatar families persist and render the selected identity', async ({ page }) => {
  let savedAvatar = 'ember';
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (request.method() === 'PUT' && url.pathname === `/riders/${RIDER_ID}/profile`) {
      const body = JSON.parse(request.postData() || '{}');
      if (typeof body.avatarId === 'string') savedAvatar = body.avatarId;
      return { body: { ...PROFILE, avatarId: savedAvatar } };
    }
    return null;
  });

  await page.goto('/');
  await openOwnProfile(page, { edit: true });
  // The grid is behind Change avatar, so Name and Bio come first.
  await expect(page.locator('#avatarPicker')).toBeHidden();
  await expect(page.locator('#editName')).toBeInViewport();
  await page.locator('#changeAvatarBtn').click();
  await expect(page.locator('#changeAvatarBtn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-avatar-family-tab="helmet"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-avatar-option="ember"]')).toHaveAttribute('aria-checked', 'true');

  await page.locator('[data-avatar-family-tab="motorbike"]').click();
  await expect(page.locator('[data-avatar-family-panel="motorbike"]')).toBeVisible();
  await expect(page.locator('[data-avatar-option="bike_sport"] .rider-avatar-svg')).toHaveAttribute('data-avatar-family', 'motorbike');
  await page.locator('[data-avatar-option="bike_sport"]').click();
  await expect.poll(() => savedAvatar).toBe('bike_sport');
  await expect(page.locator('[data-avatar-option="bike_sport"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-avatar]').first().locator('.rider-avatar-svg')).toHaveAttribute('data-avatar-family', 'motorbike');

  await page.locator('[data-avatar-family-tab="car"]').click();
  await expect(page.locator('[data-avatar-family-panel="car"]')).toBeVisible();
  await expect(page.locator('[data-avatar-option="car_hatchback"] .rider-avatar-svg')).toHaveAttribute('data-avatar-family', 'car');
  await page.locator('[data-avatar-option="car_hatchback"]').click();
  await expect.poll(() => savedAvatar).toBe('car_hatchback');
  await expect(page.locator('[data-avatar-option="car_hatchback"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-avatar]').first().locator('.rider-avatar-svg')).toHaveAttribute('data-avatar-family', 'car');
});

test('PWA exposes session management and account deletion', async ({ page }) => {
  await page.addInitScript((riderId) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(`riderComms.rideHistory.${riderId}`, '[]');
    localStorage.setItem(`riderComms.queuedHazardReports.${riderId}`, '[]');
    localStorage.setItem(`riderComms.savedPlaces:${riderId}`, '{}');
    localStorage.setItem('riderComms.rideHistory.rider_other', '[]');
  }, RIDER_ID);
  let remoteRevoked = false;
  let accountDeleted = false;
  let deletionReauthenticated = false;

  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    const pathname = url.pathname;
    if (request.method() === 'DELETE' && pathname === '/auth/sessions/session-remote') {
      remoteRevoked = true;
      return { status: 204 };
    }
    if (request.method() === 'GET' && pathname === '/auth/sessions') {
      return {
        body: {
          sessions: remoteRevoked
            ? [{ id: 'session-current', deviceName: 'This iPhone', lastSeenAt: new Date().toISOString(), current: true }]
            : [
                { id: 'session-current', deviceName: 'This iPhone', lastSeenAt: new Date().toISOString(), current: true },
                { id: 'session-remote', deviceName: 'Other phone', lastSeenAt: new Date().toISOString(), current: false },
              ],
        },
      };
    }
    if (request.method() === 'POST' && pathname === '/auth/reauthenticate') {
      const submitted = JSON.parse(request.postData() || '{}');
      // The deletion fixture requires a valid password, just like the staged
      // account security gate. A native confirm() alone must not delete.
      if (submitted.password !== 'synthetic-password') {
        return { status: 401, body: { error: 'invalid_credentials' } };
      }
      deletionReauthenticated = true;
      return { body: { reauthenticated: true, validForMs: 900000 } };
    }
    if (request.method() === 'DELETE' && pathname === '/auth/me') {
      if (!deletionReauthenticated) return { status: 403, body: { error: 'reauth_required' } };
      accountDeleted = true;
      return { body: {} };
    }
    return null;
  });

  await page.goto('/#settings');
  await openSettingsPage(page, 'devices');
  await expect(page.locator('#sessionList')).toContainText('Other phone');
  await page.locator('[data-revoke-session="session-remote"]').click();
  await expect(page.locator('#sessionList')).not.toContainText('Other phone');
  expect(remoteRevoked).toBe(true);

  // Back to Account and login, where delete sits under Advanced.
  await page.locator('#closeSheet').click();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.locator('#deleteAccountBtn').click();
  const passwordDialog = page.locator('#accountStepupDialog');
  await expect(passwordDialog).toBeVisible();
  await expect(passwordDialog.locator('#accountStepupPassword')).toHaveAttribute('type', 'password');
  expect(accountDeleted).toBe(false);
  expect(deletionReauthenticated).toBe(false);
  await passwordDialog.locator('#accountStepupPassword').fill('synthetic-password');
  await passwordDialog.locator('[data-stepup-submit]').click();
  await expect(passwordDialog).toHaveCount(0);
  await expect.poll(() => deletionReauthenticated).toBe(true);
  await expect.poll(() => accountDeleted).toBe(true);
  // The deleted rider's saved places, recent rides and waiting reports are
  // gone; other riders' data stays. (The app reloads after deleting, so a
  // read can land mid-navigation. The test fixture signs the rider straight
  // back in on that reload, so the app's own settings key is written afresh
  // and isn't part of this check.)
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('riderComms.') && key.includes('rider_')).sort()).catch(() => null))
    .toEqual(['riderComms.rideHistory.rider_other']);
});

test('PWA Settings sets Home and Work without moving the map, and can remove them', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.addInitScript(({ riderId }) => {
    localStorage.setItem(`riderComms.recentSearches:${riderId}`, JSON.stringify([
      { placeId: 'ace', name: 'Ace Cafe London', secondary: 'North Circular Rd', lat: 51.541, lng: -0.277 },
    ]));
  }, { riderId: RIDER_ID });
  await page.goto('/');
  await openTab(page, 'settings');
  await openSettingsPage(page, 'mapNavigation');
  const homeRow = page.locator('[data-saved-place-setting="home"]');
  await expect(homeRow).toContainText('Not set');
  await expect(page.locator('#sheetBody')).toContainText('the route starts straight away');

  // Choosing Home saves it and comes back to the page, with no map change.
  await homeRow.click();
  await expect(page.locator('#searchScreen')).toBeVisible();
  await expect(page.locator('#searchSaveBanner')).toHaveText('Choose your Home');
  await expect(page.locator('#searchSaveCurrent')).toBeHidden();
  await page.locator('#searchScreenResults [data-recent-index="0"]').click();
  await expect(page.locator('#searchScreen')).toBeHidden();
  await expect(page.locator('[data-saved-place-setting="home"]')).toContainText('Ace Cafe London');
  await expect(page.locator('#destinationCard')).toBeHidden();
  await expect(page.locator('[data-saved-place="home"]')).toHaveAttribute('aria-label', /^Home, Ace Cafe London(, [\d.]+ (mi|km|ft|m))?$/);

  // Search shows the current place and can remove it.
  await page.locator('[data-saved-place-setting="home"]').click();
  await expect(page.locator('#searchSaveCurrent')).toContainText('Now: Ace Cafe London');
  await page.locator('#searchSaveRemove').click();
  await expect(page.locator('[data-saved-place-setting="home"]')).toContainText('Not set');

  // Back from search returns to the page too.
  await page.locator('[data-saved-place-setting="work"]').click();
  await page.locator('#searchScreenBack').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Map & navigation');
});

test('PWA password recovery is discoverable and enumeration-safe', async ({ page }) => {
  await page.route('https://backend-production-7fa0.up.railway.app/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/auth/password-reset/request') {
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true }) });
    }
    if (pathname === '/auth/password-reset/confirm') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reset: true }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) });
  });
  await page.goto('/');
  await expect(page.locator('#authScreen')).toBeVisible();
  await page.locator('#forgotPasswordBtn').click();
  await expect(page.locator('#recoverForm')).toBeVisible();
  await page.locator('#recoverEmail').fill('unknown@example.com');
  await page.locator('#recoverSubmit').click();
  await expect(page.locator('#resetForm')).toBeVisible();
  await expect(page.locator('#authNotice')).toContainText('If that address belongs to an account');
  await page.locator('#resetToken').fill('one-time-reset-token');
  await page.locator('#resetPassword').fill('new-secure-password');
  await page.locator('#resetSubmit').click();
  await expect(page.locator('#loginForm')).toBeVisible();
  await expect(page.locator('#authNotice')).toContainText('Password updated');
});

test('PWA asks existing accounts to agree to the current Terms before the app opens', async ({ page }) => {
  let accepted = null;
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/auth/me') return { body: { riderId: RIDER_ID, emailVerified: true, termsAccepted: accepted !== null, termsVersion: '2026-10-01' } };
    if (url.pathname === '/auth/accept-terms') {
      accepted = request.postDataJSON();
      return { body: { accepted: true } };
    }
    return null;
  });
  await page.goto('/');
  const gate = page.getByRole('dialog', { name: 'Updated terms' });
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('link', { name: 'Community Guidelines' })).toHaveAttribute('href', 'guidelines.html');
  await gate.getByRole('button', { name: 'I agree' }).click();
  await expect(gate).toHaveCount(0);
  expect(accepted).toEqual({ version: '2026-10-01' });
  await expect(page.locator('#app')).toBeVisible();
});

test('PWA sign-in explains each failure in plain words', async ({ page }) => {
  const replies = [
    { status: 401, body: { error: 'invalid_credentials' } },
    { status: 503, body: {} },
    { status: 400, body: {} },
  ];
  await page.route('https://backend-production-7fa0.up.railway.app/**', async (route) => {
    const request = route.request();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (new URL(request.url()).pathname === '/auth/login') {
      const reply = replies.shift();
      return route.fulfill({ status: reply.status, headers, contentType: 'application/json', body: JSON.stringify(reply.body) });
    }
    return route.fulfill({ status: 404, headers, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await page.locator('#loginUsername').fill('rider');
  await page.locator('#loginPassword').fill('wrong-password');
  await page.locator('#loginSubmit').click();
  await expect(page.locator('#loginError')).toHaveText('The username or password is incorrect.');
  await page.locator('#loginSubmit').click();
  await expect(page.locator('#loginError')).toHaveText('Rider Comms isn’t responding right now. Try again in a moment.');
  await page.locator('#loginSubmit').click();
  await expect(page.locator('#loginError')).toHaveText('That didn’t work. Try again.');
});

test('PWA signup requires agreeing to the Terms and sends the agreement', async ({ page }) => {
  let signup = null;
  await page.route('https://backend-production-7fa0.up.railway.app/**', async (route) => {
    const request = route.request();
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (new URL(request.url()).pathname === '/auth/signup') {
      signup = request.postDataJSON();
      return route.fulfill({ status: 400, headers, contentType: 'application/json', body: JSON.stringify({ error: 'username_taken' }) });
    }
    return route.fulfill({ status: 404, headers, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await page.locator('#createAccountLink').click();
  await page.locator('#signupUsername').fill('new_rider');
  await page.locator('#signupEmail').fill('new@example.com');
  await page.locator('#signupPassword').fill('correct-horse');
  await page.locator('#signupSubmit').click();
  await expect(page.locator('#signupError')).toHaveText('Confirm you’re 16 or older and agree to the Terms of Service and Community Guidelines to create an account.');
  expect(signup).toBeNull();
  await page.locator('#signupTerms').check();
  await page.locator('#signupSubmit').click();
  await expect(page.locator('#signupError')).toHaveText('That username is already taken.');
  expect(signup).toMatchObject({ username: 'new_rider', acceptTerms: true });
});

test('PWA Settings lists blocked riders and can unblock them', async ({ page }) => {
  let blocked = [{ riderId: 'rider_blocked01', displayName: 'Blocked Rider', handle: '@blocked', blockedAt: Date.now() }];
  const unblocked = [];
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/blocks' && request.method() === 'GET') return { body: { blockedRiderIds: blocked.map((rider) => rider.riderId), blocked } };
    if (url.pathname.startsWith('/blocks/') && request.method() === 'DELETE') {
      const riderId = decodeURIComponent(url.pathname.slice('/blocks/'.length));
      unblocked.push(riderId);
      blocked = blocked.filter((rider) => rider.riderId !== riderId);
      return { status: 204 };
    }
    return null;
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/#settings');
  await openSettingsPage(page, 'blockedRiders');
  await expect(page.locator('#blockedRidersList')).toContainText('Blocked Rider');
  await page.locator('[data-unblock="rider_blocked01"]').click();
  await expect.poll(() => unblocked).toEqual(['rider_blocked01']);
  await expect(page.locator('#blockedRidersList')).not.toContainText('Blocked Rider');
  // "Blocked Rider unblocked." is a success: a polite status, not an alert.
  const notice = page.locator('#appNotification');
  await expect(notice).toContainText('Blocked Rider unblocked.');
  await expect(notice).toHaveAttribute('data-tone', 'info');
  await expect(notice).toHaveAttribute('role', 'status');
});

test('PWA terms prompt scrolls on short landscape screens', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => (url.pathname === '/auth/me' ? { body: { riderId: RIDER_ID, emailVerified: true, termsAccepted: false, termsVersion: '2026-10-01' } } : null));
  await page.goto('/');
  const gate = page.getByRole('dialog', { name: 'Updated terms' });
  await expect(gate.getByRole('heading', { name: 'Updated terms' })).toBeInViewport();
  const signOut = gate.getByRole('button', { name: 'Sign out' });
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport({ ratio: 1 });
});

test('PWA menu links to Rider Social only for riders the server lets in', async ({ page, context }) => {
  let allowed = false;
  await mockAuthenticatedApi(page, 'stationary', async ({ url }) => {
    if (url.pathname !== '/social/bootstrap') return null;
    return allowed
      ? { body: { entitlement: 'beta', policyVersion: 'social-open-beta-v1', capabilities: {} } }
      : { status: 403, body: { error: 'social_beta_not_enabled' } };
  });
  await page.goto('/');
  await openTab(page, 'map');
  await page.locator('#mapAvatarButton').click();
  await expect(page.locator('[data-menu-nav="routes"]')).toBeVisible();
  await expect(page.locator('#appMenuSocial')).toBeHidden();
  await page.locator('#closeAppMenu').click();

  // A refusal isn't remembered, so access granted later shows up.
  allowed = true;
  await page.locator('#mapAvatarButton').click();
  const social = page.locator('#appMenuSocial');
  await expect(social).toBeVisible();
  await expect(social).toContainText('Rider Social');
  const popup = context.waitForEvent('page');
  await social.click();
  const opened = await popup;
  expect(opened.url()).toMatch(/^https:\/\/social-web-preview-preview\.up\.railway\.app\/?$/);
  await opened.close();
  await expect(page.locator('#appMenu')).toBeHidden();

  allowed = false;
  const accessCheck = page.waitForResponse((response) => new URL(response.url()).pathname === '/social/bootstrap');
  await page.locator('#mapAvatarButton').click();
  expect((await accessCheck).status()).toBe(403);
  await expect(social).toBeHidden();
});
