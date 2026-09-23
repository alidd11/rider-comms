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
    localStorage.setItem('rider-comms-session-v1', JSON.stringify({ riderId, token: 'visual-test-token', emailVerified: true }));
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
    if (url.pathname === '/auth/me') body = { riderId: RIDER_ID, emailVerified: true };
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
        RenderingType: { VECTOR: 'VECTOR', RASTER: 'RASTER' },
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

test('login baseline matches the approved night-rider concept in day and night', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Login baseline screenshots target iPhone 17 Pro Max geometry.');

  for (const scheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-top', '59px'));

    await expect(page.locator('#authScreen')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();

    // Capture the separate branded entry state without coupling this visual
    // audit to WebKit timer scheduling. The production splash still auto-hides
    // after its brief cold-start dwell; the test owns visibility deterministically.
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
    await expect(page.locator('#authDescription')).toHaveText('Good to see you again.');
    await expect(page.locator('#loginForm')).toBeVisible();
    await expect(page.locator('#signupForm')).toBeHidden();
    await expect(page.locator('.auth-segmented')).toBeHidden();
    await expect(page.locator('#authLoginExtras')).toBeVisible();
    await expect(page.locator('.auth-social-row button')).toHaveCount(3);
    for (const provider of await page.locator('.auth-social-row button').all()) await expect(provider).toBeDisabled();
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
      const social = document.querySelector('.auth-social-row').getBoundingClientRect();
      const terms = document.querySelector('.auth-terms').getBoundingClientRect();
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
        socialWidth: social.width,
        termsTop: terms.top,
        viewportHeight: window.innerHeight,
      };
    });

    expect(visual.screenBackground).toBe('rgb(3, 9, 11)');
    expect(visual.backgroundImage).toContain('photo-1552306062-29a5560e1c31');
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
    expect(visual.socialWidth).toBeGreaterThan(120);
    expect(visual.termsTop).toBeLessThan(visual.viewportHeight);
    expect(visual.termsTop).toBeGreaterThan(visual.introTop);

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
    await page.locator('.bottom-nav [data-nav="ride"]').click();
    await expect(page.locator('#rideJoinState')).toBeVisible();
    await page.locator('[data-screen="ride"]').evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await expect(page.locator('#rideTitle')).toBeVisible();
    await expect(page.locator('.ride-hero')).toBeVisible();
    await expect(page.locator('#joinRideForm')).toBeVisible();
    await expect(page.locator('#rideHostMode')).toBeVisible();
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
      const start = screen.querySelector('.ride-start-row');
      const nav = document.querySelector('.bottom-nav');
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
        startRadius: parseFloat(getComputedStyle(start).borderTopLeftRadius),
        startBottom: box(start).bottom,
        navTop: box(nav).top,
        viewportWidth: window.innerWidth,
        navGap: box(nav).top - box(start).bottom,
      };
    });

    expect(visual.headerTop).toBeGreaterThanOrEqual(visual.screenTop + 70);
    expect(visual.headerHeight).toBeGreaterThan(24);
    expect(visual.titleWidth).toBeGreaterThan(40);
    expect(visual.heroTop).toBeGreaterThan(visual.titleBottom);
    expect(visual.heroLeft).toBeGreaterThanOrEqual(18);
    expect(visual.heroWidth).toBeLessThanOrEqual(visual.viewportWidth - 36);
    expect(visual.heroHeight).toBeGreaterThanOrEqual(190);
    expect(visual.heroHeight).toBeLessThanOrEqual(235);
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
    expect(visual.startHeight).toBeLessThanOrEqual(60);
    expect(visual.startRadius).toBeLessThanOrEqual(4);
    expect(visual.startBottom).toBeLessThanOrEqual(visual.navTop + 2);
    expect(visual.navGap).toBeGreaterThanOrEqual(0);
    expect(visual.navGap).toBeLessThanOrEqual(360);

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

  const mapGeometry = await page.evaluate(() => {
    const screen = document.querySelector('[data-screen="map"]');
    const canvas = document.querySelector('#mapCanvas');
    const search = document.querySelector('#mapSearchSlot');
    const action = document.querySelector('.map-actions .icon-button');
    const report = document.querySelector('#reportHazardBtn');
    const locate = document.querySelector('#locateBtn');
    const nearby = document.querySelector('#joinNearbyBtn');
    const avatarButton = document.querySelector('#mapAvatarButton');
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
      actionRadius: action ? getComputedStyle(action).borderTopLeftRadius : null,
      reportWidth: report?.getBoundingClientRect().width ?? NaN,
      locateWidth: locate?.getBoundingClientRect().width ?? NaN,
      nearbyWidth: nearby?.getBoundingClientRect().width ?? NaN,
      reportTransform: report ? getComputedStyle(report).transform : null,
      locateTransform: locate ? getComputedStyle(locate).transform : null,
      firstGap: report && locate ? locate.getBoundingClientRect().top - report.getBoundingClientRect().bottom : NaN,
      secondGap: locate && nearby ? nearby.getBoundingClientRect().top - locate.getBoundingClientRect().bottom : NaN,
      avatarDisplay: avatarButton ? getComputedStyle(avatarButton).display : null,
      optionsGlyphWidth: optionsGlyph?.getBoundingClientRect().width ?? NaN,
      mapTypeId: window.__riderCommsTestMap?.options?.mapTypeId ?? null,
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
  expect(mapGeometry.actionRadius).toBe('50%');
  expect(mapGeometry.reportWidth).toBe(54);
  expect(mapGeometry.locateWidth).toBe(54);
  expect(mapGeometry.nearbyWidth).toBe(54);
  expect(mapGeometry.reportTransform).toBe('none');
  expect(mapGeometry.locateTransform).toBe('none');
  expectNear(mapGeometry.firstGap, 8);
  expectNear(mapGeometry.secondGap, 8);
  expect(mapGeometry.avatarDisplay).toBe('none');
  expect(mapGeometry.optionsGlyphWidth).toBeGreaterThanOrEqual(16);
  expect(mapGeometry.mapTypeId).toBe('roadmap');
  expect(mapGeometry.mapColorScheme).toBe('FOLLOW_SYSTEM');
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
  await expect.poll(() => page.locator('#reportHazardBtn').evaluate((button) => getComputedStyle(button).backgroundColor))
    .toMatch(/255, 255, 255/);
  await expect.poll(() => page.locator('#locateBtn').evaluate((button) => getComputedStyle(button).backgroundColor))
    .toMatch(/255, 255, 255/);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-map-light-final.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });

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
  expect(rideGeometry.hero.height).toBeGreaterThanOrEqual(190);
  expect(rideGeometry.hero.height).toBeLessThanOrEqual(235);
  expect(rideGeometry.hero.width).toBeLessThan(rideGeometry.viewportWidth - 30);
  expect(rideGeometry.hero.top).toBeGreaterThan(rideGeometry.title.bottom);
  expect(Math.abs(rideGeometry.joinCard.width - rideGeometry.hero.width)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-ride-final.png'), fullPage: true });

  await page.locator('.bottom-nav [data-nav="routes"]').click();
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

  await page.locator('.bottom-nav [data-nav="friends"]').click();
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
  await expect(page.locator('#shareFriendLocation')).toContainText('Share to Ride');
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
      closeRadius: close ? parseFloat(getComputedStyle(close).borderTopLeftRadius) : NaN,
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
  expect(friendDetailGeometry.closeRadius).toBeGreaterThanOrEqual(19);
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
  await expect(page.locator('[data-report-rider]')).toHaveCount(3);
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

  await page.locator('.bottom-nav [data-nav="settings"]').click();
  await expect(page.locator('.settings-page')).toBeVisible();
  await expect(page.locator('[data-screen="settings"] .page-subtitle')).toHaveCount(0);
  await expect(page.locator('[data-sheet="offlineMaps"] small')).toHaveText('Online only · downloads unavailable');
  const settingsRadius = await page.locator('.settings-page .settings-group').first().evaluate((element) =>
    parseFloat(getComputedStyle(element).borderTopLeftRadius)
  );
  expect(settingsRadius).toBeGreaterThanOrEqual(7);
  expect(settingsRadius).toBeLessThanOrEqual(9);
  await page.screenshot({ path: testInfo.outputPath('iphone-17-pro-max-settings-final.png'), fullPage: true });
  await assertNoViewportOverflow(page);
});


test('friend profile exposes only fresh consented private-ride location actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Friend-profile mockup screenshot targets iPhone 17 Pro Max geometry.');

  const rideId = 'ride_visual01';
  const friendLocation = { riderId: 'rider_friend01', lat: 51.5142, lon: -0.1183, updatedAt: Date.now() };
  const ride = {
    rideId,
    createdBy: RIDER_ID,
    createdAt: Date.now() - 60_000,
    memberIds: [RIDER_ID, 'rider_friend01'],
    shareRideLocation: true,
    code: 'RIDE01',
  };
  let rideLocationReads = 0;

  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/rides/current') return { body: { ride } };
    if (url.pathname === `/rides/${rideId}` && request.method() === 'GET') return { body: ride };
    if (url.pathname === `/rides/${rideId}/locations`) {
      rideLocationReads += 1;
      return {
        body: {
          locations: [
            { riderId: RIDER_ID, lat: 51.5074, lon: -0.1278, updatedAt: Date.now() },
            { ...friendLocation, updatedAt: Date.now() },
          ],
        },
      };
    }
    if (url.pathname === `/profiles/${RIDER_ID}`) {
      return { body: { riderId: RIDER_ID, displayName: PROFILE.displayName, handle: PROFILE.handle, avatarId: PROFILE.avatarId, instagramUsername: '', tiktokUsername: '' } };
    }
    if (url.pathname === '/profiles/rider_friend01') {
      return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge', instagramUsername: '', tiktokUsername: '' } };
    }
    if (url.pathname === '/friends/activity') {
      return { body: { activity: [{ riderId: 'rider_friend01', online: true, lastSeenAt: Date.now() }] } };
    }
    return null;
  });

  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect.poll(() => page.locator('#activeRideLocationConsent').isChecked()).toBe(true);
  await expect.poll(() => rideLocationReads).toBeGreaterThan(0);

  await page.locator('.bottom-nav [data-nav="friends"]').click();
  await page.locator('#friendList [data-friend="rider_friend01"]').click();
  await expect(page.locator('.friend-profile-card')).toBeVisible();
  await expect(page.locator('#shareFriendId')).toHaveCount(0);
  await expect(page.locator('#shareFriendLocation')).toBeEnabled();
  await expect(page.locator('#shareFriendLocation')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#shareFriendLocation')).toContainText('Share to Ride');
  await expect(page.locator('#shareFriendLocation')).toHaveAttribute('aria-label', 'Stop sharing your location with this group ride');
  await expect(page.locator('#shareFriendLocation')).toHaveAttribute('title', 'Shares your location with everyone in your current group ride, not just this rider.');
  await expect(page.locator('#friendMapAction')).toBeEnabled();
  await expect(page.locator('.friend-profile-detail-list')).toContainText('Location');
  await expect(page.locator('.friend-profile-detail-list')).toContainText('Shared in your current ride');
  await expect(page.locator('.friend-profile-detail-list')).toContainText('Group ride');
  await expect(page.locator('.friend-profile-detail-list')).toContainText('2 riders');
  await expect(page.locator('#viewFriendOnMap')).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath('iphone-17-pro-max-friend-detail-shared-ride.png'),
    fullPage: true,
  });

  await page.locator('#friendMapAction').click();
  await expect(page.locator('[data-screen="map"]')).toHaveClass(/active/);
  await expect.poll(async () => page.evaluate(() => {
    const centre = window.__riderCommsTestMap?.centre;
    return centre ? [centre.lat, centre.lng] : null;
  })).toEqual([friendLocation.lat, friendLocation.lon]);
});

test('PWA route discovery previews route shape and hands the start back to the map', async ({ page }, testInfo) => {
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

test('PWA clears persisted Nearby live state instead of auto-rejoining after reload', async ({ page }) => {
  let presenceUpdates = 0;
  let presenceDeletes = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) return { body: { ...PROFILE, shareLocation: true } };
    if (url.pathname === '/presence' && request.method() === 'POST') presenceUpdates += 1;
    if (url.pathname === '/presence' && request.method() === 'DELETE') {
      presenceDeletes += 1;
      return { body: {} };
    }
    return null;
  });
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ screen: 'map', profile, publicLive: true }));
  }, { riderId: RIDER_ID, profile: { ...PROFILE, shareLocation: true } });
  await page.goto('/');
  await expect.poll(() => presenceDeletes).toBeGreaterThan(0);
  expect(presenceUpdates).toBe(0);
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'false');
  const cached = await page.evaluate((riderId) =>
    JSON.parse(localStorage.getItem(`rider-comms-pwa-v4:${riderId}`) || '{}'), RIDER_ID);
  expect(cached.publicLive).toBe(false);
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
      realSetInterval(handler, timeout === 8_000 ? 300 : timeout, ...args);

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

test('PWA public voice fails closed when proximity authorization cannot be renewed', async ({ page }) => {
  let shareLocation = false;
  let voiceTokenRequests = 0;

  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
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
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      voiceTokenRequests += 1;
      if (voiceTokenRequests > 1) {
        return { status: 503, body: { error: 'voice_temporarily_unavailable' } };
      }
      return {
        body: {
          connections: [{ peerId: 'rider_peer01', token: 'leased-peer-token', url: 'wss://voice.example.test' }],
          refreshAfterMs: 20_000,
          authorizationLeaseMs: 600,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (handler, timeout = 0, ...args) =>
      realSetTimeout(handler, timeout === 20_000 ? 150 : timeout, ...args);

    window.__publicVoiceDisconnects = 0;
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
          this.localParticipant = { setMicrophoneEnabled: async () => {} };
        }
        on() { return this; }
        async connect() {}
        async startAudio() {}
        async disconnect() { window.__publicVoiceDisconnects += 1; }
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
  await expect(voice).toHaveAttribute('aria-label', 'Listening — hands-free');
  await expect.poll(() => voiceTokenRequests).toBeGreaterThanOrEqual(2);

  // A transient refresh miss keeps the still-valid pair alive until the
  // server-provided authorization lease expires.
  await expect.poll(() => page.evaluate(() => window.__publicVoiceDisconnects), { timeout: 400 }).toBe(0);

  // Token expiry alone does not eject a connected LiveKit participant.
  // Rider Comms must therefore mute/disconnect the pair itself once it can no
  // longer re-confirm current proximity/block authorization.
  await expect.poll(() => page.evaluate(() => window.__publicVoiceDisconnects), { timeout: 1_500 }).toBeGreaterThanOrEqual(1);
  await expect(voice).toHaveAttribute('aria-label', 'Nearby Voice · reconnecting');
  await expect(nearby).toHaveAttribute('data-active', 'true');
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

test('PWA coalesces overlapping Nearby Voice authorization refreshes', async ({ page }) => {
  let shareLocation = false;
  let voiceTokenRequests = 0;
  let presenceUpdates = 0;
  let releaseFirstToken;
  const firstTokenGate = new Promise((resolve) => { releaseFirstToken = resolve; });

  await mockAuthenticatedApi(page, 'stationary', async ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') shareLocation = update.shareLocation;
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      presenceUpdates += 1;
      const peerVisible = presenceUpdates % 2 === 1;
      return {
        body: {
          inZoneWith: peerVisible ? ['rider_peer01'] : [],
          transitions: [{ a: RIDER_ID, b: 'rider_peer01', type: peerVisible ? 'entered' : 'left' }],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      voiceTokenRequests += 1;
      if (voiceTokenRequests === 1) await firstTokenGate;
      return {
        body: {
          connections: [{ peerId: 'rider_peer01', token: `peer-token-${voiceTokenRequests}`, url: 'wss://voice.example.test' }],
          refreshAfterMs: 20_000,
          authorizationLeaseMs: 60_000,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    const realSetInterval = window.setInterval.bind(window);
    window.setInterval = (handler, timeout = 0, ...args) =>
      realSetInterval(handler, timeout === 8_000 ? 75 : timeout, ...args);

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
  await page.locator('#joinNearbyBtn').click();
  await expect.poll(() => voiceTokenRequests).toBe(1);

  // Presence keeps refreshing while the first token request is deliberately
  // blocked. Those refreshes must collapse into one pending replay instead of
  // constructing multiple LiveKit pair rooms for the same peer.
  await page.waitForTimeout(250);
  expect(voiceTokenRequests).toBe(1);

  releaseFirstToken();
  await expect.poll(() => voiceTokenRequests).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.__nearbyVoiceRoomsCreated)).toBe(1);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__nearbyVoiceRoomsCreated)).toBe(1);
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

test('PWA clears stale Nearby state without restoring public presence on reload', async ({ page }) => {
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

test('PWA Settings matches the approved shallow mockup hierarchy', async ({ page }, testInfo) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#settings');

  await expect(page.locator('.settings-page .group-title')).toHaveCount(0);
  await expect(page.locator('.settings-main-group > button')).toHaveCount(5);
  await expect(page.locator('.settings-secondary-group > button')).toHaveCount(2);
  await expect(page.locator('.settings-main-group')).toContainText('Account');
  await expect(page.locator('.settings-main-group')).toContainText('Communication');
  await expect(page.locator('.settings-main-group')).toContainText('Map & Navigation');
  await expect(page.locator('.settings-main-group')).toContainText('Offline Maps');
  await expect(page.locator('.settings-main-group')).toContainText('Units & Preferences');
  await expect(page.locator('.settings-secondary-group')).toContainText('Help & Support');
  await expect(page.locator('.settings-secondary-group')).toContainText('About');
  await expect(page.locator('#logoutBtn')).toHaveText('Sign Out');
  await expect(page.locator('#logoutBtn > svg')).toHaveCount(0);

  const profile = await page.locator('.settings-profile-row').evaluate((element) => {
    const style = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height, radius: parseFloat(style.borderTopLeftRadius) };
  });
  expect(profile.height).toBeGreaterThanOrEqual(96);
  expect(profile.height).toBeLessThanOrEqual(108);
  expect(profile.radius).toBeGreaterThanOrEqual(7);

  await page.locator('[data-sheet="offlineMaps"]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Offline Maps');
  await expect(page.locator('#sheetBody')).toContainText('Offline map downloads are not available in this build yet.');
  await page.locator('#closeSheet').click();

  await page.locator('[data-sheet="about"]').click();
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
  const banner = page.locator('#movementSafetyBanner');
  const app = page.locator('#app');
  const settingsScreen = page.locator('[data-screen="settings"]');
  await expect(nav).toBeVisible();
  await expect(banner).toBeVisible();

  await page.locator('[data-sheet="communication"]').click();
  await page.locator('[data-settings-target="privacy"]').click();
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

  await page.locator('[data-sheet="accountHub"]').click();
  await expect(page.locator('#planSummary')).toHaveText('Premium plan · $4.99/mo');
  await expect(page.locator('#planPill')).toHaveText('Premium');

  await page.locator('[data-settings-target="plans"]').click();
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
  await expect(page.locator('[data-plan-tier="free"] .plan-pill')).toHaveText('Current');
  await expect(page.locator('#returnToFreePlan')).toHaveCount(0);
  await page.locator('#closeSheet').click();
  await page.locator('[data-sheet="accountHub"]').click();
  await expect(page.locator('#planSummary')).toHaveText('Free plan · No card on file');
  await expect(page.locator('#planPill')).toHaveText('Free');
  await assertNoViewportOverflow(page);
});

test('PWA navigation preference offers Rider Comms, Google Maps, Waze and Apple Maps', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#settings');

  await page.locator('[data-sheet="mapNavigation"]').click();
  await page.locator('[data-settings-target="navigation"]').click();
  const options = page.locator('[data-navigation-option]');
  await expect(options).toHaveCount(4);
  await expect(page.locator('[data-navigation-option="google_maps"]')).toHaveAttribute('aria-checked', 'true');

  await page.locator('[data-navigation-option="waze"]').click();
  await expect(page.locator('[data-navigation-option="waze"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#closeSheet').click();
  await page.locator('[data-sheet="mapNavigation"]').click();
  await expect(page.locator('#navigationProviderSummary')).toHaveText('Waze');
  await page.locator('#closeSheet').click();

  await page.reload();
  await page.locator('[data-sheet="mapNavigation"]').click();
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
    const report = document.querySelector('#reportHazardBtn');
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
      endRadius: end ? parseFloat(getComputedStyle(end).borderTopLeftRadius) : 0,
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
  expect(metrics.endRadius).toBeGreaterThanOrEqual(20);
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
  expect(metrics.nextHeight).toBeGreaterThanOrEqual(50);
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

  await page.goto('/#settings');
  await page.locator('#editProfileBtn').click();
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
    // Chromium at fractional DPR can also quantize the fixed map/nav seam to
    // the adjacent device pixel. Keep that seam within 2 CSS px while still
    // requiring the fixed app/nav bottom edges above to use the stricter bound.
    expectNear(geometry.mapBottom, geometry.navTop, 2);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  }

  await setSyntheticSafeArea(page, 34);
  const captureEvidence = /iphone-17-pro-max|pixel-chromium|iphone-landscape|ipad-webkit/.test(testInfo.project.name);
  const screens = [
    ['map', '#mapCanvas'],
    ['ride', '#joinRideForm .ride-location-consent'],
    ['routes', '#curatedRouteList'],
    ['friends', '#friendList'],
    ['settings', '.settings-signout'],
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

  await page.locator('[data-sheet="mapNavigation"]').click();
  await page.locator('[data-settings-target="map"]').click();
  await assertSheet('location-map-sheet');

  await page.locator('[data-sheet="mapNavigation"]').click();
  await page.locator('[data-settings-target="navigation"]').click();
  await assertSheet('navigation-sheet');

  await page.locator('[data-sheet="accountHub"]').click();
  await page.locator('[data-settings-target="plans"]').click();
  await assertSheet('plan-sheet');

  // Repeat a sheet transition to catch accumulated bottom offsets.
  await page.locator('[data-sheet="mapNavigation"]').click();
  await page.locator('[data-settings-target="map"]').click();
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
  await page.locator('[data-sheet="accountHub"]').click();
  await page.locator('[data-settings-target="sessions"]').click();
  await expect(page.locator('#sessionList')).toContainText('Other phone');
  await page.locator('[data-revoke-session="session-remote"]').click();
  await expect(page.locator('#sessionList')).not.toContainText('Other phone');
  expect(remoteRevoked).toBe(true);

  await page.locator('#closeSheet').click();
  await page.locator('[data-sheet="accountHub"]').click();
  await page.locator('[data-settings-target="account"]').click();
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
