// Look and feel: approved baselines, day and night, screens without errors or overflow, and accessibility.
import { expect, test } from '@playwright/test';
import { AXE_PROJECTS, expectNoAxeViolations } from './axe.js';
import { mockAuthenticatedApi, assertNoViewportOverflow, openTab, openSettingsPage, openFromMenu, openOwnProfile, expectNear } from './helpers.js';

test('login baseline matches the approved night-rider concept in day and night', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Login baseline screenshots target iPhone 17 Pro Max geometry.');
  // Two colour schemes x several screenshot states: ~20 s on a normal CI
  // runner, so the 30 s default leaves no headroom on a slower one.
  test.setTimeout(90_000);

  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '59px'));

    await expect(page.locator('#authScreen')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();

    // Capture the separate branded entry state without coupling this visual
    // audit to WebKit timer scheduling. The production splash auto-hides
    // after its brief cold-start dwell; let that timer finish first so it
    // can't hide the splash again between the test showing it and checking
    // it (a main run failed that way), then the test owns visibility.
    await expect(page.locator('#authSplash')).toBeHidden();
    await page.evaluate(() => {
      const splash = document.querySelector('#authSplash');
      if (splash) splash.hidden = false;
    });
    await expect(page.locator('#authSplash')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`iphone-17-pro-max-auth-splash-${scheme}.png`),
      fullPage: true,
    });
    await page.evaluate(() => {
      const splash = document.querySelector('#authSplash');
      if (splash) splash.hidden = true;
    });

    await expect(page.locator('#loginUsername')).not.toBeFocused();
    await expect(page.locator('#loginPassword')).not.toBeFocused();
    await expect(page.locator('#authTitle')).toHaveText('Welcome back');
    await expect(page.locator('#authDescription')).toBeHidden();
    await expect(page.locator('#loginForm')).toBeVisible();
    await expect(page.locator('#signupForm')).toBeHidden();
    await expect(page.locator('.auth-segmented')).toBeHidden();
    await expect(page.locator('#authLoginExtras')).toBeVisible();
    // No placeholder third-party sign-in buttons (App Review 2.1 / 4.8).
    await expect(page.locator('.auth-social-row')).toHaveCount(0);
    await expect(page.locator('#createAccountLink')).toBeVisible();
    await expect(page.locator('#rememberMe')).toBeChecked();
    await assertNoViewportOverflow(page);

    const visual = await page.evaluate(() => {
      const screen = document.querySelector('#authScreen');
      const background = getComputedStyle(document.querySelector('.auth-visual'));
      const username = getComputedStyle(document.querySelector('#loginUsername'));
      const button = getComputedStyle(document.querySelector('#loginSubmit'));
      const card = getComputedStyle(document.querySelector('.auth-card'));
      const intro = document.querySelector('.auth-intro').getBoundingClientRect();
      // The last control on the log-in card: it must sit on screen, below the title.
      const terms = document.querySelector('#createAccountLink').getBoundingClientRect();
      return {
        screenBackground: getComputedStyle(screen).backgroundColor,
        backgroundImage: background.backgroundImage,
        inputHeight: parseFloat(username.height),
        inputRadius: parseFloat(username.borderTopLeftRadius),
        buttonHeight: parseFloat(button.height),
        buttonRadius: parseFloat(button.borderTopLeftRadius),
        cardBackground: card.backgroundColor,
        cardBorder: parseFloat(card.borderTopWidth),
        introTop: intro.top,
        lastControlTop: terms.top,
        viewportHeight: window.innerHeight,
      };
    });

    expect(visual.screenBackground).toBe('rgb(3, 9, 11)');
    expect(visual.backgroundImage).toContain('assets/hero/auth.jpg');
    expect(visual.inputHeight).toBeGreaterThanOrEqual(43);
    expect(visual.inputHeight).toBeLessThanOrEqual(47);
    expect(visual.inputRadius).toBeGreaterThanOrEqual(6);
    expect(visual.inputRadius).toBeLessThanOrEqual(9);
    expect(visual.buttonHeight).toBeGreaterThanOrEqual(45);
    expect(visual.buttonHeight).toBeLessThanOrEqual(48);
    expect(visual.buttonRadius).toBeGreaterThanOrEqual(7);
    expect(visual.buttonRadius).toBeLessThanOrEqual(9);
    expect(visual.cardBackground).toBe('rgba(0, 0, 0, 0)');
    expect(visual.cardBorder).toBe(0);
    expect(visual.introTop).toBeGreaterThan(160);
    expect(visual.introTop).toBeLessThan(330);
    expect(visual.lastControlTop).toBeLessThan(visual.viewportHeight);
    expect(visual.lastControlTop).toBeGreaterThan(visual.introTop);

    await page.screenshot({
      path: testInfo.outputPath(`iphone-17-pro-max-login-${scheme}-baseline.png`),
      fullPage: true,
    });

    await page.locator('#createAccountLink').click();
    await expect(page.locator('#signupForm')).toBeVisible();
    await expect(page.locator('#authLoginExtras')).toBeHidden();
    await expect(page.locator('#authTitle')).toHaveText('Create your account');
    await page.locator('.auth-back-login').first().click();
    await expect(page.locator('#loginForm')).toBeVisible();
  }
});

test('ride join baseline matches the approved compact-card hierarchy in day and night', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Ride baseline screenshots target iPhone 17 Pro Max geometry.');

  await mockAuthenticatedApi(page, 'stationary');

  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '59px'));
    await expect(page.locator('#app')).toBeVisible();
    await openTab(page, 'ride');
    await expect(page.locator('#rideJoinState')).toBeVisible();
    await page.locator('[data-screen="ride"]').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await expect(page.locator('#rideTitle')).toBeVisible();
    await expect(page.locator('.ride-hero')).toBeVisible();
    await expect(page.locator('#joinRideForm')).toBeVisible();
    await expect(page.locator('#createRideBtn')).toBeVisible();
    // Join stays unavailable until all six characters are in.
    await expect(page.locator('.ride-join-button')).toBeDisabled();
    await assertNoViewportOverflow(page);

    const visual = await page.evaluate(() => {
      const screen = document.querySelector('[data-screen="ride"]');
      const header = screen.querySelector('.page-header');
      const title = screen.querySelector('#rideTitle');
      const heroElement = screen.querySelector('.ride-hero');
      const join = screen.querySelector('.ride-entry');
      const rail = screen.querySelector('.ride-code-slots');
      const slot = screen.querySelector('.ride-code-slots span');
      const button = screen.querySelector('.ride-join-button');
      // Join and Start are matching cards; the hero is a compact intro.
      const start = screen.querySelector('.ride-start-card');
      const startButton = screen.querySelector('#createRideBtn');
      const box = (element) => element.getBoundingClientRect();
      const hero = getComputedStyle(heroElement);
      return {
        screenTop: box(screen).top,
        headerTop: box(header).top,
        headerHeight: box(header).height,
        titleTop: box(title).top,
        titleBottom: box(title).bottom,
        titleWidth: box(title).width,
        heroTop: box(heroElement).top,
        heroLeft: box(heroElement).left,
        heroWidth: box(heroElement).width,
        heroHeight: box(heroElement).height,
        heroRadius: parseFloat(hero.borderTopLeftRadius),
        joinTop: box(join).top,
        joinRadius: parseFloat(getComputedStyle(join).borderTopLeftRadius),
        railHeight: box(rail).height,
        railRadius: parseFloat(getComputedStyle(rail).borderTopLeftRadius),
        railGap: parseFloat(getComputedStyle(rail).gap) || 0,
        slotHeight: box(slot).height,
        slotRadius: parseFloat(getComputedStyle(slot).borderTopLeftRadius),
        buttonHeight: box(button).height,
        startHeight: box(start).height,
        startButtonHeight: box(startButton).height,
        startRadius: parseFloat(getComputedStyle(start).borderTopLeftRadius),
        startBottom: box(start).bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });

    expect(visual.headerTop).toBeGreaterThanOrEqual(visual.screenTop + 70);
    expect(visual.headerHeight).toBeGreaterThan(24);
    expect(visual.titleWidth).toBeGreaterThan(40);
    expect(visual.heroTop).toBeGreaterThan(visual.titleBottom);
    expect(visual.heroLeft).toBeGreaterThanOrEqual(18);
    expect(visual.heroWidth).toBeLessThanOrEqual(visual.viewportWidth - 36);
    expect(visual.heroHeight).toBeGreaterThanOrEqual(130);
    expect(visual.heroHeight).toBeLessThanOrEqual(215);
    expect(visual.heroRadius).toBeLessThanOrEqual(4);
    expect(visual.joinTop - (visual.heroTop + visual.heroHeight)).toBeGreaterThanOrEqual(8);
    expect(visual.joinTop - (visual.heroTop + visual.heroHeight)).toBeLessThanOrEqual(14);
    expect(visual.joinRadius).toBeLessThanOrEqual(4);
    expect(visual.railHeight).toBeLessThanOrEqual(40);
    expect(visual.railRadius).toBeLessThanOrEqual(4);
    expect(visual.railGap).toBe(0);
    expect(visual.slotHeight).toBeLessThanOrEqual(40);
    expect(visual.slotRadius).toBe(0);
    expect(visual.buttonHeight).toBeLessThanOrEqual(44);
    expect(visual.startHeight).toBeLessThanOrEqual(170);
    expect(visual.startButtonHeight).toBeGreaterThanOrEqual(44);
    expect(visual.startRadius).toBeLessThanOrEqual(4);
    expect(visual.startBottom).toBeLessThanOrEqual(visual.viewportHeight + 2);

    await page.screenshot({
      path: testInfo.outputPath(`iphone-17-pro-max-ride-${scheme}-baseline.png`),
      fullPage: true,
    });
  }
});

test('Rider Comms follows device day/night appearance with branded palettes', async ({ page }) => {
  await mockAuthenticatedApi(page);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  const night = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      background: root.getPropertyValue('--bg').trim().toLowerCase(),
      surface: root.getPropertyValue('--surface').trim().toLowerCase(),
      text: root.getPropertyValue('--text').trim().toLowerCase(),
    };
  });
  expect(night).toEqual({ background: '#080d10', surface: '#11171b', text: '#f3f6f7' });

  await page.emulateMedia({ colorScheme: 'light' });
  const day = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      background: root.getPropertyValue('--bg').trim().toLowerCase(),
      surface: root.getPropertyValue('--surface').trim().toLowerCase(),
      text: root.getPropertyValue('--text').trim().toLowerCase(),
    };
  });
  expect(day.background).toBe('#e9eef0');
  expect(day.surface).toBe('#f7f9fa');
  expect(day.text).toBe('#0b1216');
});

test('core PWA screens render without runtime errors or viewport overflow', async ({ page }, testInfo) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', (message) => {
    const sourceUrl = message.location().url;
    if (message.type() === 'error' && sourceUrl.startsWith('http://127.0.0.1:4173')) {
      runtimeErrors.push(`console (${sourceUrl}): ${message.text()}`);
    }
  });
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();

  const screens = [
    ['map', '#mapCanvas'],
    ['ride', '#rideJoinState'],
    ['routes', '#curatedRouteList'],
    ['friends', '#friendList'],
    ['settings', '.settings-page'],
  ];

  for (const [screen, readySelector] of screens) {
    if (screen === 'routes' || screen === 'settings') await openFromMenu(page, screen);
    else await openTab(page, screen);
    await expect(page.locator(readySelector)).toBeVisible();
    await assertNoViewportOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`${testInfo.project.name}-${screen}.png`),
      fullPage: true,
    });
  }

  await openTab(page, 'map');
  await page.locator('#mapSearchSlot').click();
  await expect(page.locator('#searchScreen')).toBeVisible();
  await assertNoViewportOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-search.png`),
    fullPage: true,
  });

  expect(runtimeErrors).toEqual([]);
});

test('map keeps Google Roadmap language with rider-first overlays on iPhone 17 Pro Max', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Final mockup screenshots target iPhone 17 Pro Max geometry.');

  await mockAuthenticatedApi(page, 'stationary', ({ url }) => {
    if (url.pathname === '/friends/activity') {
      return {
        body: {
          activity: [
            { riderId: 'rider_friend01', online: true, lastSeenAt: Date.now() },
            { riderId: 'rider_friend02', online: false, lastSeenAt: Date.now() - (2 * 60 * 60 * 1000) },
          ],
        },
      };
    }
    return null;
  });
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  // The app shows before the map is created; read its options once it is.
  await page.waitForFunction(() => Boolean(window.__riderCommsTestMap?.options));

  const mapGeometry = await page.evaluate(() => {
    const screen = document.querySelector('[data-screen="map"]');
    const canvas = document.querySelector('#mapCanvas');
    const search = document.querySelector('#mapSearchSlot');
    const action = document.querySelector('.map-actions .icon-button');
    const report = document.querySelector('#reportHazardBtn');
    const locate = document.querySelector('#locateBtn');
    const nearby = document.querySelector('#joinNearbyBtn');
    const avatarButton = document.querySelector('#mapAvatarButton');
    const drawer = document.querySelector('#mapDrawer');
    const screenBox = screen?.getBoundingClientRect();
    const canvasBox = canvas?.getBoundingClientRect();
    return {
      screenTop: screenBox?.top ?? null,
      canvasTop: canvasBox?.top ?? null,
      canvasLeft: canvasBox?.left ?? null,
      canvasRight: canvasBox?.right ?? null,
      viewportWidth: document.documentElement.clientWidth,
      searchRadius: search ? parseFloat(getComputedStyle(search).borderTopLeftRadius) : NaN,
      actionRadius: action ? getComputedStyle(action).borderTopLeftRadius : null,
      reportWidth: report?.getBoundingClientRect().width ?? NaN,
      locateWidth: locate?.getBoundingClientRect().width ?? NaN,
      nearbyWidth: nearby?.getBoundingClientRect().width ?? NaN,
      reportTransform: report ? getComputedStyle(report).transform : null,
      locateTransform: locate ? getComputedStyle(locate).transform : null,
      barTopDelta: report && nearby ? nearby.getBoundingClientRect().top - report.getBoundingClientRect().top : NaN,
      locateAboveBar: report && locate ? report.getBoundingClientRect().top - locate.getBoundingClientRect().bottom : NaN,
      avatarDisplay: avatarButton ? getComputedStyle(avatarButton).display : null,
      drawerTop: drawer?.getBoundingClientRect().top ?? NaN,
      searchInDrawer: Boolean(search?.closest('#mapDrawer')),
      reportBottom: report?.getBoundingClientRect().bottom ?? NaN,
      mapTypeId: window.__riderCommsTestMap?.options?.mapTypeId ?? null,
      keyboardShortcuts: window.__riderCommsTestMap?.options?.keyboardShortcuts ?? null,
      mapColorScheme: window.__riderCommsTestMap?.options?.colorScheme ?? null,
      mapRenderingType: window.__riderCommsTestMap?.options?.renderingType ?? null,
      tiltInteractionEnabled: window.__riderCommsTestMap?.options?.tiltInteractionEnabled ?? null,
      headingInteractionEnabled: window.__riderCommsTestMap?.options?.headingInteractionEnabled ?? null,
      fractionalZoomEnabled: window.__riderCommsTestMap?.options?.isFractionalZoomEnabled ?? null,
      mapStyles: window.__riderCommsTestMap?.options?.styles ?? [],
    };
  });
  expectNear(mapGeometry.canvasTop, mapGeometry.screenTop);
  expectNear(mapGeometry.canvasLeft, 0);
  expectNear(mapGeometry.canvasRight, mapGeometry.viewportWidth);
  expect(mapGeometry.searchRadius).toBeGreaterThanOrEqual(20);
  expect(mapGeometry.searchRadius).toBeLessThanOrEqual(26);
  // One set of map controls: rounded squares of one compact size. Hazard
  // and the icon-only Go live share the bottom bar; Locate sits above it on
  // the right.
  expect(mapGeometry.actionRadius).toBe('14px');
  expect(mapGeometry.reportWidth).toBe(52);
  expect(mapGeometry.locateWidth).toBe(52);
  expect(mapGeometry.nearbyWidth).toBe(52);
  expect(mapGeometry.reportTransform).toBe('none');
  expect(mapGeometry.locateTransform).toBe('none');
  expectNear(mapGeometry.barTopDelta, 0);
  expect(mapGeometry.locateAboveBar).toBeGreaterThanOrEqual(8);
  // The avatar beside search opens the menu.
  expect(mapGeometry.avatarDisplay).toBe('grid');
  // Search lives in the drawer at the bottom, and the map's
  // floating controls rest above it.
  expect(mapGeometry.searchInDrawer).toBe(true);
  expect(mapGeometry.reportBottom).toBeLessThanOrEqual(mapGeometry.drawerTop);
  expect(mapGeometry.mapTypeId).toBe('roadmap');
  expect(mapGeometry.keyboardShortcuts).toBe(false);
  // Follows the phone, except from sunset to sunrise when it is always dark.
  expect(['FOLLOW_SYSTEM', 'DARK']).toContain(mapGeometry.mapColorScheme);
  expect(mapGeometry.mapRenderingType).toBe('VECTOR');
  expect(mapGeometry.tiltInteractionEnabled).toBe(true);
  expect(mapGeometry.headingInteractionEnabled).toBe(true);
  expect(mapGeometry.fractionalZoomEnabled).toBe(true);
  expect(mapGeometry.mapStyles).toEqual([]);
  await expect(page.locator('[data-screen="map"] .page-header')).toHaveCount(0);
  await expect(page.locator('#mapSearchSlot')).toBeVisible();
  await expect(page.locator('#movementSafetyBanner')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-map-final.png'), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-map-dark-final.png'), fullPage: true });

  await page.emulateMedia({ colorScheme: 'light' });
  // Map action buttons animate their background for 140 ms. Wait for the
  // settled provider-light chrome rather than capturing the first transition
  // frame and accidentally blessing a dark control in the light screenshot.
  // Report stays hazard amber in both themes; Locate follows the light chrome.
  await expect.poll(() => page.locator('#reportHazardBtn').evaluate((button) => getComputedStyle(button).backgroundColor))
    .toMatch(/245, 165, 36/);
  await expect.poll(() => page.locator('#locateBtn').evaluate((button) => getComputedStyle(button).backgroundColor))
    .toMatch(/255, 255, 255/);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-map-light-final.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });

  await page.locator('#reportHazardBtn').click();
  await expect(page.locator('#sheetBackdrop')).toBeVisible();
  await expect(page.locator('#sheetTitle')).toHaveText('Report on the road');
  await expect(page.locator('.hazard-type-tile')).toHaveCount(6);
  await expect(page.locator('.sheet')).toBeFocused();
  const reportShape = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet');
    const tile = document.querySelector('.hazard-type-tile');
    return {
      sheetRadius: sheet ? parseFloat(getComputedStyle(sheet).borderTopLeftRadius) : NaN,
      tileRadius: tile ? parseFloat(getComputedStyle(tile).borderTopLeftRadius) : NaN,
    };
  });
  expect(reportShape.sheetRadius).toBeLessThanOrEqual(8);
  expect(reportShape.tileRadius).toBeLessThanOrEqual(4);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-report-final.png'), fullPage: true });
  await page.locator('#closeSheet').click();

  await openTab(page, 'ride');
  await expect(page.locator('.ride-hero')).toBeVisible();
  await page.locator('[data-screen="ride"]').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  await expect(page.locator('#rideTitle')).toBeVisible();
  const rideGeometry = await page.evaluate(() => {
    const title = document.querySelector('#rideTitle');
    const hero = document.querySelector('#rideJoinState .ride-hero');
    const joinCard = document.querySelector('#rideJoinState .ride-entry');
    const box = (element) => element?.getBoundingClientRect();
    return {
      title: box(title),
      hero: box(hero),
      joinCard: box(joinCard),
      heroRadius: hero ? parseFloat(getComputedStyle(hero).borderTopLeftRadius) : NaN,
      viewportWidth: window.innerWidth,
    };
  });
  expect(rideGeometry.heroRadius).toBeLessThanOrEqual(4);
  expect(rideGeometry.hero.height).toBeGreaterThanOrEqual(130);
  expect(rideGeometry.hero.height).toBeLessThanOrEqual(215);
  expect(rideGeometry.hero.width).toBeLessThan(rideGeometry.viewportWidth - 30);
  expect(rideGeometry.hero.top).toBeGreaterThan(rideGeometry.title.bottom);
  expect(Math.abs(rideGeometry.joinCard.width - rideGeometry.hero.width)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-ride-final.png'), fullPage: true });

  await openFromMenu(page, 'routes');
  const finalRouteCard = page.locator('.curated-route-card').first();
  await expect(finalRouteCard).toBeVisible();
  await expect(finalRouteCard.locator('.route-trace-card')).toBeHidden();
  const finalRouteBox = await finalRouteCard.boundingBox();
  expect(finalRouteBox).not.toBeNull();
  expect(finalRouteBox.width / finalRouteBox.height).toBeGreaterThan(2);
  await expect(finalRouteCard.locator('.route-quick-stats svg')).toHaveCount(3);
  const routeCardGeometry = await finalRouteCard.evaluate((card) => {
    const image = card.querySelector('img');
    const stats = card.querySelector('.route-quick-stats');
    const box = (element) => element?.getBoundingClientRect();
    return {
      cardHeight: box(card)?.height ?? NaN,
      imageHeight: box(image)?.height ?? NaN,
      statsHeight: box(stats)?.height ?? NaN,
    };
  });
  expect(routeCardGeometry.cardHeight).toBeGreaterThanOrEqual(136);
  expect(routeCardGeometry.cardHeight).toBeLessThanOrEqual(140);
  expect(routeCardGeometry.imageHeight).toBeGreaterThanOrEqual(76);
  expect(routeCardGeometry.imageHeight).toBeLessThanOrEqual(80);
  expect(routeCardGeometry.statsHeight).toBeLessThanOrEqual(18);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-routes-final.png'), fullPage: true });

  await openTab(page, 'friends');
  await expect(page.locator('#friendList [data-friend]').first()).toBeVisible();
  const friendsGeometry = await page.evaluate(() => {
    const search = document.querySelector('[data-screen="friends"] .search-row');
    const row = document.querySelector('#friendList [data-friend]');
    const avatar = row?.querySelector('.avatar');
    const presence = row?.querySelector('.friend-presence-dot');
    const groupLabel = document.querySelector('#friendList .friend-group-label');
    const labelStyle = groupLabel ? getComputedStyle(groupLabel) : null;
    const box = (element) => element?.getBoundingClientRect();
    const avatarBox = box(avatar);
    const presenceBox = box(presence);
    return {
      searchHeight: box(search)?.height ?? NaN,
      rowHeight: box(row)?.height ?? NaN,
      avatarWidth: avatarBox?.width ?? NaN,
      presenceWidth: presenceBox?.width ?? NaN,
      presenceOverlap: avatarBox && presenceBox ? avatarBox.right - presenceBox.left : NaN,
      presenceBottomDelta: avatarBox && presenceBox ? Math.abs(avatarBox.bottom - presenceBox.bottom) : NaN,
      groupLabelTransform: labelStyle?.textTransform ?? null,
      groupLabelFontSize: labelStyle ? parseFloat(labelStyle.fontSize) : NaN,
      groupLabelText: groupLabel?.textContent?.trim() ?? null,
      groupLabelTag: groupLabel?.tagName ?? null,
    };
  });
  expect(friendsGeometry.searchHeight).toBeLessThanOrEqual(44);
  expect(friendsGeometry.rowHeight).toBeLessThanOrEqual(58);
  expect(friendsGeometry.avatarWidth).toBeGreaterThanOrEqual(39);
  expect(friendsGeometry.avatarWidth).toBeLessThanOrEqual(41);
  expect(friendsGeometry.presenceWidth).toBeGreaterThanOrEqual(9);
  expect(friendsGeometry.presenceWidth).toBeLessThanOrEqual(10);
  expect(friendsGeometry.presenceOverlap).toBeGreaterThanOrEqual(6);
  expect(friendsGeometry.presenceOverlap).toBeLessThanOrEqual(10);
  expect(friendsGeometry.presenceBottomDelta).toBeLessThanOrEqual(2);
  expect(friendsGeometry.groupLabelTransform).toBe('none');
  expect(friendsGeometry.groupLabelFontSize).toBeGreaterThanOrEqual(11);
  expect(friendsGeometry.groupLabelText).toBe('Online (1)');
  expect(friendsGeometry.groupLabelTag).toBe('H2');
  await expect(page.locator('#friendList .friend-group-label')).toHaveText(['Online (1)', 'Offline (1)']);
  await expect(page.locator('[data-friend="rider_friend01"] .friend-activity')).toHaveText('Online now');
  await expect(page.locator('[data-friend="rider_friend02"] .friend-activity')).toContainText('Last seen 2h ago');
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-friends-final.png'), fullPage: true });

  await page.locator('#friendList [data-friend]').first().click();
  await expect(page.locator('#sheetBackdrop')).toBeVisible();
  await expect(page.locator('.friend-profile-card')).toBeVisible();
  await expect(page.locator('#shareFriendId')).toHaveCount(0);
  await expect(page.locator('#shareFriendLocation')).toContainText('Share my location');
  await expect(page.locator('#shareFriendLocation')).toBeDisabled();
  await expect(page.locator('#friendMapAction')).toContainText('Map');
  await expect(page.locator('#friendMapAction')).toBeDisabled();
  await expect(page.locator('#friendSafetyActions')).toContainText('More');
  await expect(page.locator('.friend-profile-actions button')).toHaveCount(4);
  await expect(page.locator('.friend-profile-detail-list > div')).toHaveCount(3);
  await expect(page.locator('.friend-profile-cover')).toHaveCount(0);
  await expect(page.locator('.friend-profile-stats')).toHaveCount(0);
  await expect(page.locator('.friend-profile-copy')).toContainText('Online now');
  await expect(page.locator('.friend-profile-view-map')).toHaveCount(0);
  const friendDetailGeometry = await page.evaluate(() => {
    const card = document.querySelector('.friend-profile-card');
    const avatar = document.querySelector('.friend-profile-avatar .avatar');
    const actions = [...document.querySelectorAll('.friend-profile-actions button')];
    const detailList = document.querySelector('.friend-profile-detail-list');
    const detailRows = [...document.querySelectorAll('.friend-profile-detail-list > div')];
    const close = document.querySelector('#closeSheet');
    const title = document.querySelector('#sheetTitle');
    const box = (element) => element?.getBoundingClientRect();
    return {
      cardBorderWidth: card ? parseFloat(getComputedStyle(card).borderTopWidth) : NaN,
      cardBackground: card ? getComputedStyle(card).backgroundColor : null,
      avatarWidth: box(avatar)?.width ?? NaN,
      actionWidths: actions.map((action) => box(action)?.width ?? NaN),
      actionHeights: actions.map((action) => box(action)?.height ?? NaN),
      detailRadius: detailList ? parseFloat(getComputedStyle(detailList).borderTopLeftRadius) : NaN,
      detailHeights: detailRows.map((row) => box(row)?.height ?? NaN),
      closeWidth: box(close)?.width ?? NaN,
      closeRadius: close ? getComputedStyle(close).borderTopLeftRadius : null,
      titleWidth: box(title)?.width ?? NaN,
    };
  });
  expect(friendDetailGeometry.cardBorderWidth).toBe(0);
  expect(friendDetailGeometry.cardBackground).toBe('rgba(0, 0, 0, 0)');
  expect(friendDetailGeometry.avatarWidth).toBeGreaterThanOrEqual(52);
  expect(friendDetailGeometry.avatarWidth).toBeLessThanOrEqual(56);
  expect(friendDetailGeometry.actionWidths).toHaveLength(4);
  for (const width of friendDetailGeometry.actionWidths.slice(1)) expectNear(width, friendDetailGeometry.actionWidths[0], 1);
  for (const height of friendDetailGeometry.actionHeights) {
    expect(height).toBeGreaterThanOrEqual(62);
    expect(height).toBeLessThanOrEqual(66);
  }
  for (const height of friendDetailGeometry.detailHeights) {
    expect(height).toBeGreaterThanOrEqual(48);
    expect(height).toBeLessThanOrEqual(52);
  }
  expect(friendDetailGeometry.detailRadius).toBeGreaterThanOrEqual(10);
  expect(friendDetailGeometry.detailRadius).toBeLessThanOrEqual(14);
  expect(friendDetailGeometry.closeWidth).toBe(38);
  expect(friendDetailGeometry.closeRadius).toBe('50%');
  expect(friendDetailGeometry.titleWidth).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-friend-detail-final.png'), fullPage: true });
  await page.locator('#friendSafetyActions').click();
  await expect(page.locator('#sheetTitle')).toHaveText('More actions');
  await expect(page.locator('.friend-more-card')).toContainText('Maya');
  await expect(page.locator('#shareFriendIdMore')).toContainText('Share Rider ID');
  await expect(page.locator('#removeFriendBtn')).toContainText('Remove friend');
  await expect(page.locator('#reportFriendBtn')).toContainText('Report rider');
  await expect(page.locator('#blockFriendBtn')).toContainText('Block rider');
  await expect(page.locator('.friend-more-menu > button')).toHaveCount(4);
  await expect(page.locator('[data-report-rider]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-friend-more-final.png'), fullPage: true });
  await page.locator('#reportFriendBtn').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Report rider');
  await expect(page.locator('[data-report-rider]')).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-friend-report-final.png'), fullPage: true });
  await page.locator('#closeSheet').click();

  await page.locator('#friendList [data-friend]').first().click();
  await expect(page.locator('#messageFriend')).toBeVisible();
  await page.locator('#messageFriend').click();
  await expect(page.locator('#chatScreen')).toBeVisible();
  const dmGeometry = await page.evaluate(() => {
    const header = document.querySelector('.chat-header');
    const avatar = document.querySelector('#chatAvatar');
    const plan = document.querySelector('#chatHideoutPlan');
    const safety = document.querySelector('#chatSafety');
    const composer = document.querySelector('#chatComposer');
    const input = document.querySelector('#chatInput');
    const send = document.querySelector('#chatSend');
    const box = (element) => element?.getBoundingClientRect();
    return {
      headerHeight: box(header)?.height ?? NaN,
      avatarWidth: box(avatar)?.width ?? NaN,
      planWidth: box(plan)?.width ?? NaN,
      safetyWidth: box(safety)?.width ?? NaN,
      inputHeight: box(input)?.height ?? NaN,
      inputRadius: input ? parseFloat(getComputedStyle(input).borderTopLeftRadius) : NaN,
      sendWidth: box(send)?.width ?? NaN,
      sendRadius: send ? parseFloat(getComputedStyle(send).borderTopLeftRadius) : NaN,
      composerHeight: box(composer)?.height ?? NaN,
    };
  });
  expect(dmGeometry.headerHeight).toBeLessThanOrEqual(120);
  expect(dmGeometry.avatarWidth).toBeGreaterThanOrEqual(34);
  expect(dmGeometry.avatarWidth).toBeLessThanOrEqual(38);
  expect(dmGeometry.planWidth).toBe(40);
  expect(dmGeometry.safetyWidth).toBe(40);
  expect(dmGeometry.inputHeight).toBeGreaterThanOrEqual(44);
  expect(dmGeometry.inputRadius).toBeLessThanOrEqual(8);
  expect(dmGeometry.sendWidth).toBe(44);
  expect(dmGeometry.sendRadius).toBeLessThanOrEqual(8);
  expect(dmGeometry.composerHeight).toBeLessThanOrEqual(82);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-dm-final.png'), fullPage: true });
  await page.locator('#chatBack').click();
  await expect(page.locator('#chatScreen')).toBeHidden();

  await openFromMenu(page, 'settings');
  await expect(page.locator('.settings-page')).toBeVisible();
  await expect(page.locator('[data-screen="settings"] .page-subtitle')).toHaveCount(0);
  // Full-width groups of rows on a phone.
  const settingsGroup = await page.locator('#settingsList .settings-rows').first().evaluate((element) => ({
    radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
    width: element.getBoundingClientRect().width,
  }));
  expect(settingsGroup.radius).toBe(0);
  expectNear(settingsGroup.width, page.viewportSize().width, 1);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-settings-final.png'), fullPage: true });
  await assertNoViewportOverflow(page);
});

test('PWA screens have no automatically detectable accessibility violations', async ({ page }, testInfo) => {
  test.skip(!AXE_PROJECTS.has(testInfo.project.name), 'Audited once per colour scheme');
  await page.goto('/');
  await expect(page.locator('#authScreen')).toBeVisible();
  await expectNoAxeViolations(page, 'login');

  await mockAuthenticatedApi(page);
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  for (const [screen, readySelector] of [
    ['map', '#mapCanvas'],
    ['ride', '#rideJoinState'],
    ['routes', '#curatedRouteList'],
    ['friends', '#friendList'],
    ['settings', '.settings-page'],
  ]) {
    if (screen === 'routes' || screen === 'settings') await openFromMenu(page, screen);
    else await openTab(page, screen);
    await expect(page.locator(readySelector)).toBeVisible();
    await expectNoAxeViolations(page, screen);
  }
  await openSettingsPage(page, 'devices');
  await expect(page.locator('[data-settings-section="sessions"]')).toBeVisible();
  await expectNoAxeViolations(page, 'settings-devices-page');
  await page.locator('#closeSheetAll').click();
  await openOwnProfile(page, { edit: true });
  await expect(page.locator('[data-settings-section="profile"]')).toBeVisible();
  await expectNoAxeViolations(page, 'edit-profile-page');
  await page.locator('#closeSheet').click();
  await expectNoAxeViolations(page, 'profile-page');
  await page.locator('#closeSheet').click();
  await openTab(page, 'map');
  await page.locator('#mapAvatarButton').click();
  await expect(page.locator('#appMenu')).toBeVisible();
  await expectNoAxeViolations(page, 'menu');
  await page.locator('#closeAppMenu').click();
  await page.locator('#mapSearchSlot').click();
  await expect(page.locator('#searchScreen')).toBeVisible();
  await expectNoAxeViolations(page, 'search');
});

test('Public legal and support pages have no automatically detectable accessibility violations', async ({ page }, testInfo) => {
  test.skip(!AXE_PROJECTS.has(testInfo.project.name), 'Audited once per colour scheme');
  for (const path of ['/privacy.html', '/terms.html', '/guidelines.html', '/support.html']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    await expectNoAxeViolations(page, path);
  }
});

test('PWA sign-in column is centred on desktop browsers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const box = await page.locator('.auth-screen').boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
  await expect(page.locator('#loginUsername')).toBeInViewport();
});
