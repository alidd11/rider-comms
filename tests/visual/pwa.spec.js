import { expect, test } from '@playwright/test';

const RIDER_ID = 'rider_visual01';
const PROFILE = {
  riderId: RIDER_ID,
  displayName: 'Alex Rider',
  handle: '@alex_rides',
  avatarId: 'ember',
  zoneTier: 'free',
  unitSystem: 'miles',
  shareLocation: false,
  instagramUsername: '',
  tiktokUsername: '',
  instagramVisibility: 'friends',
  tiktokVisibility: 'friends',
};

async function mockAuthenticatedApi(page, movement = 'stationary', backendOverride = null) {
  await page.addInitScript(({ riderId, movementState }) => {
    localStorage.setItem('rider-comms-session-v1', JSON.stringify({ riderId, token: 'visual-test-token' }));
    Object.defineProperty(navigator, 'permissions', { value: { query: async ({ name } = {}) => ({ state: name === 'microphone' ? 'prompt' : ['stationary', 'recovering'].includes(movementState) ? 'granted' : 'denied', addEventListener() {} }) } });
    let watchId = 0;
    window.__riderCommsGetCurrentPositionCalls = 0;
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(success, error) {
        if (movementState === 'recovering') {
          window.gpsTest = { success, error, cleared: false };
          return ++watchId;
        }
        if (movementState !== 'stationary') {
          error?.({ code: 1, name: 'NotAllowedError' });
          return ++watchId;
        }
        const base = Date.now() - 7000;
        for (let index = 0; index <= 7; index += 1) success({
          timestamp: base + index * 1000,
          coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 5, speed: 0 },
        });
        return ++watchId;
      },
      clearWatch() { if (window.gpsTest) window.gpsTest.cleared = true; },
      getCurrentPosition(success, error) {
        window.__riderCommsGetCurrentPositionCalls += 1;
        if (movementState !== 'stationary') return error?.({ code: 1, name: 'NotAllowedError' });
        success({ timestamp: Date.now(), coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 5, speed: 0 } });
      },
    } });
  }, { riderId: RIDER_ID, movementState: movement });

  await page.route('https://backend-production-7fa0.up.railway.app/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Max-Age': '600',
    };

    // The installed-PWA tests run from the local Playwright web server while
    // the application is configured for the deployed API origin. Authenticated
    // JSON requests therefore preflight in real browsers. Mock OPTIONS
    // explicitly so Chromium and WebKit exercise the actual fetch path instead
    // of failing before the endpoint-specific fixture is reached.
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders, body: '' });
    }

    if (backendOverride) {
      const override = await backendOverride({ request, url });
      if (override) {
        return route.fulfill({
          status: override.status ?? 200,
          contentType: override.contentType ?? 'application/json',
          headers: { ...corsHeaders, ...(override.headers ?? {}) },
          body: override.body === undefined
            ? ''
            : typeof override.body === 'string'
              ? override.body
              : JSON.stringify(override.body),
        });
      }
    }
    let body = {};
    if (url.pathname === '/auth/me') body = { riderId: RIDER_ID };
    else if (url.pathname === `/riders/${RIDER_ID}/profile`) body = PROFILE;
    else if (url.pathname === `/riders/${RIDER_ID}/friends`) body = {
      friends: [
        { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' },
        { riderId: 'rider_friend02', displayName: 'Jay', handle: '@jay125', avatarId: 'moss' },
      ],
      nextCursor: null,
    };
    else if (url.pathname === `/riders/${RIDER_ID}/friend-requests`) body = { incoming: [], outgoing: [], profiles: {}, nextCursor: null };
    else if (url.pathname === '/friends/activity') body = { activity: [] };
    else if (url.pathname === '/conversations') body = { conversations: [], nextCursor: null };
    else if (url.pathname === '/messages/unread-count') body = { unreadCount: 0 };
    else if (url.pathname === '/messages/read') body = { readThroughSeq: 0 };
    else if (url.pathname === '/messages' && request.method() === 'GET') body = { messages: [], nextCursor: null, peerReadThroughMessageId: null };
    else if (url.pathname === '/social/events') {
      if (url.searchParams.get('waitMs') !== '0') await new Promise((resolve) => setTimeout(resolve, 250));
      body = { events: [], cursor: url.searchParams.get('after') || 'MA', hasMore: false };
    }
    else if (url.pathname === '/hazards/nearby') body = { hazards: [] };
    else if (url.pathname === '/rides/current') body = { ride: null };
    else if (url.pathname === '/config') body = { googleMapsApiKey: 'visual-test-key' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify(body),
    });
  });

  await page.route('https://maps.googleapis.com/maps/api/js**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      class MapMock {
        constructor(_element, options) {
          this.centre = options.center;
          this.zoom = options.zoom;
          this.options = { ...options };
          window.__riderCommsTestMap = this;
        }
        panTo(centre) { this.centre = centre; }
        setZoom(zoom) { this.zoom = zoom; }
        setOptions(options) { this.options = { ...this.options, ...options }; }
        getCenter() {
          return {
            lat: () => this.centre.lat,
            lng: () => this.centre.lng,
            toJSON: () => ({ ...this.centre }),
          };
        }
      }
      class MarkerMock {
        constructor(options) {
          this.position = options.position;
          this.title = options.title;
          window.__riderCommsTestMarkers = window.__riderCommsTestMarkers || [];
          window.__riderCommsTestMarkers.push(this);
        }
        addListener() {}
        setMap() {}
        setPosition(position) { this.position = position; }
      }
      class PlacesServiceMock {}
      class AutocompleteServiceMock {}
      class AutocompleteSessionTokenMock {}
      window.google = { maps: {
        Map: MapMock,
        Marker: MarkerMock,
        Size: class Size { constructor(width, height) { this.width = width; this.height = height; } },
        Point: class Point { constructor(x, y) { this.x = x; this.y = y; } },
        SymbolPath: { CIRCLE: 0 },
        places: {
          PlacesService: PlacesServiceMock,
          AutocompleteService: AutocompleteServiceMock,
          AutocompleteSessionToken: AutocompleteSessionTokenMock,
        },
      } };
      window.__riderCommsMapReady();
    `,
  }));
}

async function assertNoViewportOverflow(page) {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(overflow.width, `document width ${overflow.width}px exceeds ${overflow.viewport}px viewport`).toBeLessThanOrEqual(overflow.viewport + 1);
}

async function waitForViewportSettled(page) {
  // app.js intentionally resamples the standalone viewport across two paint
  // frames after launch/pageshow. Wait one additional frame before overriding
  // the safe-area test fixture so the production resync cannot race the test.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }));
}

async function installStandaloneFixture(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
}

async function setSyntheticSafeArea(page, bottom) {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.style.setProperty('--safe-bottom', `${value}px`);
    root.style.setProperty('--bottom-safe-area', `${value}px`);
  }, bottom);
}

async function standaloneGeometry(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const app = document.querySelector('#app');
    const screen = document.querySelector('.screen.active');
    const nav = document.querySelector('.bottom-nav');
    const rail = nav?.querySelector('button');
    const map = document.querySelector('#mapCanvas');
    const box = (element) => element?.getBoundingClientRect();
    const appBox = box(app);
    const screenBox = box(screen);
    const navBox = box(nav);
    const railBox = box(rail);
    const mapBox = box(map);
    const navStyle = getComputedStyle(nav);
    return {
      viewportHeight: root.clientHeight,
      viewportWidth: root.clientWidth,
      appTop: appBox?.top,
      appBottom: appBox?.bottom,
      screenBottom: screenBox?.bottom,
      navTop: navBox?.top,
      navBottom: navBox?.bottom,
      navHeight: navBox?.height,
      navPaddingBottom: parseFloat(navStyle.paddingBottom),
      railBottom: railBox?.bottom,
      mapBottom: mapBox?.bottom,
      documentWidth: root.scrollWidth,
    };
  });
}

function expectNear(actual, expected, tolerance = 1.5) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test('login baseline matches Rider Comms hierarchy in day and night', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Login baseline screenshots target iPhone 17 Pro Max geometry.');

  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '59px'));

    await expect(page.locator('#authScreen')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    await expect(page.locator('.auth-visual')).toBeVisible();
    await expect(page.locator('.auth-hero')).toHaveCount(0);
    await expect(page.locator('#authEyebrow')).toBeVisible();
    await expect(page.locator('#authEyebrow')).toHaveText('Welcome back');
    await expect(page.locator('#authTitle')).toHaveText('Ready to ride?');
    await expect(page.locator('#authDescription')).toHaveText('Sign in to reconnect with your rides, friends and rider circle.');
    await expect(page.locator('#loginForm')).toBeVisible();
    await expect(page.locator('#signupForm')).toBeHidden();
    await assertNoViewportOverflow(page);

    const visual = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const segment = document.querySelector('.auth-segmented');
      const tab = getComputedStyle(segment);
      const activeTab = getComputedStyle(segment.querySelector('button.active'));
      const input = getComputedStyle(document.querySelector('#loginUsername'));
      const button = getComputedStyle(document.querySelector('#loginSubmit'));
      const cardElement = document.querySelector('.auth-card');
      const card = getComputedStyle(cardElement);
      const heroElement = document.querySelector('.auth-visual');
      const hero = getComputedStyle(heroElement);
      const heroRect = heroElement.getBoundingClientRect();
      const cardRect = cardElement.getBoundingClientRect();
      const title = getComputedStyle(document.querySelector('#authTitle'));
      const termsRect = document.querySelector('.auth-terms').getBoundingClientRect();
      const assuranceRect = document.querySelector('.auth-assurance').getBoundingClientRect();
      return {
        background: root.getPropertyValue('--bg').trim().toLowerCase(),
        surface: root.getPropertyValue('--surface').trim().toLowerCase(),
        tabRadius: parseFloat(tab.borderTopLeftRadius),
        tabHeight: parseFloat(tab.height),
        tabWidth: parseFloat(tab.width),
        tabTopBorder: parseFloat(tab.borderTopWidth),
        tabBottomBorder: parseFloat(tab.borderBottomWidth),
        activeTabBottomBorder: parseFloat(activeTab.borderBottomWidth),
        activeTabBackground: activeTab.backgroundColor,
        activeTabShadow: activeTab.boxShadow,
        inputRadius: parseFloat(input.borderTopLeftRadius),
        inputHeight: parseFloat(input.height),
        buttonRadius: parseFloat(button.borderTopLeftRadius),
        buttonHeight: parseFloat(button.height),
        cardBackground: card.backgroundColor,
        cardBorderWidth: parseFloat(card.borderTopWidth),
        cardTop: cardRect.top,
        heroHeight: parseFloat(hero.height),
        heroRadius: parseFloat(hero.borderTopLeftRadius),
        heroBackground: hero.backgroundImage,
        heroTop: heroRect.top,
        heroBottom: heroRect.bottom,
        heroLeft: heroRect.left,
        heroWidth: heroRect.width,
        viewportWidth: window.innerWidth,
        titleSize: parseFloat(title.fontSize),
        assuranceAfterTerms: assuranceRect.top >= termsRect.bottom,
      };
    });

    expect(visual.tabRadius).toBeLessThanOrEqual(4);
    expect(visual.tabHeight).toBeLessThanOrEqual(40);
    expect(visual.tabWidth).toBeLessThanOrEqual(250);
    expect(visual.tabTopBorder).toBe(0);
    expect(visual.tabBottomBorder).toBe(0);
    expect(visual.activeTabBottomBorder).toBe(0);
    expect(visual.activeTabBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(visual.activeTabShadow).not.toBe('none');
    expect(visual.inputRadius).toBeLessThanOrEqual(4);
    expect(visual.inputHeight).toBeLessThanOrEqual(44);
    expect(visual.buttonRadius).toBeLessThanOrEqual(4);
    expect(visual.buttonHeight).toBeLessThanOrEqual(50);
    expect(visual.cardBackground).toBe('rgba(0, 0, 0, 0)');
    expect(visual.cardBorderWidth).toBe(0);
    expectNear(visual.cardTop, visual.heroBottom);
    expect(visual.assuranceAfterTerms).toBe(true);
    expect(visual.heroHeight).toBeGreaterThanOrEqual(297);
    expect(visual.heroHeight).toBeLessThanOrEqual(309);
    expect(visual.heroRadius).toBe(0);
    expect(Math.abs(visual.heroTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(visual.heroLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(visual.heroWidth - visual.viewportWidth)).toBeLessThanOrEqual(1);
    expect(visual.heroBackground).toContain('photo-1770614956862-a143fb5e4921');
    expect(visual.titleSize).toBeLessThanOrEqual(32);
    expect(visual.background).toBe(scheme === 'dark' ? '#080d10' : '#e9eef0');
    expect(visual.surface).toBe(scheme === 'dark' ? '#11171b' : '#f7f9fa');

    await page.screenshot({
      path: testInfo.outputPath(`iphone-17-pro-max-login-${scheme}-baseline.png`),
      fullPage: true,
    });
  }
});

test('ride join baseline owns the iPhone top edge in day and night', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Ride baseline screenshots target iPhone 17 Pro Max geometry.');

  await mockAuthenticatedApi(page, 'stationary');

  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '59px'));
    await expect(page.locator('#app')).toBeVisible();
    await page.locator('.bottom-nav [data-nav="ride"]').click();
    await expect(page.locator('#rideJoinState')).toBeVisible();
    await page.locator('[data-screen="ride"]').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await expect(page.locator('.ride-hero')).toBeVisible();
    await expect(page.locator('#joinRideForm')).toBeVisible();
    await expect(page.locator('#rideHostMode')).toBeVisible();
    await assertNoViewportOverflow(page);

    const visual = await page.evaluate(() => {
      const screen = document.querySelector('[data-screen="ride"]');
      const header = screen.querySelector('.page-header');
      const heroElement = screen.querySelector('.ride-hero');
      const join = screen.querySelector('.ride-entry');
      const rail = screen.querySelector('.ride-code-slots');
      const slot = screen.querySelector('.ride-code-slots span');
      const button = screen.querySelector('.ride-join-button');
      const start = screen.querySelector('.ride-start-row');
      const nav = document.querySelector('.bottom-nav');
      const box = (element) => element.getBoundingClientRect();
      const hero = getComputedStyle(heroElement);
      return {
        screenTop: box(screen).top,
        headerHeight: box(header).height,
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
        slotBackground: getComputedStyle(slot).backgroundColor,
        buttonHeight: box(button).height,
        startHeight: box(start).height,
        startRadius: parseFloat(getComputedStyle(start).borderTopLeftRadius),
        startBottom: box(start).bottom,
        navTop: box(nav).top,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        navGap: box(nav).top - box(start).bottom,
        titleWidth: box(document.querySelector('#rideTitle')).width,
        safeTopShieldDisplay: getComputedStyle(screen, '::before').display,
      };
    });

    expectNear(visual.heroTop, visual.screenTop);
    expectNear(visual.heroLeft, 0);
    expectNear(visual.heroWidth, visual.viewportWidth);
    expect(visual.headerHeight).toBeLessThanOrEqual(1);
    expect(visual.titleWidth).toBeLessThanOrEqual(1);
    expect(visual.safeTopShieldDisplay).toBe('none');
    expect(visual.heroHeight / visual.viewportHeight).toBeGreaterThanOrEqual(0.45);
    expect(visual.heroHeight / visual.viewportHeight).toBeLessThanOrEqual(0.49);
    expect(visual.heroRadius).toBe(0);
    expect(visual.joinTop - (visual.heroTop + visual.heroHeight)).toBeGreaterThanOrEqual(10);
    expect(visual.joinTop - (visual.heroTop + visual.heroHeight)).toBeLessThanOrEqual(14);
    expect(visual.joinRadius).toBeLessThanOrEqual(4);
    expect(visual.railHeight).toBeLessThanOrEqual(40);
    expect(visual.railRadius).toBeLessThanOrEqual(4);
    expect(visual.railGap).toBe(0);
    expect(visual.slotHeight).toBeLessThanOrEqual(40);
    expect(visual.slotRadius).toBe(0);
    expect(visual.buttonHeight).toBeLessThanOrEqual(44);
    expect(visual.startHeight).toBeLessThanOrEqual(60);
    expect(visual.startRadius).toBeLessThanOrEqual(4);
    expect(visual.startBottom).toBeLessThanOrEqual(visual.navTop + 2);
    expect(visual.navGap).toBeGreaterThanOrEqual(0);
    expect(visual.navGap).toBeLessThanOrEqual(170);

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
    const banner = getComputedStyle(document.querySelector('#movementSafetyBanner'));
    return {
      background: root.getPropertyValue('--bg').trim().toLowerCase(),
      surface: root.getPropertyValue('--surface').trim().toLowerCase(),
      text: root.getPropertyValue('--text').trim().toLowerCase(),
      bannerBackground: banner.backgroundColor,
      bannerText: banner.color,
    };
  });
  expect(day.background).toBe('#e9eef0');
  expect(day.surface).toBe('#f7f9fa');
  expect(day.text).toBe('#0b1216');
  expect(day.bannerBackground).not.toBe('rgb(17, 23, 27)');
  expect(day.bannerText).toBe('rgb(11, 18, 22)');
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
    await page.locator(`.bottom-nav [data-nav="${screen}"]`).click();
    await expect(page.locator(readySelector)).toBeVisible();
    await assertNoViewportOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`${testInfo.project.name}-${screen}.png`),
      fullPage: true,
    });
  }

  await page.locator('.bottom-nav [data-nav="map"]').click();
  await page.locator('#mapSearchSlot').click();
  await expect(page.locator('#searchScreen')).toBeVisible();
  await assertNoViewportOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-search.png`),
    fullPage: true,
  });

  expect(runtimeErrors).toEqual([]);
});

test('final mockup parity is sharp, map-first and iPhone 17 Pro Max safe', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Final mockup screenshots target iPhone 17 Pro Max geometry.');

  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();

  const mapGeometry = await page.evaluate(() => {
    const screen = document.querySelector('[data-screen="map"]');
    const canvas = document.querySelector('#mapCanvas');
    const search = document.querySelector('#mapSearchSlot');
    const action = document.querySelector('.map-actions .icon-button');
    const nearby = document.querySelector('#joinNearbyBtn');
    const avatarWrap = document.querySelector('.map-avatar-wrap');
    const optionsGlyph = document.querySelector('.map-search-options');
    const screenBox = screen?.getBoundingClientRect();
    const canvasBox = canvas?.getBoundingClientRect();
    return {
      screenTop: screenBox?.top ?? null,
      canvasTop: canvasBox?.top ?? null,
      canvasLeft: canvasBox?.left ?? null,
      canvasRight: canvasBox?.right ?? null,
      viewportWidth: document.documentElement.clientWidth,
      searchRadius: search ? parseFloat(getComputedStyle(search).borderTopLeftRadius) : NaN,
      actionRadius: action ? parseFloat(getComputedStyle(action).borderTopLeftRadius) : NaN,
      nearbyWidth: nearby?.getBoundingClientRect().width ?? NaN,
      avatarDisplay: avatarWrap ? getComputedStyle(avatarWrap).display : null,
      optionsGlyphWidth: optionsGlyph?.getBoundingClientRect().width ?? NaN,
      mapTypeId: window.__riderCommsTestMap?.options?.mapTypeId ?? null,
    };
  });
  expectNear(mapGeometry.canvasTop, mapGeometry.screenTop);
  expectNear(mapGeometry.canvasLeft, 0);
  expectNear(mapGeometry.canvasRight, mapGeometry.viewportWidth);
  expect(mapGeometry.searchRadius).toBeLessThanOrEqual(4);
  expect(mapGeometry.actionRadius).toBeLessThanOrEqual(4);
  expect(mapGeometry.nearbyWidth).toBeGreaterThanOrEqual(62);
  expect(mapGeometry.avatarDisplay).toBe('none');
  expect(mapGeometry.optionsGlyphWidth).toBeGreaterThanOrEqual(16);
  expect(mapGeometry.mapTypeId).toBe('hybrid');
  await expect(page.locator('[data-screen="map"] .page-header')).toHaveCount(0);
  await expect(page.locator('#mapSearchSlot')).toBeVisible();
  await expect(page.locator('#movementSafetyBanner')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-map-final.png'), fullPage: true });

  await page.locator('#reportHazardBtn').click();
  await expect(page.locator('#sheetBackdrop')).toBeVisible();
  await expect(page.locator('#sheetTitle')).toHaveText('Report on the road');
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

  await page.locator('.bottom-nav [data-nav="ride"]').click();
  await expect(page.locator('.ride-hero')).toBeVisible();
  await page.locator('[data-screen="ride"]').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const rideHeroRadius = await page.locator('.ride-hero').evaluate((element) => parseFloat(getComputedStyle(element).borderTopLeftRadius));
  expect(rideHeroRadius).toBeLessThanOrEqual(4);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-ride-final.png'), fullPage: true });

  await page.locator('.bottom-nav [data-nav="routes"]').click();
  const finalRouteCard = page.locator('.curated-route-card').first();
  await expect(finalRouteCard).toBeVisible();
  await expect(finalRouteCard.locator('.route-trace-card')).toBeHidden();
  const finalRouteBox = await finalRouteCard.boundingBox();
  expect(finalRouteBox).not.toBeNull();
  expect(finalRouteBox.width / finalRouteBox.height).toBeGreaterThan(2);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-routes-final.png'), fullPage: true });

  await page.locator('.bottom-nav [data-nav="friends"]').click();
  await expect(page.locator('#friendList [data-friend]').first()).toBeVisible();
  const friendsGeometry = await page.evaluate(() => {
    const search = document.querySelector('[data-screen="friends"] .search-row');
    const row = document.querySelector('#friendList [data-friend]');
    const avatar = row?.querySelector('.avatar');
    const box = (element) => element?.getBoundingClientRect();
    return {
      searchHeight: box(search)?.height ?? NaN,
      rowHeight: box(row)?.height ?? NaN,
      avatarWidth: box(avatar)?.width ?? NaN,
    };
  });
  expect(friendsGeometry.searchHeight).toBeLessThanOrEqual(46);
  expect(friendsGeometry.rowHeight).toBeLessThanOrEqual(60);
  expect(friendsGeometry.avatarWidth).toBeLessThanOrEqual(42);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-friends-final.png'), fullPage: true });

  await page.locator('#friendList [data-friend]').first().click();
  await expect(page.locator('#sheetBackdrop')).toBeVisible();
  await expect(page.locator('.friend-profile-card')).toBeVisible();
  const friendDetailGeometry = await page.evaluate(() => {
    const avatar = document.querySelector('.friend-profile-card .avatar');
    const action = document.querySelector('.friend-profile-actions button');
    const listRow = document.querySelector('.friend-detail-list > div');
    const box = (element) => element?.getBoundingClientRect();
    return {
      avatarWidth: box(avatar)?.width ?? NaN,
      actionHeight: box(action)?.height ?? NaN,
      listRowHeight: box(listRow)?.height ?? NaN,
    };
  });
  expect(friendDetailGeometry.avatarWidth).toBeLessThanOrEqual(54);
  expect(friendDetailGeometry.actionHeight).toBeLessThanOrEqual(58);
  expect(friendDetailGeometry.listRowHeight).toBeLessThanOrEqual(52);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-friend-detail-final.png'), fullPage: true });
  await page.locator('#closeSheet').click();

  await page.locator('.bottom-nav [data-nav="settings"]').click();
  await expect(page.locator('.settings-page')).toBeVisible();
  await expect(page.locator('[data-screen="settings"] .page-subtitle')).toHaveCount(0);
  const settingsRadius = await page.locator('.settings-page .settings-group').first().evaluate((element) =>
    parseFloat(getComputedStyle(element).borderTopLeftRadius)
  );
  expect(settingsRadius).toBeLessThanOrEqual(4);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-settings-final.png'), fullPage: true });
  await assertNoViewportOverflow(page);
});

test('PWA route discovery previews route shape and hands the start back to the map', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();

  await page.locator('.bottom-nav [data-nav="routes"]').click();
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
  await assertNoViewportOverflow(page);
});

test('PWA map uses an already-granted live location instead of showing the London fallback as the rider', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');

  await expect.poll(async () => page.evaluate(() => {
    const centre = window.__riderCommsTestMap?.centre;
    return centre ? [centre.lat, centre.lng] : null;
  })).toEqual([51.5074, -0.1278]);

  const mapState = await page.evaluate(() => {
    const markers = window.__riderCommsTestMarkers || [];
    const own = markers.find((marker) => marker.title === 'Your location');
    return {
      centre: window.__riderCommsTestMap?.centre,
      zoom: window.__riderCommsTestMap?.zoom,
      ownPosition: own?.position ?? null,
      ownMarkerCount: markers.filter((marker) => marker.title === 'Your location').length,
      ownMarkerEverUsedFallback: markers.some((marker) =>
        marker.title === 'Your location'
        && marker.position?.lat === 51.564
        && marker.position?.lng === -0.106
      ),
    };
  });

  expect(mapState.centre).toEqual({ lat: 51.5074, lng: -0.1278 });
  expect(mapState.zoom).toBe(15);
  expect(mapState.ownPosition).toEqual({ lat: 51.5074, lng: -0.1278 });
  expect(mapState.ownMarkerCount).toBe(1);
  expect(mapState.ownMarkerEverUsedFallback).toBe(false);
});

test('PWA utility viewport paints safe areas as one edge-to-edge canvas', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');

  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportMeta).toContain('viewport-fit=cover');

  await page.locator('.bottom-nav [data-nav="settings"]').click();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-top', '59px');
    document.documentElement.style.setProperty('--safe-left', '47px');
    document.documentElement.style.setProperty('--safe-right', '47px');
  });

  const viewport = await page.locator('[data-screen="settings"]').evaluate((screen) => {
    const screenStyle = getComputedStyle(screen);
    const shieldStyle = getComputedStyle(screen, '::before');
    const navStyle = getComputedStyle(document.querySelector('.bottom-nav'));
    return {
      screenBackground: screenStyle.backgroundImage,
      shieldBackground: shieldStyle.backgroundImage,
      screenBackgroundColor: screenStyle.backgroundColor,
      shieldBackgroundColor: shieldStyle.backgroundColor,
      shieldHeight: shieldStyle.height,
      paddingTop: screenStyle.paddingTop,
      paddingLeft: screenStyle.paddingLeft,
      navPaddingLeft: navStyle.paddingLeft,
    };
  });

  expect(viewport.shieldHeight).toBe('59px');
  expect(viewport.screenBackground).toBe('none');
  expect(viewport.shieldBackground).toBe('none');
  expect(viewport.shieldBackgroundColor).toBe(viewport.screenBackgroundColor);
  expect(parseFloat(viewport.paddingTop)).toBeGreaterThan(59);
  expect(parseFloat(viewport.paddingLeft)).toBeGreaterThanOrEqual(47);
  expect(parseFloat(viewport.navPaddingLeft)).toBeGreaterThanOrEqual(47);
  await assertNoViewportOverflow(page);
});

test('PWA warns without hiding controls when movement cannot be verified', async ({ page }) => {
  await mockAuthenticatedApi(page, 'unknown');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#movementSafetyBanner')).toBeVisible();
  const routesTab = page.locator('.bottom-nav [data-nav="routes"]');
  await expect(routesTab).toBeVisible();
  await expect(routesTab).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#mapSearchSlot')).toBeVisible();
  await expect(page.locator('.map-header')).not.toHaveAttribute('inert', '');
  const enableLocation = page.locator('#enableLocationBtn');
  await expect(enableLocation).toBeVisible();
  await expect(enableLocation).toHaveText('Location help');
  await routesTab.click();
  await expect(page.locator('[data-screen="routes"]')).toHaveClass(/active/);
  await enableLocation.click();
  await expect(page.locator('#toast')).toContainText('Location access is blocked');
});

test('PWA GPS timeout recovers without another permission request or startup lock', async ({ page }) => {
  await mockAuthenticatedApi(page, 'recovering');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#movementSafetyBanner')).toBeVisible();
  await expect(page.locator('#enableLocationBtn')).toBeHidden();
  await expect(page.locator('.bottom-nav [data-nav="friends"]')).toHaveAttribute('aria-disabled', 'false');
  await page.evaluate(() => {
    window.gpsTest.error({ code: 3 });
    window.gpsTest.error({ code: 2 });
  });
  expect(await page.evaluate(() => window.gpsTest.cleared)).toBe(false);
  await page.evaluate(() => {
    const base = Date.now() - 7000;
    for (let i = 0; i <= 7; i++) window.gpsTest.success({
      timestamp: base + i * 1000,
      coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 5, speed: 0 },
    });
  });
  await expect(page.locator('#movementSafetyBanner')).toBeHidden();
  await page.locator('.bottom-nav [data-nav="friends"]').click();
  await expect(page.locator('[data-screen="friends"]')).toHaveClass(/active/);
});

test('PWA restores server ride consent and clears a removed cached ride on reopen', async ({ page }) => {
  let currentRide = {
    rideId: 'ride-reopen-1', code: 'ABCDEF', createdBy: RIDER_ID,
    memberIds: [RIDER_ID], shareRideLocation: true,
  };
  await mockAuthenticatedApi(page, 'stationary', ({ url }) =>
    url.pathname === '/rides/current' ? { body: { ride: currentRide } } : null);
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({
      screen: 'ride', profile,
      activeRide: { rideId: 'ride-reopen-1', code: 'OLD123', memberIds: [riderId], shareRideLocation: false },
    }));
  }, { riderId: RIDER_ID, profile: PROFILE });
  await page.goto('/');
  await expect(page.locator('#rideActiveState')).toBeVisible();
  await expect(page.locator('#activeRideCode')).toHaveText('ABCDEF');
  await expect(page.locator('#activeRideLocationConsent')).toBeChecked();
  await expect(page.locator('#rideVoiceStatus')).toContainText('Resume voice');
  currentRide = null;
  await page.reload();
  await expect(page.locator('#rideJoinState')).toBeVisible();
  await expect(page.locator('#rideActiveState')).toBeHidden();
  const cached = await page.evaluate((id) => JSON.parse(localStorage.getItem(`rider-comms-pwa-v4:${id}`)), RIDER_ID);
  expect(cached.activeRide).toBeNull();
});

test('PWA resumes consented ride location after its first GPS fix and maps members at real coordinates', async ({ page }) => {
  let uploads = 0;
  const other = { riderId: 'rider_guest01', displayName: 'Guest Rider', handle: '@guest_rider' };
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/rides/current') return { body: { ride: {
      rideId: 'ride-reopen-1', code: 'ABCDEF', createdBy: RIDER_ID,
      memberIds: [RIDER_ID, other.riderId], shareRideLocation: true,
    } } };
    if (url.pathname === `/profiles/${other.riderId}`) return { body: other };
    if (url.pathname === '/rides/ride-reopen-1/location' && request.method() === 'POST') {
      uploads += 1;
      return { body: { ok: true } };
    }
    if (url.pathname === '/rides/ride-reopen-1/locations') return { body: { locations: [
      { riderId: other.riderId, lat: 51.51, lon: -0.13, recordedAt: Date.now() },
    ] } };
    return null;
  });
  await page.goto('/');
  await expect(page.locator('#activeRideLocationConsent')).toBeChecked();
  await expect.poll(() => uploads).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const markers = window.__riderCommsTestMarkers || [];
    return markers.filter((marker) => marker.title === 'Guest Rider').map((marker) => marker.position);
  })).toContainEqual({ lat: 51.51, lng: -0.13 });
  const guestPositions = await page.evaluate(() => (window.__riderCommsTestMarkers || [])
    .filter((marker) => marker.title === 'Guest Rider').map((marker) => marker.position));
  expect(guestPositions.every((point) => point.lat === 51.51 && point.lng === -0.13)).toBe(true);
});

test('PWA resumes public presence only after server consent and granted location permission', async ({ page }) => {
  let presenceUpdates = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) return { body: { ...PROFILE, shareLocation: true } };
    if (url.pathname === '/presence' && request.method() === 'POST') {
      presenceUpdates += 1;
      return { body: { inZoneWith: [] } };
    }
    return null;
  });
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ screen: 'map', profile, publicLive: true }));
  }, { riderId: RIDER_ID, profile: { ...PROFILE, shareLocation: true } });
  await page.goto('/');
  await expect.poll(() => presenceUpdates).toBe(1);
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('#voiceStatusBtn')).toHaveAttribute('aria-label', 'Resume voice');
});

test('PWA Nearby control switches public visibility and proximity voice off together', async ({ page }) => {
  let shareLocation = false;
  let presenceUpdates = 0;
  let presenceDeletes = 0;
  const profileSharingUpdates = [];

  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') {
          shareLocation = update.shareLocation;
          profileSharingUpdates.push(update.shareLocation);
        }
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      presenceUpdates += 1;
      return { body: { inZoneWith: [], transitions: [], radiusMiles: 1 } };
    }
    if (url.pathname === '/presence' && request.method() === 'DELETE') {
      presenceDeletes += 1;
      return { body: {} };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      return { body: { connections: [], refreshAfterMs: 20_000 } };
    }
    return null;
  });

  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    window.LivekitClient = {};
  });

  await page.goto('/');
  const nearby = page.locator('#joinNearbyBtn');

  await expect(nearby).toHaveAttribute('data-active', 'false');
  await expect(nearby).toHaveAttribute('aria-label', 'Go live nearby');
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');
  await expect(nearby).toHaveAttribute('aria-busy', 'false');
  const locationCallsBeforeNearby = await page.evaluate(() => window.__riderCommsGetCurrentPositionCalls);

  await nearby.click();
  await expect.poll(() => presenceUpdates).toBe(1);
  await expect.poll(() => profileSharingUpdates.at(-1)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__riderCommsGetCurrentPositionCalls)).toBe(locationCallsBeforeNearby);
  await expect(nearby).toHaveAttribute('data-active', 'true');
  await expect(nearby).toHaveAttribute('aria-label', 'Leave nearby');
  await expect(nearby).toHaveAttribute('aria-pressed', 'true');
  await expect(nearby).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#voiceStatusBtn')).toBeVisible();
  await expect(page.locator('#voiceStatusBtn')).toHaveAttribute('aria-label', 'Nearby Voice · waiting for riders');

  await nearby.click();
  await expect.poll(() => presenceDeletes).toBeGreaterThan(0);
  await expect.poll(() => profileSharingUpdates.at(-1)).toBe(false);
  await expect(nearby).toHaveAttribute('data-active', 'false');
  await expect(nearby).toHaveAttribute('aria-label', 'Go live nearby');
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');
  await expect(nearby).toHaveAttribute('aria-busy', 'false');

  const cached = await page.evaluate((riderId) =>
    JSON.parse(localStorage.getItem(`rider-comms-pwa-v4:${riderId}`) || '{}'), RIDER_ID);
  expect(cached.publicLive).toBe(false);
  expect(cached.profile.shareLocation).toBe(false);
});

test('PWA Nearby Voice waits without holding the mic, then connects when a rider enters range', async ({ page }) => {
  let shareLocation = false;
  let presenceUpdates = 0;

  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') shareLocation = update.shareLocation;
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      presenceUpdates += 1;
      const peerVisible = presenceUpdates >= 2;
      return {
        body: {
          inZoneWith: peerVisible ? ['rider_peer01'] : [],
          transitions: peerVisible ? [{ a: RIDER_ID, b: 'rider_peer01', type: 'entered' }] : [],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      const peerVisible = presenceUpdates >= 2;
      return {
        body: {
          connections: peerVisible
            ? [{ peerId: 'rider_peer01', token: 'peer-token', url: 'wss://voice.example.test' }]
            : [],
          refreshAfterMs: 20_000,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    // Keep the production cadence unchanged while making the second public
    // presence refresh deterministic and fast enough for this browser test.
    const realSetInterval = window.setInterval.bind(window);
    window.setInterval = (handler, timeout = 0, ...args) =>
      realSetInterval(handler, timeout === 20_000 ? 300 : timeout, ...args);

    window.__nearbyVoiceRoomsCreated = 0;
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    class FakeAudioContext {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() {
        return {
          fftSize: 512,
          frequencyBinCount: 32,
          getByteTimeDomainData(data) { data.fill(128); },
        };
      }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    window.LivekitClient = {
      Room: class {
        constructor() {
          window.__nearbyVoiceRoomsCreated += 1;
          this.localParticipant = { setMicrophoneEnabled: async () => {} };
        }
        on() { return this; }
        async connect() {}
        async startAudio() {}
        async disconnect() {}
      },
      RoomEvent: {
        TrackSubscribed: 'trackSubscribed',
        TrackUnsubscribed: 'trackUnsubscribed',
        ActiveSpeakersChanged: 'activeSpeakersChanged',
        Reconnected: 'reconnected',
        Disconnected: 'disconnected',
      },
      Track: { Kind: { Audio: 'audio' } },
    };
  });

  await page.goto('/');
  const nearby = page.locator('#joinNearbyBtn');
  const voice = page.locator('#voiceStatusBtn');

  await nearby.click();
  await expect(nearby).toHaveAttribute('data-active', 'true');
  await expect(voice).toBeVisible();
  await expect(voice).toHaveAttribute('aria-label', 'Nearby Voice · waiting for riders');

  await expect.poll(() => presenceUpdates).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.__nearbyVoiceRoomsCreated)).toBe(1);
  await expect(voice).toHaveAttribute('aria-label', 'Listening — hands-free');
});

test('PWA cancels a delayed Nearby Voice connect after the rider turns Nearby off', async ({ page }) => {
  let shareLocation = false;
  let voiceTokenRequested = false;
  let releaseVoiceToken;
  const voiceTokenGate = new Promise((resolve) => { releaseVoiceToken = resolve; });

  await mockAuthenticatedApi(page, 'stationary', async ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') shareLocation = update.shareLocation;
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      return {
        body: {
          inZoneWith: ['rider_peer01'],
          transitions: [{ a: RIDER_ID, b: 'rider_peer01', type: 'entered' }],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/presence' && request.method() === 'DELETE') return { body: {} };
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      voiceTokenRequested = true;
      await voiceTokenGate;
      return {
        body: {
          connections: [{ peerId: 'rider_peer01', token: 'delayed-token', url: 'wss://voice.example.test' }],
          refreshAfterMs: 20_000,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    window.__nearbyVoiceRoomsCreated = 0;
    window.LivekitClient = {
      Room: class {
        constructor() {
          window.__nearbyVoiceRoomsCreated += 1;
          this.localParticipant = { setMicrophoneEnabled: async () => {} };
        }
        on() { return this; }
        async connect() {}
        async startAudio() {}
        async disconnect() {}
      },
      RoomEvent: { Disconnected: 'disconnected' },
      Track: { Kind: { Audio: 'audio' } },
    };
  });

  await page.goto('/');
  const nearby = page.locator('#joinNearbyBtn');

  await nearby.click();
  await expect(nearby).toHaveAttribute('data-active', 'true');
  await expect.poll(() => voiceTokenRequested).toBe(true);

  // The token request is deliberately still in flight. Turning Nearby off
  // invalidates it before it can construct/publish a proximity room.
  await nearby.click();
  await expect(nearby).toHaveAttribute('data-active', 'false');
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');

  releaseVoiceToken();
  await expect.poll(() => page.evaluate(() => window.__nearbyVoiceRoomsCreated)).toBe(0);
  await expect(page.locator('#voiceStatusBtn')).toBeHidden();
});

test('PWA attaches subscribed Nearby Voice audio after Go Live', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile` && request.method() === 'PUT') {
      return { body: { ...PROFILE, shareLocation: true } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      return {
        body: {
          inZoneWith: ['rider_peer01'],
          transitions: [{ a: RIDER_ID, b: 'rider_peer01', type: 'entered' }],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      return {
        body: {
          connections: [{
            peerId: 'rider_peer01',
            token: 'visual-livekit-token',
            url: 'wss://voice.example.test',
          }],
          refreshAfterMs: 20_000,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    class FakeAudioContext {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() {
        return {
          fftSize: 512,
          frequencyBinCount: 32,
          getByteTimeDomainData(data) { data.fill(128); },
        };
      }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });

  await page.route('https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      (() => {
        const RoomEvent = {
          TrackSubscribed: 'trackSubscribed',
          TrackUnsubscribed: 'trackUnsubscribed',
          Reconnected: 'reconnected',
          Disconnected: 'disconnected',
        };
        const Track = { Kind: { Audio: 'audio' } };
        class Room {
          constructor() {
            this.handlers = new Map();
            this.canPlaybackAudio = true;
            this.localParticipant = { setMicrophoneEnabled: async () => {} };
          }
          on(event, handler) {
            const handlers = this.handlers.get(event) || [];
            handlers.push(handler);
            this.handlers.set(event, handlers);
            return this;
          }
          emit(event, ...args) {
            for (const handler of this.handlers.get(event) || []) handler(...args);
          }
          async connect() {
            const attached = [];
            const track = {
              kind: 'audio',
              attach() {
                const element = document.createElement('audio');
                attached.push(element);
                return element;
              },
              detach() { return attached.splice(0); },
            };
            this.emit(RoomEvent.TrackSubscribed, track, {}, { identity: 'rider_peer01' });
          }
          async startAudio() { this.canPlaybackAudio = true; }
          async disconnect() { this.emit(RoomEvent.Disconnected); }
        }
        window.LivekitClient = { Room, RoomEvent, Track };
      })();
    `,
  }));

  await page.goto('/');
  await page.locator('#joinNearbyBtn').click();

  await expect.poll(() => page.locator('audio[data-rider-comms-voice="true"]').count()).toBe(1);
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'true');
});

test('PWA keeps private-ride speaker identity visible across tabs', async ({ page }) => {
  let currentRide = null;
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === '/rides/current' && request.method() === 'GET') {
      return { body: { ride: currentRide } };
    }
    if (url.pathname === '/rides' && request.method() === 'POST') {
      currentRide = {
        rideId: 'ride-speaker-1',
        code: 'VOICE1',
        createdBy: RIDER_ID,
        memberIds: [RIDER_ID, 'rider_friend01'],
        shareRideLocation: false,
      };
      return { body: currentRide };
    }
    if (url.pathname === `/profiles/${RIDER_ID}`) {
      return { body: PROFILE };
    }
    if (url.pathname === '/profiles/rider_friend01') {
      return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      return { body: { token: 'private-ride-token', url: 'wss://voice.example.test' } };
    }
    return null;
  });

  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    class FakeAudioContext {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() {
        return {
          fftSize: 512,
          frequencyBinCount: 32,
          getByteTimeDomainData(data) { data.fill(128); },
        };
      }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });

  await page.route('https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      (() => {
        const RoomEvent = {
          TrackSubscribed: 'trackSubscribed',
          TrackUnsubscribed: 'trackUnsubscribed',
          ActiveSpeakersChanged: 'activeSpeakersChanged',
          Reconnected: 'reconnected',
          Disconnected: 'disconnected',
        };
        const Track = { Kind: { Audio: 'audio' } };
        class Room {
          constructor() {
            this.handlers = new Map();
            this.canPlaybackAudio = true;
            this.localParticipant = { setMicrophoneEnabled: async () => {} };
          }
          on(event, handler) {
            const handlers = this.handlers.get(event) || [];
            handlers.push(handler);
            this.handlers.set(event, handlers);
            return this;
          }
          emit(event, ...args) {
            for (const handler of this.handlers.get(event) || []) handler(...args);
          }
          async connect() {
            setTimeout(() => this.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'rider_friend01' }]), 0);
          }
          async startAudio() { this.canPlaybackAudio = true; }
          async disconnect() { this.emit(RoomEvent.Disconnected); }
        }
        window.LivekitClient = { Room, RoomEvent, Track };
      })();
    `,
  }));

  const initialRideRestore = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/rides/current' && response.request().method() === 'GET';
  });
  await page.goto('/');
  await initialRideRestore;
  await page.locator('.bottom-nav [data-nav="ride"]').click();
  // "Create private ride" lives inside the host form; enter host mode first.
  await page.locator('#rideHostMode').click();
  await expect(page.locator('#createRideBtn')).toBeVisible();
  await page.locator('#createRideBtn').click();

  await expect(page.locator('#ridePill')).toBeVisible();
  await expect(page.locator('#ridePill small')).toHaveText('Maya speaking');
  await expect(page.locator('#ridePill')).toHaveAttribute('aria-label', 'Active ride · Maya speaking');

  await page.locator('.bottom-nav [data-nav="friends"]').click();
  await expect(page.locator('[data-screen="friends"]')).toHaveClass(/active/);
  await expect(page.locator('#ridePill')).toBeVisible();
  await expect(page.locator('#ridePill small')).toHaveText('Maya speaking');
});


test('PWA pauses saved public presence when current server consent is off', async ({ page }) => {
  let presenceUpdates = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === '/presence' && request.method() === 'POST') presenceUpdates += 1;
    return null;
  });
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ screen: 'map', profile, publicLive: true }));
  }, { riderId: RIDER_ID, profile: { ...PROFILE, shareLocation: true } });
  await page.goto('/');
  await expect.poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem(`rider-comms-pwa-v4:${id}`)).profile.shareLocation, RIDER_ID)).toBe(false);
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'false');
  expect(presenceUpdates).toBe(0);
});

test('PWA does not prompt for location when restoring nearby without permission', async ({ page }) => {
  let presenceUpdates = 0;
  await mockAuthenticatedApi(page, 'denied', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) return { body: { ...PROFILE, shareLocation: true } };
    if (url.pathname === '/presence' && request.method() === 'POST') presenceUpdates += 1;
    return null;
  });
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ screen: 'map', profile, publicLive: true }));
  }, { riderId: RIDER_ID, profile: { ...PROFILE, shareLocation: true } });
  await page.goto('/');
  await expect(page.locator('#toast')).toContainText('Nearby paused.');
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'false');
  expect(presenceUpdates).toBe(0);
});

test('PWA host can remove another rider from a private ride', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) =>
    url.pathname === '/rides/current' ? { body: { ride: {
      rideId: 'ride-visual-1', code: 'ABCDEF', createdBy: RIDER_ID,
      memberIds: [RIDER_ID, 'rider_guest01'], shareRideLocation: false,
    } } } : null);
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({
      screen: 'ride',
      profile,
      activeRide: {
        rideId: 'ride-visual-1',
        code: 'ABCDEF',
        isHost: true,
        createdBy: riderId,
        memberIds: [riderId, 'rider_guest01'],
        members: [
          { riderId, displayName: profile.displayName, handle: profile.handle },
          { riderId: 'rider_guest01', displayName: 'Guest Rider', handle: '@guest_rider' },
        ],
        shareRideLocation: false,
      },
    }));
  }, { riderId: RIDER_ID, profile: PROFILE });

  await page.route('https://backend-production-7fa0.up.railway.app/rides/ride-visual-1**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'DELETE' && pathname.endsWith('/members/rider_guest01')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rideId: 'ride-visual-1',
          createdBy: RIDER_ID,
          createdAt: Date.now(),
          memberIds: [RIDER_ID],
        }),
      });
    }
    if (request.method() === 'GET' && pathname === '/rides/ride-visual-1') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rideId: 'ride-visual-1',
          createdBy: RIDER_ID,
          createdAt: Date.now(),
          memberIds: [RIDER_ID, 'rider_guest01'],
        }),
      });
    }
    return route.fallback();
  });

  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/#ride');
  await expect(page.locator('[data-remove-ride-member="rider_guest01"]')).toBeVisible();
  await page.locator('[data-remove-ride-member="rider_guest01"]').click();
  await expect(page.locator('[data-remove-ride-member="rider_guest01"]')).toHaveCount(0);
  await expect(page.locator('#rideRoster')).not.toContainText('Guest Rider');
  await expect(page.locator('#toast')).toContainText('removed from the ride');
});

test('PWA settings sheets own the bottom edge without competing with app chrome', async ({ page }, testInfo) => {
  await mockAuthenticatedApi(page, 'unknown');
  await page.goto('/#settings');
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));

  const nav = page.locator('.bottom-nav');
  const banner = page.locator('#movementSafetyBanner');
  const app = page.locator('#app');
  const settingsScreen = page.locator('[data-screen="settings"]');
  await expect(nav).toBeVisible();
  await expect(banner).toBeVisible();

  await page.locator('[data-sheet="privacy"]').click();
  await expect(page.locator('#sheetBackdrop')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/sheet-open/);
  await expect(app).toHaveAttribute('inert', '');
  await expect(nav).toBeHidden();
  await expect(banner).toBeHidden();
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
  const firstToggle = page.locator('.toggle-row').first();
  const toggleTitle = firstToggle.locator('strong');
  const toggleCaption = firstToggle.locator('.caption');
  await expect(toggleTitle).toHaveCSS('display', 'block');
  await expect(toggleCaption).toHaveCSS('display', 'block');
  const [toggleTitleBox, toggleCaptionBox] = await Promise.all([toggleTitle.boundingBox(), toggleCaption.boundingBox()]);
  expect(toggleTitleBox).not.toBeNull();
  expect(toggleCaptionBox).not.toBeNull();
  expect(toggleCaptionBox.y).toBeGreaterThanOrEqual(toggleTitleBox.y + toggleTitleBox.height);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-settings-privacy-sheet.png`),
    fullPage: true,
  });

  await page.locator('#closeSheet').click();
  await expect(page.locator('html')).not.toHaveClass(/sheet-open/);
  await expect(app).not.toHaveAttribute('inert', '');
  await expect(nav).toBeVisible();
  await expect(banner).toBeVisible();
});

test('PWA billing preview matches native plan content and account tier', async ({ page }) => {
  let profile = { ...PROFILE, zoneTier: 'premium' };
  const updates = [];

  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'GET') return { body: profile };
      if (request.method() === 'PUT') {
        const update = JSON.parse(request.postData() || '{}');
        updates.push(update);
        profile = { ...profile, ...update };
        return { body: profile };
      }
    }
    return null;
  });

  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/#settings');

  await expect(page.locator('#planSummary')).toHaveText('Premium plan · $4.99/mo');
  await expect(page.locator('#planPill')).toHaveText('Premium');

  await page.locator('[data-sheet="plans"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Plan and billing');
  await expect(page.locator('.billing-notice')).toContainText('cannot be purchased until verified App Store and Google Play billing is connected');
  await expect(page.locator('.billing-notice')).toContainText('does not collect card details');

  const free = page.locator('[data-plan-tier="free"]');
  const premium = page.locator('[data-plan-tier="premium"]');
  const premiumPlus = page.locator('[data-plan-tier="premium_plus"]');

  await expect(free).toContainText('Free');
  await expect(free).toContainText('1 mi zone radius');
  await expect(free.locator('.plan-pill')).toHaveText('Unavailable');

  await expect(premium).toContainText('$4.99/month');
  await expect(premium).toContainText('Wider net for group rides that spread out on the highway.');
  await expect(premium).toContainText('Everything in Free');
  await expect(premium).toContainText('Priority support');
  await expect(premium.locator('.plan-pill')).toHaveText('Current');

  await expect(premiumPlus).toContainText('$9.99/month');
  await expect(premiumPlus).toContainText('Widest range — for a convoy that has stretched way out.');
  await expect(premiumPlus).toContainText('Everything in Premium');
  await expect(premiumPlus).toContainText('Early access to new features');
  await expect(premiumPlus.locator('.plan-pill')).toHaveText('Unavailable');

  await page.locator('#returnToFreePlan').click();
  await expect.poll(() => updates).toEqual([{ zoneTier: 'free' }]);
  await expect(page.locator('#planSummary')).toHaveText('Free plan · No card on file');
  await expect(page.locator('#planPill')).toHaveText('Free');
  await expect(page.locator('[data-plan-tier="free"] .plan-pill')).toHaveText('Current');
  await expect(page.locator('#returnToFreePlan')).toHaveCount(0);
  await assertNoViewportOverflow(page);
});

test('PWA navigation preference offers Rider Comms, Google Maps, Waze and Apple Maps', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#settings');

  await page.locator('[data-sheet="navigation"]').click();
  const options = page.locator('[data-navigation-option]');
  await expect(options).toHaveCount(4);
  await expect(page.locator('[data-navigation-option="google_maps"]')).toHaveAttribute('aria-checked', 'true');

  await page.locator('[data-navigation-option="waze"]').click();
  await expect(page.locator('[data-navigation-option="waze"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#closeSheet').click();
  await expect(page.locator('#navigationProviderSummary')).toHaveText('Waze');

  await page.reload();
  await expect(page.locator('#navigationProviderSummary')).toHaveText('Waze');
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
    const nav = document.querySelector('.bottom-nav');
    const appBox = app.getBoundingClientRect();
    const navBox = nav.getBoundingClientRect();
    const navStyle = getComputedStyle(nav);
    return {
      appVh: root.style.getPropertyValue('--app-vh'),
      clientHeight: root.clientHeight,
      innerHeight: window.innerHeight,
      appPosition: getComputedStyle(app).position,
      appBottom: appBox.bottom,
      navPosition: navStyle.position,
      navBottom: navBox.bottom,
      navHeight: navBox.height,
      navPaddingBottom: parseFloat(navStyle.paddingBottom),
    };
  });

  expect(metrics.appVh).toBe('100vh');
  expect(metrics.innerHeight).toBeLessThan(metrics.clientHeight);
  expect(metrics.appPosition).toBe('fixed');
  expect(metrics.navPosition).toBe('absolute');
  expect(Math.abs(metrics.appBottom - metrics.clientHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.navBottom - metrics.clientHeight)).toBeLessThanOrEqual(1);
  expect(metrics.navHeight).toBe(58 + 34 + 1);
  expect(metrics.navPaddingBottom).toBe(34);
});

test('installed PWA tab rail keeps controls above the home indicator', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
  await mockAuthenticatedApi(page);
  await page.goto('/#settings');
  await waitForViewportSettled(page);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--bottom-safe-area', '34px');
  });

  const nav = page.locator('.bottom-nav');
  const activeButton = page.locator('.bottom-nav [data-nav="settings"]');
  const activeLabel = activeButton.locator('span');

  const [navBox, buttonBox, labelBox] = await Promise.all([
    nav.boundingBox(),
    activeButton.boundingBox(),
    activeLabel.boundingBox(),
  ]);
  const viewport = page.viewportSize();
  const chrome = await page.evaluate(() => {
    const root = document.documentElement;
    const nav = document.querySelector('.bottom-nav');
    return {
      navSafeBottom: getComputedStyle(root).getPropertyValue('--nav-safe-bottom').trim(),
      bottomControlInset: getComputedStyle(root).getPropertyValue('--bottom-control-inset').trim(),
      navigationControlInset: getComputedStyle(root).getPropertyValue('--navigation-control-inset').trim(),
      navHeight: getComputedStyle(nav).height,
      navPaddingBottom: getComputedStyle(nav).paddingBottom,
    };
  });

  expect(chrome.navSafeBottom).toBe('34px');
  expect(chrome.bottomControlInset).toBe('34px');
  expect(chrome.navigationControlInset).toBe('min(18px,34px)');
  expect(parseFloat(chrome.navHeight)).toBe(58 + 34 + 1);
  expect(parseFloat(chrome.navPaddingBottom)).toBe(34);

  expect(navBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);

  // The full-height app shell reaches the physical bottom immediately. Keep
  // the 58px interaction rail above the real 34px home-indicator safe area.
  expect(buttonBox.y).toBeGreaterThanOrEqual(navBox.y - 1);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(navBox.y + 59);
  expect(viewport.height - (buttonBox.y + buttonBox.height)).toBeGreaterThanOrEqual(34);
  expect(viewport.height - (buttonBox.y + buttonBox.height)).toBeLessThanOrEqual(36);
  const railBottom = navBox.y + 58;
  const labelBottomGap = railBottom - (labelBox.y + labelBox.height);
  // Visible controls sit near the safe boundary while the 58px button itself
  // remains entirely outside the home-indicator region.
  expect(labelBottomGap).toBeGreaterThanOrEqual(3);
  expect(labelBottomGap).toBeLessThanOrEqual(7);
});

test('PWA navigation summary extends through the installed iPhone bottom safe area', async ({ page }) => {
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
  });

  const summary = page.locator('#navSummary');
  const [summaryBox, viewport] = await Promise.all([
    summary.boundingBox(),
    Promise.resolve(page.viewportSize()),
  ]);
  const metrics = await summary.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: parseFloat(style.height),
      paddingBottom: parseFloat(style.paddingBottom),
    };
  });

  expect(summaryBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(metrics.height).toBe(88 + 18);
  expect(metrics.paddingBottom).toBe(18);
  await expect(page.locator('html')).toHaveClass(/pwa-standalone/);
  // Fractional device-scale rounding can move an absolutely positioned edge
  // a little over two CSS pixels on some Chromium/WebKit device profiles.
  // Three pixels still rejects any meaningful safe-area gap while avoiding
  // false failures from sub-pixel viewport quantisation.
  expect(Math.abs((summaryBox.y + summaryBox.height) - viewport.height)).toBeLessThanOrEqual(3);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-vh'))).toBe('100vh');
});

test('PWA Friends remains usable when realtime transport is temporarily unavailable', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => {
    if (url.pathname === '/social/events') return { status: 503, body: { error: 'temporarily_unavailable' } };
    return null;
  });
  await page.goto('/#friends');
  await expect(page.locator('#friendList [data-friend]')).toHaveCount(2);
  await expect(page.locator('#friendList')).toContainText('Maya');
  await expect(page.locator('#friendList')).toContainText('Jay');
});

test('PWA preserves backend avatar presets on friend surfaces', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#friends');

  const avatars = page.locator('#friendList .avatar');
  await expect(avatars).toHaveCount(2);
  await expect(avatars.nth(0)).toHaveCSS('--avatar', '#4C8BF5');
  await expect(avatars.nth(1)).toHaveCSS('--avatar', '#3DD68C');
});

test('PWA direct messages load, mark read and send within a friend-only thread', async ({ page }) => {
  const sent = [];
  const readMarks = [];
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/messages' && request.method() === 'GET') {
      expect(url.searchParams.get('withRiderId')).toBe('rider_friend01');
      return { body: { messages: [{ id: 'message-1', fromRiderId: 'rider_friend01', toRiderId: RIDER_ID, text: 'Meet at the petrol station?', createdAt: 1_700_000_000_000 }], nextCursor: null, peerReadThroughMessageId: null } };
    }
    if (url.pathname === '/messages/read' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      readMarks.push(body);
      return { body: { readThroughSeq: 1 } };
    }
    if (url.pathname === '/messages' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      sent.push(body);
      return { status: 201, body: { id: 'message-2', fromRiderId: RIDER_ID, toRiderId: body.toRiderId, text: body.text, createdAt: 1_700_000_001_000 } };
    }
    if (url.pathname === '/profiles/rider_friend01') return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    return null;
  });

  await page.goto('/#friends');
  await page.locator('[data-friend="rider_friend01"]').click();
  await page.locator('#messageFriend').click();
  await expect(page.locator('#chatScreen')).toBeVisible();
  await expect(page.locator('#chatMessages')).toContainText('Meet at the petrol station?');
  await expect.poll(() => readMarks).toContainEqual({ withRiderId: 'rider_friend01' });
  await page.locator('#chatInput').fill('On my way');
  await page.locator('#chatSend').click();
  await expect.poll(() => sent).toEqual([{ toRiderId: 'rider_friend01', text: 'On my way' }]);
  await expect(page.locator('#chatMessages')).toContainText('On my way');
  await expect(page.locator('#chatSafety')).toHaveAccessibleName('Report or block rider');
  await assertNoViewportOverflow(page);
});

test('PWA Hideouts can be loaded, created and deleted from a friend chat', async ({ page }) => {
  let hideouts = [
    {
      id: 'hideout-1',
      name: 'Petrol stop',
      lat: 51.5074,
      lon: -0.1278,
      createdBy: RIDER_ID,
      participantIds: ['rider_friend01'],
      createdAt: 1_700_000_000_000,
    },
    {
      id: 'hideout-unrelated',
      name: 'Other rider meeting point',
      lat: 51.52,
      lon: -0.11,
      createdBy: RIDER_ID,
      participantIds: ['rider_friend02'],
      createdAt: 1_700_000_000_500,
    },
  ];
  const created = [];

  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/messages' && request.method() === 'GET') {
      return { body: { messages: [], nextCursor: null } };
    }
    if (url.pathname === `/riders/${RIDER_ID}/hideouts` && request.method() === 'GET') {
      return { body: { hideouts } };
    }
    if (url.pathname === '/hideouts' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      created.push(body);
      const saved = {
        id: 'hideout-new',
        name: body.name,
        lat: body.lat,
        lon: body.lon,
        createdBy: RIDER_ID,
        participantIds: body.participantIds,
        createdAt: 1_700_000_001_000,
      };
      hideouts = [...hideouts, saved];
      return { status: 201, body: saved };
    }
    if (url.pathname === '/hideouts/hideout-1' && request.method() === 'DELETE') {
      hideouts = hideouts.filter((hideout) => hideout.id !== 'hideout-1');
      return { body: {} };
    }
    if (url.pathname === '/profiles/rider_friend01') {
      return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    }
    return null;
  });

  await page.goto('/#friends');
  await page.locator('[data-friend="rider_friend01"]').click();
  await page.locator('#messageFriend').click();

  await expect(page.locator('#chatHideouts')).toBeVisible();
  await expect(page.locator('#chatHideoutList')).toContainText('Petrol stop');
  await expect(page.locator('#chatHideoutList')).not.toContainText('Other rider meeting point');
  await expect(page.locator('[data-open-hideout="hideout-1"]')).toHaveText('Google Maps');

  await page.locator('#chatHideoutPlan').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Plan a hideout');
  await page.locator('#hideoutName').fill('Cafe meetup');
  await page.locator('#hideoutLat').fill('51.515');
  await page.locator('#hideoutLon').fill('-0.101');
  await page.locator('#saveHideoutBtn').click();

  await expect.poll(() => created).toEqual([{
    name: 'Cafe meetup',
    lat: 51.515,
    lon: -0.101,
    participantIds: ['rider_friend01'],
  }]);
  await expect(page.locator('#chatHideoutList')).toContainText('Cafe meetup');

  await page.locator('[data-delete-hideout="hideout-1"]').click();
  await expect(page.locator('#chatHideoutList')).not.toContainText('Petrol stop');
  await assertNoViewportOverflow(page);
});

test('@viewport PWA chat stays pinned to the visible viewport when the keyboard changes geometry', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const listeners = { resize: new Set(), scroll: new Set() };
    const viewport = {
      height: window.innerHeight,
      offsetTop: 0,
      addEventListener(type, listener) { listeners[type]?.add(listener); },
      removeEventListener(type, listener) { listeners[type]?.delete(listener); },
    };
    let rootScrollY = 0;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => rootScrollY });
    window.__setRiderTestRootScrollY = (value) => {
      rootScrollY = value;
      window.dispatchEvent(new Event('scroll'));
    };
    window.__setRiderTestVisualViewport = (height, offsetTop = 0) => {
      viewport.height = height;
      viewport.offsetTop = offsetTop;
      listeners.resize.forEach((listener) => listener(new Event('resize')));
      listeners.scroll.forEach((listener) => listener(new Event('scroll')));
    };
  });

  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/messages' && request.method() === 'GET') {
      return { body: { messages: [], nextCursor: null } };
    }
    if (url.pathname === `/riders/${RIDER_ID}/hideouts` && request.method() === 'GET') {
      return { body: { hideouts: [] } };
    }
    if (url.pathname === '/profiles/rider_friend01') {
      return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    }
    return null;
  });

  await page.goto('/#friends');
  const baselineNavBox = await page.locator('.bottom-nav').boundingBox();
  await page.locator('[data-friend="rider_friend01"]').click();
  await page.locator('#messageFriend').click();
  await expect(page.locator('#chatScreen')).toBeVisible();
  await expect(page.locator('#chatInput')).not.toBeFocused();
  await expect(page.locator('body')).toHaveCSS('position', 'fixed');

  await page.evaluate(() => document.documentElement.style.setProperty('--bottom-safe-area', '34px'));
  const closedComposerPaddingBottom = await page.locator('#chatComposer').evaluate((element) => getComputedStyle(element).paddingBottom);
  expect(parseFloat(closedComposerPaddingBottom)).toBe(44);

  const initialViewportHeight = await page.evaluate(() => window.innerHeight);
  const keyboardViewportHeight = Math.max(220, Math.round(initialViewportHeight * 0.58));
  const keyboardOffsetTop = Math.min(64, Math.round(initialViewportHeight * 0.08));
  await page.evaluate(({ height, offsetTop }) => {
    window.__setRiderTestVisualViewport(height, offsetTop);
  }, { height: keyboardViewportHeight, offsetTop: keyboardOffsetTop });

  await expect(page.locator('html')).toHaveClass(/keyboard-open/);
  await expect(page.locator('#chatHideouts')).toBeHidden();

  // Model the installed-iOS failure seen on-device: WebKit pans the document
  // itself while leaving visualViewport.offsetTop at zero. The app must
  // detect that root pan and compensate the chat surface instead of letting
  // the header disappear above the status bar and leaving a gap by keyboard.
  await page.evaluate(() => window.__setRiderTestRootScrollY(84));
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--chat-root-pan')
  )).toBe('84px');
  await page.evaluate(() => window.__setRiderTestRootScrollY(0));
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--chat-root-pan')
  )).toBe('0px');

  await expect.poll(async () => {
    const box = await page.locator('#chatScreen').boundingBox();
    return box ? Math.round(box.y) : -1;
  }).toBe(keyboardOffsetTop);

  const [chatBox, headerBox, composerBox] = await Promise.all([
    page.locator('#chatScreen').boundingBox(),
    page.locator('.chat-header').boundingBox(),
    page.locator('#chatComposer').boundingBox(),
  ]);
  expect(chatBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(Math.abs(chatBox.height - keyboardViewportHeight)).toBeLessThanOrEqual(1);
  expect(headerBox.y).toBeGreaterThanOrEqual(chatBox.y - 1);
  const composerBottomGap = (chatBox.y + chatBox.height) - (composerBox.y + composerBox.height);
  // A keyboard-open WebKit viewport may let the composer extend into the
  // system-owned home-indicator remainder. It must never leave a positive
  // blank band, and any overlap must stay within the modelled 34px safe area.
  expect(composerBottomGap).toBeLessThanOrEqual(1);
  expect(composerBottomGap).toBeGreaterThanOrEqual(-34);
  const openComposerPaddingBottom = await page.locator('#chatComposer').evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom));
  expect(openComposerPaddingBottom).toBe(10);
  await expect(page.locator('.bottom-nav')).toHaveCSS('visibility', 'hidden');

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-chat-keyboard-viewport.png`),
    clip: {
      x: Math.max(0, chatBox.x),
      y: Math.max(0, chatBox.y),
      width: chatBox.width,
      height: chatBox.height,
    },
  });

  await page.evaluate(({ height }) => {
    window.__setRiderTestVisualViewport(height, 0);
  }, { height: initialViewportHeight });

  await expect(page.locator('html')).not.toHaveClass(/keyboard-open/);
  await expect(page.locator('body')).toHaveCSS('position', 'fixed');
  await expect.poll(async () => {
    const box = await page.locator('#chatScreen').boundingBox();
    return box ? Math.round(box.y + box.height) : -1;
  }).toBe(initialViewportHeight);

  // Repeat the same open/dismiss transition in one page session. WebKit has
  // historically retained a shrunken viewport after the first keyboard, so a
  // single cycle is not a sufficient regression check.
  await page.evaluate(({ height, offsetTop }) => {
    window.__setRiderTestVisualViewport(height, offsetTop);
  }, { height: keyboardViewportHeight, offsetTop: keyboardOffsetTop });
  await expect(page.locator('html')).toHaveClass(/keyboard-open/);
  await page.evaluate(({ height }) => {
    window.__setRiderTestVisualViewport(height, 0);
  }, { height: initialViewportHeight });
  await expect(page.locator('html')).not.toHaveClass(/keyboard-open/);
  await expect.poll(async () => {
    const box = await page.locator('#chatScreen').boundingBox();
    return box ? Math.round(box.y + box.height) : -1;
  }).toBe(initialViewportHeight);

  await page.locator('#chatBack').click();
  await expect(page.locator('#chatScreen')).toBeHidden();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  const restoredNavBox = await page.locator('.bottom-nav').boundingBox();
  expectNear(restoredNavBox.y + restoredNavBox.height, baselineNavBox.y + baselineNavBox.height);
});

test('PWA profile avatar selection persists and updates visible avatars', async ({ page }) => {
  let savedAvatar = 'ember';
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (request.method() === 'PUT' && url.pathname === `/riders/${RIDER_ID}/profile`) {
      const body = JSON.parse(request.postData() || '{}');
      if (typeof body.avatarId === 'string') savedAvatar = body.avatarId;
      return { body: { ...PROFILE, avatarId: savedAvatar } };
    }
    return null;
  });

  await page.goto('/#settings');
  await page.locator('#editProfileBtn').click();
  await expect(page.locator('[data-avatar-option="ember"]')).toHaveAttribute('aria-checked', 'true');

  await page.locator('[data-avatar-option="rose"]').click();
  await expect.poll(() => savedAvatar).toBe('rose');
  await expect(page.locator('[data-avatar-option="rose"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-avatar]').first()).toHaveCSS('--avatar', '#EC4899');
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
    expectNear(geometry.navBottom, geometry.appBottom);
    expectNear(geometry.navHeight, 58 + safeBottom + 1);
    expect(geometry.navPaddingBottom).toBeGreaterThanOrEqual(safeBottom);
    expect(geometry.railBottom).toBeLessThanOrEqual(geometry.appBottom - safeBottom + 1);
    expectNear(geometry.mapBottom, geometry.navTop);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  }

  await setSyntheticSafeArea(page, 34);
  const captureEvidence = /iphone-17-pro-max|pixel-chromium|iphone-landscape|ipad-webkit/.test(testInfo.project.name);
  const screens = [
    ['map', '#mapCanvas'],
    ['ride', '#joinRideForm .ride-location-consent'],
    ['routes', '#curatedRouteList'],
    ['friends', '#friendList'],
    ['settings', '.version'],
  ];

  for (const [name, finalSelector] of screens) {
    await page.locator(`.bottom-nav [data-nav="${name}"]`).click();
    const screen = page.locator(`.screen[data-screen="${name}"]`);
    await expect(screen).toBeVisible();

    if (name === 'friends') {
      await page.evaluate(() => {
        const list = document.querySelector('#friendList');
        const source = list?.firstElementChild;
        if (!list || !source) return;
        for (let index = 0; index < 16; index += 1) {
          const clone = source.cloneNode(true);
          clone.dataset.friend = `viewport-friend-${index}`;
          list.append(clone);
        }
      });
    }

    const final = name === 'routes'
      ? page.locator('[data-curated-route]').last()
      : name === 'friends'
        ? page.locator('#friendList > *').last()
        : page.locator(finalSelector).last();
    if (name === 'map') {
      const mapGeometry = await standaloneGeometry(page);
      expectNear(mapGeometry.mapBottom, mapGeometry.navTop);
    } else {
      await final.scrollIntoViewIfNeeded();
      await screen.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const [finalBox, navBox] = await Promise.all([final.boundingBox(), page.locator('.bottom-nav').boundingBox()]);
      expect(finalBox, `${name} final element has no geometry`).not.toBeNull();
      expect(navBox).not.toBeNull();
      expect(finalBox.y + finalBox.height, `${name} final element must clear persistent navigation`).toBeLessThanOrEqual(navBox.y + 1);
    }
    await assertNoViewportOverflow(page);

    if (captureEvidence) {
      await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-${name}-viewport.png`) });
    }
  }

  await page.locator('.bottom-nav [data-nav="map"]').click();
  const baseline = await standaloneGeometry(page);
  await page.evaluate(() => {
    document.querySelector('#movementSafetyBanner').hidden = false;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitForViewportSettled(page);
  const resumed = await standaloneGeometry(page);
  expectNear(resumed.appBottom, baseline.appBottom);
  expectNear(resumed.navBottom, baseline.navBottom);
  // Chromium on fractional-DPR Android devices can round the fixed nav and\n  // map inset to adjacent device pixels. Keep this seam within 2 CSS px while\n  // the stricter app/nav bottom assertions above remain unchanged.\n  expectNear(resumed.mapBottom, resumed.navTop, 2);

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
    expectNear(roundTrip.navBottom, baseline.navBottom);
    expectNear(roundTrip.mapBottom, roundTrip.navTop);
  }
});

test('@viewport full-screen overlays and sheets share the stable standalone bottom edge', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await installStandaloneFixture(page);
  await mockAuthenticatedApi(page, 'unknown');
  await page.goto('/#settings');
  await waitForViewportSettled(page);
  await setSyntheticSafeArea(page, 50);

  const app = page.locator('#app');
  const nav = page.locator('.bottom-nav');
  const appBottom = (await app.boundingBox()).y + (await app.boundingBox()).height;
  const baselineNavBottom = (await nav.boundingBox()).y + (await nav.boundingBox()).height;
  const captureEvidence = /iphone-17-pro-max|pixel-chromium|iphone-landscape|ipad-webkit/.test(testInfo.project.name);

  const assertSheet = async (screenshotName) => {
    const backdrop = page.locator('#sheetBackdrop');
    const sheet = page.locator('.sheet');
    await expect(page.locator('html')).toHaveClass(/sheet-open/);
    await expect(app).toHaveAttribute('inert', '');
    await expect(nav).toBeHidden();
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
    await page.locator('#closeSheet').click();
    await expect(page.locator('html')).not.toHaveClass(/sheet-open/);
    await expect(app).not.toHaveAttribute('inert', '');
    await expect(nav).toBeVisible();
    const restoredNav = await nav.boundingBox();
    expectNear(restoredNav.y + restoredNav.height, baselineNavBottom);
  };

  await page.locator('#editProfileBtn').click();
  await assertSheet('edit-profile-sheet');
  for (const [type, name] of [['map', 'location-map-sheet'], ['navigation', 'navigation-sheet'], ['plans', 'plan-sheet']]) {
    await page.locator(`[data-sheet="${type}"]`).click();
    await assertSheet(name);
  }
  // Repeat a sheet transition to catch accumulated bottom offsets.
  await page.locator('[data-sheet="map"]').click();
  await assertSheet('location-map-sheet-repeat');

  await page.locator('.bottom-nav [data-nav="friends"]').click();
  await page.locator('[data-friend="rider_friend01"]').click();
  await assertSheet('friend-detail-sheet');

  await page.locator('.bottom-nav [data-nav="map"]').click();
  await page.locator('#movementSafetyBanner').evaluate((element) => { element.hidden = true; });
  await page.locator('#mapSearchSlot').click();
  const searchBox = await page.locator('#searchScreen').boundingBox();
  expectNear(searchBox.y + searchBox.height, appBottom);
  await page.locator('#searchScreenBack').click();

  await page.locator('.bottom-nav [data-nav="routes"]').click();
  await page.locator('[data-curated-route]').first().click();
  const routeBackdrop = page.locator('.route-detail-backdrop');
  const routeBox = await routeBackdrop.boundingBox();
  expectNear(routeBox.y + routeBox.height, appBottom);
  const routePadding = await page.locator('.route-detail-body').evaluate((element) => parseFloat(getComputedStyle(element).paddingBottom));
  expect(routePadding).toBeGreaterThanOrEqual(50);
  await page.locator('.route-detail-close').click();
  await assertNoViewportOverflow(page);
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
  await page.locator('[data-sheet="sessions"]').click();
  await expect(page.locator('#sessionList')).toContainText('Other phone');
  await page.locator('[data-revoke-session="session-remote"]').click();
  await expect(page.locator('#sessionList')).not.toContainText('Other phone');
  expect(remoteRevoked).toBe(true);

  await page.locator('#closeSheet').click();
  await page.locator('[data-sheet="account"]').click();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.evaluate(() => {
    document.querySelector('#deleteAccountBtn')?.click();
  });
  await expect.poll(() => accountDeleted).toBe(true);
});

test('PWA recent place history is scoped to the signed-in rider', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.addInitScript(({ riderId }) => {
    localStorage.setItem('riderComms.recentSearches', JSON.stringify([
      { placeId: 'legacy', name: 'Other account place', secondary: 'Should not appear', lat: 51.4, lng: -0.2 },
    ]));
    localStorage.setItem(`riderComms.recentSearches:${riderId}`, JSON.stringify([
      { placeId: 'mine', name: 'My recent place', secondary: 'Account scoped', lat: 51.5, lng: -0.1 },
    ]));
  }, { riderId: RIDER_ID });

  await page.goto('/');
  await page.locator('#mapSearchSlot').click();
  await expect(page.locator('#searchScreenResults')).toContainText('My recent place');
  await expect(page.locator('#searchScreenResults')).not.toContainText('Other account place');
  await page.locator('#searchRecentClearBtn').click();
  await expect(page.locator('#searchScreenResults')).not.toContainText('My recent place');
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
