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
    'General', 'Map & navigation', 'Voice and sound', 'Ride Safe', 'Vehicle details', 'Notifications', 'Account and login', 'Privacy', 'About',
  ]);
  await expect(page.locator('#settingsList .settings-category-icon')).toHaveCount(9);
  // The version lives on the About page, not under the list.
  await expect(page.locator('#settingsList')).not.toContainText('Version');
  // On a full-height phone screen (the installed app) the list fits, so it
  // stays still rather than scrolling.
  if (testInfo.project.name === 'phone-modern') {
    const size = page.viewportSize();
    await page.setViewportSize({ width: 393, height: 852 });
    const settingsScreen = page.locator('.screen[data-screen="settings"]');
    await expect.poll(() => settingsScreen.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(0);
    await page.setViewportSize(size);
  }
  await expect(page.locator('.settings-page')).not.toContainText('Offline Maps');
  await expect(page.locator('.settings-page')).not.toContainText('Communication');
  // Help & Support and the profile live in the avatar menu only.
  await expect(page.locator('.settings-page')).not.toContainText('Help & Support');
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
  await expect(page.locator('#sheetBody [data-toggle]')).toHaveCount(2);
  await openSettingsPage(page, 'navigationApp');
  await expect(page.locator('#sheetTitle')).toHaveText('Navigation app');
  await page.locator('#closeSheet').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Map & navigation');
  await page.locator('#closeSheetAll').click();
  await expect(page.locator('#sheetBackdrop')).toBeHidden();

  // Voice and sound: whether new routes speak directions.
  await page.locator('[data-settings-open="voiceSound"]').click();
  const spoken = page.locator('#sheetBody [data-toggle="spokenDirections"]');
  await expect(spoken).toHaveAttribute('aria-pressed', 'true');
  await spoken.click();
  await expect(spoken).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#closeSheetAll').click();

  // Vehicle details: a picker; Routes then shows only roads that suit it.
  await page.locator('[data-settings-open="vehicle"]').click();
  await expect(page.locator('#sheetBody [data-vehicle-option]')).toHaveText(['Motorcycle', 'Small motorcycle (up to 125cc)', 'Scooter']);
  await expect(page.locator('[data-vehicle-option="motorcycle_large"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-vehicle-option="scooter"]').click();
  await expect(page.locator('[data-vehicle-option="scooter"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-vehicle-option="motorcycle_large"]')).toHaveAttribute('aria-checked', 'false');
  const savedState = await page.evaluate(() => Object.keys(localStorage).map((key) => {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }).find((value) => value && typeof value === 'object' && 'vehicleCategory' in value));
  expect(savedState.vehicleCategory).toBe('scooter');
  expect(savedState.spokenDirections).toBe(false);
  await page.locator('#closeSheetAll').click();

  // Sign out lives in Account and login, with reset and delete.
  await page.locator('[data-settings-open="account"]').click();
  await expect(page.locator('#sheetBody .settings-page-heading')).toHaveText(['Login info', 'Advanced']);
  await expect(page.locator('#sheetBody .settings-row-label')).toHaveText(['Email', 'Signed-in devices', 'Sign out', 'Reset settings', 'Delete account']);
  await page.locator('#closeSheetAll').click();

  await page.locator('[data-settings-open="about"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('About');
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

  // The plan has exactly one home: "Your plan" in the avatar menu. Account
  // settings no longer repeat it.
  await expect(page.locator('#settingsList')).not.toContainText('Your plan');
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
  await expect(body).toContainText('Connected profiles');
  // Nothing from other pages is repeated here.
  for (const absent of ['Signed-in devices', 'Delete account', 'Reset settings', 'Choose your Nearby range']) {
    await expect(body).not.toContainText(absent);
  }
  await expect(body.locator('input, select')).toHaveCount(0);

  await page.locator('#sheetBody [data-settings-open="editProfile"]').first().click();
  await expect(page.locator('#sheetTitle')).toHaveText('Edit profile');
  await expect(page.locator('#editName')).toHaveValue(PROFILE.displayName);
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
  let remoteRevoked = false;
  let accountDeleted = false;

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
    if (request.method() === 'DELETE' && pathname === '/auth/me') {
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
  await expect.poll(() => accountDeleted).toBe(true);
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
  await expect(page.locator('[data-saved-place="home"]')).toHaveAttribute('aria-label', 'Home, Ace Cafe London');

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
