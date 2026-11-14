// The installed (Home Screen) app: canvas, safe areas and viewport geometry.
import { expect, test } from '@playwright/test';
import { AXE_PROJECTS, expectNoAxeViolations } from './axe.js';
import { mockAuthenticatedApi, assertNoViewportOverflow, waitForViewportSettled, installStandaloneFixture, setSyntheticSafeArea, standaloneGeometry, openTab, openSettingsPage, openFromMenu, openOwnProfile, expectNear } from './helpers.js';

test('PWA utility viewport paints safe areas as one edge-to-edge canvas', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');

  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportMeta).toContain('viewport-fit=cover');

  await openFromMenu(page, 'settings');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-top', '59px');
    document.documentElement.style.setProperty('--safe-left', '47px');
    document.documentElement.style.setProperty('--safe-right', '47px');
  });

  const viewport = await page.locator('[data-screen="settings"]').evaluate((screen) => {
    const screenStyle = getComputedStyle(screen);
    return {
      screenBackground: screenStyle.backgroundImage,
      // Nothing is painted over the top edge: the page runs under the
      // status bar (iOS 26's own blur there can't be switched off by a page).
      statusBarCover: document.querySelectorAll('.status-bar-backdrop').length,
      // ...but in the installed iOS app the map's avatar + search row is
      // moved down clear of that blur (Playwright can't emulate standalone,
      // so check the rule).
      edgeBlurRule: [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules].map((rule) => rule.cssText); } catch { return []; } }).find((text) => text.includes('display-mode: standalone') && text.includes('--edge-blur-clearance')) || '',
      paddingTop: screenStyle.paddingTop,
      paddingLeft: screenStyle.paddingLeft,
    };
  });

  expect(viewport.screenBackground).toBe('none');
  expect(viewport.statusBarCover).toBe(0);
  expect(viewport.edgeBlurRule).toContain('.map-header');
  expect(viewport.edgeBlurRule).toContain('orientation: portrait');
  expect(parseFloat(viewport.paddingTop)).toBeGreaterThan(59);
  expect(parseFloat(viewport.paddingLeft)).toBeGreaterThanOrEqual(47);
  await assertNoViewportOverflow(page);
});

test('installed PWA asks for a portrait lock where the browser allows one; a tab doesn’t', async ({ page }) => {
  const stubLock = () => {
    window.lockCalls = [];
    const lock = (value) => { window.lockCalls.push(value); return Promise.reject(new Error('not supported here')); };
    // On the prototype where there is one; a browser build without the
    // Screen Orientation API gets a minimal one, so the test checks the
    // app's own decision (installed or not), not the engine's API surface.
    if (window.ScreenOrientation?.prototype) {
      Object.defineProperty(window.ScreenOrientation.prototype, 'lock', { configurable: true, writable: true, value: lock });
    } else {
      Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { type: 'portrait-primary', angle: 0, lock, addEventListener() {}, removeEventListener() {} } });
    }
  };
  await mockAuthenticatedApi(page);
  await page.addInitScript(stubLock);
  await page.goto('/');
  await expect(page.locator('#mapDrawer')).toBeVisible();
  expect(await page.evaluate(() => window.lockCalls)).toEqual([]);

  // Installed: locked at start and again on returning from the background,
  // and a refusal (iOS, multitasking) leaves the app working.
  await installStandaloneFixture(page);
  await page.goto('/');
  await expect(page.locator('#mapDrawer')).toBeVisible();
  expect(await page.evaluate(() => window.lockCalls)).toEqual(['portrait-primary']);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // The resume handler can queue the second orientation request on WebKit's
  // event loop. Poll for the exact calls instead of inspecting synchronously
  // in the same task as the synthetic visibilitychange dispatch.
  await expect.poll(() => page.evaluate(() => window.lockCalls)).toEqual(
    ['portrait-primary', 'portrait-primary'],
  );
  await expect(page.locator('#mapDrawer')).toBeVisible();
});

test('installed PWA cold start uses the full Home Screen canvas before any rotation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    // Reproduce the important part of the real-device failure: WebKit/JS can
    // initially report a layout height roughly one browser-toolbar shorter
    // than the actual standalone window. The app shell must not inherit it.
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      get: () => Math.max(1, (document.documentElement?.clientHeight ?? 844) - 118),
    });
  });
  await mockAuthenticatedApi(page);
  await page.goto('/#map');
  await waitForViewportSettled(page);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--bottom-safe-area', '34px');
  });
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/pwa-standalone/);

  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const app = document.querySelector('#app');
    const appBox = app.getBoundingClientRect();
    const mapBox = document.querySelector('#mapCanvas').getBoundingClientRect();
    return {
      appVh: root.style.getPropertyValue('--app-vh'),
      clientHeight: root.clientHeight,
      innerHeight: window.innerHeight,
      appPosition: getComputedStyle(app).position,
      appBottom: appBox.bottom,
      mapBottom: mapBox.bottom,
    };
  });

  expect(metrics.appVh).toBe('100vh');
  expect(metrics.innerHeight).toBeLessThan(metrics.clientHeight);
  expect(metrics.appPosition).toBe('fixed');
  expect(Math.abs(metrics.appBottom - metrics.clientHeight)).toBeLessThanOrEqual(1);
  // The map runs under the home indicator.
  expect(Math.abs(metrics.mapBottom - metrics.clientHeight)).toBeLessThanOrEqual(1);
});

test('installed PWA map controls stay above the home indicator', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
  await mockAuthenticatedApi(page);
  await page.goto('/#map');
  await waitForViewportSettled(page);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--bottom-safe-area', '34px');
  });

  const chrome = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      navSafeBottom: root.getPropertyValue('--nav-safe-bottom').trim(),
      bottomControlInset: root.getPropertyValue('--bottom-control-inset').trim(),
      navigationControlInset: root.getPropertyValue('--navigation-control-inset').trim(),
    };
  });
  expect(chrome.navSafeBottom).toBe('34px');
  expect(chrome.bottomControlInset).toBe('34px');
  expect(chrome.navigationControlInset).toBe('min(18px,34px)');

  // No tab bar: the hazard button is the lowest control, and it stays
  // entirely above the 34px home-indicator area.
  await expect(page.locator('.bottom-nav')).toHaveCount(0);
  const viewport = page.viewportSize();
  const hazard = await page.locator('#reportHazardBtn').boundingBox();
  expect(hazard).not.toBeNull();
  expect(viewport.height - (hazard.y + hazard.height)).toBeGreaterThanOrEqual(34);
});

test('PWA navigation summary extends through the installed iPhone bottom safe area', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    // Model an installed WebKit launch with an innerHeight measurement that
    // excludes the gesture area. CSS viewport geometry must remain authoritative.
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      get: () => document.documentElement.clientHeight - 34,
    });
  });
  await mockAuthenticatedApi(page);
  await page.goto('/#map');
  await waitForViewportSettled(page);
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.setProperty('--bottom-safe-area', '34px');
    document.querySelector('#app').classList.add('nav-mode');
    document.querySelector('#navSummary').hidden = false;
    document.querySelector('#navBanner').hidden = false;
    document.querySelector('#navSpeedBadge').hidden = false;
    document.querySelector('#navNextPreview').hidden = false;
    document.querySelector('#navDistanceNext').textContent = '0.5 mi';
    document.querySelector('#navInstruction').textContent = 'Sharp left';
    document.querySelector('#navInstruction').setAttribute('aria-label', 'Turn sharp left onto Holloway Road / A1');
    document.querySelector('#navProviderInstruction').textContent = 'Turn sharp left onto Holloway Road / A1';
    document.querySelector('#navNextInstruction').textContent = 'Keep right at the fork onto Seven Sisters Road / A503';
    const roadAhead = document.querySelector('#navRoadAhead');
    roadAhead.hidden = false;
    roadAhead.innerHTML = '<span class="nav-road-ahead-label">Reports ahead</span><span class="nav-road-ahead-events"><span class="nav-road-ahead-event" aria-label="Speed camera reported, 0.6 mi ahead"><svg style="--road-alert:#2fa8d3"><use href="#i-camera"/></svg><span>Speed camera</span><strong>0.6 mi</strong></span><span class="nav-road-ahead-event" aria-label="Road closure reported, 1.4 mi ahead"><svg style="--road-alert:#f0646b"><use href="#i-no-entry"/></svg><span>Road closure</span><strong>1.4 mi</strong></span></span>';
    document.querySelector('#navSpeed').textContent = '32';
    document.querySelector('#navSpeedUnit').textContent = 'mph';
    const banner = document.querySelector('#navBanner');
    document.querySelector('#app').style.setProperty('--nav-banner-height', `${Math.ceil(banner.getBoundingClientRect().height)}px`);
    const mainUse = document.querySelector('#navManeuverSvg use');
    const nextUse = document.querySelector('#navNextManeuverSvg use');
    mainUse?.setAttribute('href', '#i-nav-sharp-left');
    nextUse?.setAttribute('href', '#i-nav-fork-right');
  });

  const summary = page.locator('#navSummary');
  const banner = page.locator('#navBanner');
  const mute = page.locator('#navMuteBtn');
  const overview = page.locator('#navOverviewBtn');
  const [summaryBox, viewport] = await Promise.all([
    summary.boundingBox(),
    Promise.resolve(page.viewportSize()),
  ]);
  const metrics = await page.evaluate(() => {
    const summary = document.querySelector('#navSummary');
    const banner = document.querySelector('#navBanner');
    const actions = document.querySelector('.screen-map .map-actions');
    const report = document.querySelector('#navReportBtn');
    const locate = document.querySelector('#locateBtn');
    const mute = document.querySelector('#navMuteBtn');
    const overview = document.querySelector('#navOverviewBtn');
    const end = document.querySelector('#endNavBtn');
    const maneuver = document.querySelector('#navManeuverIcon');
    const maneuverSvg = document.querySelector('#navManeuverSvg');
    const maneuverUse = document.querySelector('#navManeuverSvg use');
    const nextPreview = document.querySelector('#navNextPreview');
    const nextSvg = document.querySelector('#navNextManeuverSvg');
    const nextUse = document.querySelector('#navNextManeuverSvg use');
    const roadAhead = document.querySelector('#navRoadAhead');
    const roadAheadEvents = [...document.querySelectorAll('.nav-road-ahead-event')];
    const speed = document.querySelector('#navSpeedBadge');
    const instruction = document.querySelector('#navInstruction');
    const providerInstruction = document.querySelector('#navProviderInstruction');
    const speedValue = document.querySelector('#navSpeed');
    const speedUnit = document.querySelector('#navSpeedUnit');
    const summaryStyle = getComputedStyle(summary);
    const bannerStyle = getComputedStyle(banner);
    const actionsStyle = getComputedStyle(actions);
    return {
      height: parseFloat(summaryStyle.height),
      paddingBottom: parseFloat(summaryStyle.paddingBottom),
      summaryRadius: parseFloat(summaryStyle.borderTopLeftRadius),
      bannerRadius: parseFloat(bannerStyle.borderTopLeftRadius),
      instructionText: instruction?.textContent ?? null,
      instructionAriaLabel: instruction?.getAttribute('aria-label') ?? null,
      providerInstruction: providerInstruction?.textContent ?? null,
      endRadius: end ? getComputedStyle(end).borderTopLeftRadius : null,
      dockDirection: actionsStyle.flexDirection,
      dockGap: parseFloat(actionsStyle.columnGap),
      dockPadding: parseFloat(actionsStyle.paddingTop),
      dockRadius: parseFloat(actionsStyle.borderTopLeftRadius),
      dockBottom: actions?.getBoundingClientRect().bottom ?? NaN,
      reportSize: report?.getBoundingClientRect().width ?? 0,
      locateDisplay: locate ? getComputedStyle(locate).display : null,
      muteSize: mute?.getBoundingClientRect().width ?? 0,
      overviewSize: overview?.getBoundingClientRect().width ?? 0,
      muteRadius: mute ? getComputedStyle(mute).borderTopLeftRadius : null,
      reportTop: report?.getBoundingClientRect().top ?? NaN,
      reportLeft: report?.getBoundingClientRect().left ?? NaN,
      reportRight: report?.getBoundingClientRect().right ?? NaN,
      reportBottom: report?.getBoundingClientRect().bottom ?? NaN,
      muteTop: mute?.getBoundingClientRect().top ?? NaN,
      muteLeft: mute?.getBoundingClientRect().left ?? NaN,
      muteRight: mute?.getBoundingClientRect().right ?? NaN,
      muteBottom: mute?.getBoundingClientRect().bottom ?? NaN,
      overviewTop: overview?.getBoundingClientRect().top ?? NaN,
      overviewLeft: overview?.getBoundingClientRect().left ?? NaN,
      overviewBottom: overview?.getBoundingClientRect().bottom ?? NaN,
      summaryTop: summary?.getBoundingClientRect().top ?? NaN,
      maneuverWidth: maneuver?.getBoundingClientRect().width ?? NaN,
      maneuverHeight: maneuver?.getBoundingClientRect().height ?? NaN,
      maneuverRadius: maneuver ? parseFloat(getComputedStyle(maneuver).borderTopLeftRadius) : NaN,
      maneuverBackground: maneuver ? getComputedStyle(maneuver).backgroundColor : null,
      maneuverBorderWidth: maneuver ? parseFloat(getComputedStyle(maneuver).borderTopWidth) : NaN,
      maneuverSvgWidth: maneuverSvg?.getBoundingClientRect().width ?? NaN,
      maneuverHref: maneuverUse?.getAttribute('href') ?? null,
      nextHeight: nextPreview?.getBoundingClientRect().height ?? NaN,
      nextSvgWidth: nextSvg?.getBoundingClientRect().width ?? NaN,
      nextHref: nextUse?.getAttribute('href') ?? null,
      roadAheadHeight: roadAhead?.getBoundingClientRect().height ?? NaN,
      roadAheadLabels: roadAheadEvents.map((event) => event.textContent?.replace(/\s+/g, ' ').trim()),
      roadAheadEventCount: roadAheadEvents.length,
      speedWidth: speed?.getBoundingClientRect().width ?? NaN,
      speedHeight: speed?.getBoundingClientRect().height ?? NaN,
      speedRadius: speed ? parseFloat(getComputedStyle(speed).borderTopLeftRadius) : NaN,
      speedTopGap: speed && banner ? speed.getBoundingClientRect().top - banner.getBoundingClientRect().bottom : NaN,
      speedRightGap: speed ? window.innerWidth - speed.getBoundingClientRect().right : NaN,
      speedValue: speedValue?.textContent ?? null,
      speedUnit: speedUnit?.textContent ?? null,
      speedStillInSummary: Boolean(document.querySelector('.nav-summary-speed')),
    };
  });

  expect(summaryBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(metrics.height).toBe(104 + 18);
  expect(metrics.paddingBottom).toBe(18);
  expect(metrics.summaryRadius).toBeGreaterThanOrEqual(20);
  expect(metrics.bannerRadius).toBe(18);
  expect(metrics.instructionText).toBe('Sharp left');
  expect(metrics.instructionAriaLabel).toBe('Turn sharp left onto Holloway Road / A1');
  expect(metrics.providerInstruction).toBe('Turn sharp left onto Holloway Road / A1');
  expect(metrics.endRadius).toBe('50%');
  expect(metrics.dockDirection).toBe('column');
  expectNear(metrics.dockGap, 8, 0.5);
  expect(metrics.dockPadding).toBe(0);
  expect(metrics.dockRadius).toBe(0);
  expect(metrics.reportSize).toBe(54);
  expect(metrics.locateDisplay).toBe('none');
  expect(metrics.muteSize).toBe(54);
  expect(metrics.overviewSize).toBe(54);
  expect(metrics.muteRadius).toBe('50%');
  expectNear(metrics.reportLeft, metrics.muteLeft, 1);
  expectNear(metrics.muteLeft, metrics.overviewLeft, 1);
  expect(metrics.reportTop).toBeLessThan(metrics.muteTop);
  expect(metrics.muteTop).toBeLessThan(metrics.overviewTop);
  expectNear(metrics.muteTop - metrics.reportBottom, 8, 1);
  expectNear(metrics.overviewTop - metrics.muteBottom, 8, 1);
  expect(metrics.overviewBottom).toBeLessThan(metrics.summaryTop);
  expectNear(metrics.summaryTop - metrics.dockBottom, 18, 2);
  expect(metrics.maneuverWidth).toBe(70);
  expect(metrics.maneuverHeight).toBe(78);
  expect(metrics.maneuverRadius).toBe(0);
  expect(metrics.maneuverBackground).toBe('rgba(0, 0, 0, 0)');
  expect(metrics.maneuverBorderWidth).toBe(0);
  expect(metrics.maneuverSvgWidth).toBe(66);
  expect(metrics.maneuverHref).toBe('#i-nav-sharp-left');
  expectNear(metrics.nextHeight, 50, 0.1);
  expect(metrics.nextSvgWidth).toBe(30);
  expect(metrics.nextHref).toBe('#i-nav-fork-right');
  expect(metrics.roadAheadHeight).toBeGreaterThanOrEqual(42);
  expect(metrics.roadAheadEventCount).toBe(2);
  expect(metrics.roadAheadLabels[0]).toContain('Speed camera');
  expect(metrics.roadAheadLabels[0]).toContain('0.6 mi');
  expect(metrics.roadAheadLabels[1]).toContain('Road closure');
  expect(metrics.roadAheadLabels[1]).toContain('1.4 mi');
  expectNear(metrics.speedWidth, 76, 0.1);
  expectNear(metrics.speedHeight, 76, 0.1);
  expectNear(metrics.speedRadius, 38, 0.1);
  expectNear(metrics.speedTopGap, 10, 2);
  expectNear(metrics.speedRightGap, 14, 2);
  expect(metrics.speedValue).toBe('32');
  expect(metrics.speedUnit).toBe('mph');
  expect(metrics.speedStillInSummary).toBe(false);
  await expect(banner).toBeVisible();
  await expect(page.locator('#navSpeedBadge')).toBeVisible();
  await expect(mute).toBeVisible();
  await expect(overview).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/pwa-standalone/);
  // Fractional device-scale rounding can move an absolutely positioned edge
  // a little over two CSS pixels on some Chromium/WebKit device profiles.
  // Three pixels still rejects any meaningful safe-area gap while avoiding
  // false failures from sub-pixel viewport quantisation.
  expect(Math.abs((summaryBox.y + summaryBox.height) - viewport.height)).toBeLessThanOrEqual(3);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-vh'))).toBe('100vh');
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-navigation-controls-final.png'), fullPage: true });
  // The banner and summary are read at a glance while riding: contrast and
  // labels hold in both palettes (light on Chromium, dark on WebKit).
  if (AXE_PROJECTS.has(testInfo.project.name)) await expectNoAxeViolations(page, 'navigation');
});

test('@viewport standalone canvas, navigation and scroll geometry remain coherent', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await installStandaloneFixture(page);
  await mockAuthenticatedApi(page);
  await page.goto('/#map');
  await waitForViewportSettled(page);
  await expect(page.locator('html')).toHaveClass(/pwa-standalone/);

  for (const safeBottom of [0, 20, 34, 50]) {
    await setSyntheticSafeArea(page, safeBottom);
    const geometry = await standaloneGeometry(page);
    expectNear(geometry.appTop, 0);
    expectNear(geometry.appBottom, geometry.viewportHeight);
    // Fractional-DPR Chromium can place the scrollable screen edge on an
    // adjacent device pixel even when the fixed app/nav geometry is exact.
    // Keep this seam within 2 CSS px; app/nav bottom remain at the stricter
    // default tolerance immediately above/below.
    expectNear(geometry.screenBottom, geometry.appBottom, 2);
    // No tab bar: the map runs to the bottom edge, under the home indicator.
    // Fractional-DPR Chromium can quantize it to the adjacent device pixel.
    expectNear(geometry.mapBottom, geometry.appBottom, 2);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  }

  await setSyntheticSafeArea(page, 34);
  const captureEvidence = /iphone-17-pro-max|pixel-chromium|iphone-landscape|ipad-webkit/.test(testInfo.project.name);
  const screens = [
    ['map', '#mapCanvas'],
    ['ride', '#createRideBtn'],
    ['routes', '#curatedRouteList'],
    ['friends', '#friendList'],
    ['settings', '#settingsList .settings-row'],
  ];

  for (const [name, finalSelector] of screens) {
    await openTab(page, name);
    const screen = page.locator(`.screen[data-screen="${name}"]`);
    await expect(screen).toBeVisible();

    // Friends updates may replace the list even after aria-busy becomes false.
    // Recreate the long-list fixture if an asynchronous refresh detaches it,
    // without relaxing any of the real viewport geometry assertions below.
    const seedFriendsRows = async () => {
      await expect(page.locator('#friendList')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('#friendList .friend-row').first()).toBeVisible();
      await page.evaluate(() => {
        const list = document.querySelector('#friendList');
        const source = list?.firstElementChild;
        if (!list || !source || list.querySelector('[data-friend="viewport-friend-0"]')) return;
        for (let index = 0; index < 16; index += 1) {
          const clone = source.cloneNode(true);
          clone.dataset.friend = `viewport-friend-${index}`;
          list.append(clone);
        }
      });
      await expect(page.locator('#friendList [data-friend^="viewport-friend-"]')).toHaveCount(16);
    };
    if (name === 'friends') await seedFriendsRows();

    const final = name === 'routes'
      ? page.locator('[data-curated-route]').last()
      : name === 'friends'
        ? page.locator('#friendList > *').last()
        : page.locator(finalSelector).last();
    if (name === 'map') {
      const mapGeometry = await standaloneGeometry(page);
      expectNear(mapGeometry.mapBottom, mapGeometry.appBottom, 2);
    } else {
      let finalBox = null;
      // Only Friends has a known asynchronous list replacement. Limit retries
      // to that DOM-detachment race; never suppress other interaction failures.
      for (let attempt = 0; attempt < (name === 'friends' ? 3 : 1); attempt += 1) {
        try {
          if (name === 'friends' && attempt > 0) await seedFriendsRows();
          await final.scrollIntoViewIfNeeded();
          await screen.evaluate((element) => { element.scrollTop = element.scrollHeight; });
          finalBox = await final.boundingBox();
          if (finalBox && (name !== 'friends' ||
            await page.locator('#friendList [data-friend^="viewport-friend-"]').count() === 16)) break;
          finalBox = null;
        } catch (error) {
          if (name !== 'friends' || attempt === 2 ||
            !String(error).includes('not attached to the DOM')) throw error;
        }
      }
      expect(finalBox, `${name} final element has no geometry`).not.toBeNull();
      // There is no tab bar: every page's last row clears the screen edge.
      expect(finalBox.y + finalBox.height, `${name} final element must clear the bottom edge`).toBeLessThanOrEqual(page.viewportSize().height + 1);
    }
    await assertNoViewportOverflow(page);

    if (captureEvidence) {
      await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${name}-viewport.png`) });
    }
  }

  await openTab(page, 'map');
  const baseline = await standaloneGeometry(page);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitForViewportSettled(page);
  const resumed = await standaloneGeometry(page);
  expectNear(resumed.appBottom, baseline.appBottom);
  expectNear(resumed.mapBottom, resumed.appBottom, 2);

  if (testInfo.project.name === 'viewport-iphone-17-pro-max-webkit-dark') {
    const original = page.viewportSize();
    await page.setViewportSize({ width: original.height, height: original.width });
    await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
    await waitForViewportSettled(page);
    await page.setViewportSize(original);
    await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
    await waitForViewportSettled(page);
    const roundTrip = await standaloneGeometry(page);
    expectNear(roundTrip.appBottom, baseline.appBottom);
    expectNear(roundTrip.mapBottom, roundTrip.appBottom, 2);
  }
});

test('@viewport full-screen overlays and sheets share the stable standalone bottom edge', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await installStandaloneFixture(page);
  await mockAuthenticatedApi(page, 'unknown');
  await page.goto('/#map');
  await waitForViewportSettled(page);
  await setSyntheticSafeArea(page, 50);

  const app = page.locator('#app');
  const appBottom = (await app.boundingBox()).y + (await app.boundingBox()).height;
  const captureEvidence = /iphone-17-pro-max|pixel-chromium|iphone-landscape|ipad-webkit/.test(testInfo.project.name);

  const assertSheet = async (screenshotName) => {
    const backdrop = page.locator('#sheetBackdrop');
    const sheet = page.locator('.sheet');
    await expect(page.locator('html')).toHaveClass(/sheet-open/);
    await expect(app).toHaveAttribute('inert', '');
    await expect(page.locator('#ridePill')).toBeHidden();
    await expect(page.locator('#movementSafetyBanner')).toBeHidden();
    await expect(page.locator('#updateBanner')).toBeHidden();
    await sheet.evaluate(async (element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    const [backdropBox, sheetBox] = await Promise.all([backdrop.boundingBox(), sheet.boundingBox()]);
    expectNear(backdropBox.y + backdropBox.height, appBottom);
    expectNear(sheetBox.y + sheetBox.height, appBottom);
    const paddingBottom = await sheet.evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom));
    expect(paddingBottom).toBeGreaterThanOrEqual(50);
    await sheet.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expectNear((await sheet.boundingBox()).y + (await sheet.boundingBox()).height, appBottom);
    if (captureEvidence) await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${screenshotName}.png`) });
    // Settings pages close every level with X; other sheets with close.
    const closeAll = page.locator('#closeSheetAll');
    if (await closeAll.isVisible()) await closeAll.click();
    else await page.locator('#closeSheet').click();
    await expect(page.locator('html')).not.toHaveClass(/sheet-open/);
    await expect(app).not.toHaveAttribute('inert', '');
  };

  await openOwnProfile(page);
  await assertSheet('profile-page');
  await openFromMenu(page, 'settings');

  // Settings options are full-screen pages; they share the same edge.
  await openSettingsPage(page, 'navigationApp');
  await assertSheet('navigation-app-page');

  await openSettingsPage(page, 'blockedRiders');
  await assertSheet('blocked-riders-page');

  await openSettingsPage(page, 'devices');
  await assertSheet('devices-page');

  // Repeat a page transition to catch accumulated bottom offsets.
  await openSettingsPage(page, 'navigationApp');
  await assertSheet('navigation-app-page-repeat');

  await openTab(page, 'friends');
  await page.locator('[data-friend="rider_friend01"]').click();
  await assertSheet('friend-detail-sheet');

  await openTab(page, 'map');
  await page.locator('#mapSearchSlot').click();
  const searchBox = await page.locator('#searchScreen').boundingBox();
  expectNear(searchBox.y + searchBox.height, appBottom);
  await page.locator('#searchScreenBack').click();

  await openFromMenu(page, 'routes');
  await page.locator('[data-curated-route]').first().click();
  const routeBackdrop = page.locator('.route-detail-backdrop');
  const routeBox = await routeBackdrop.boundingBox();
  expectNear(routeBox.y + routeBox.height, appBottom);
  const routePadding = await page.locator('.route-detail-body').evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom));
  expect(routePadding).toBeGreaterThanOrEqual(50);
  await page.locator('.route-detail-close').click();
  await assertNoViewportOverflow(page);
});
