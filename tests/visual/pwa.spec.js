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
    Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: movementState === 'stationary' ? 'granted' : 'denied', addEventListener() {} }) } });
    let watchId = 0;
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(success, error) {
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
      clearWatch() {},
      getCurrentPosition(success, error) {
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
    };
    else if (url.pathname === `/riders/${RIDER_ID}/friend-requests`) body = { incoming: [], outgoing: [] };
    else if (url.pathname === '/hazards/nearby') body = { hazards: [] };
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
        constructor(_element, options) { this.centre = options.center; }
        panTo(centre) { this.centre = centre; }
        setZoom() {}
        setOptions() {}
        getCenter() {
          return {
            lat: () => this.centre.lat,
            lng: () => this.centre.lng,
            toJSON: () => ({ ...this.centre }),
          };
        }
      }
      class MarkerMock { addListener() {} setMap() {} setPosition() {} }
      class PlacesServiceMock {}
      class AutocompleteServiceMock {}
      class AutocompleteSessionTokenMock {}
      window.google = { maps: {
        Map: MapMock,
        Marker: MarkerMock,
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

test('PWA utility viewport paints safe areas as one edge-to-edge canvas', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');

  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewportMeta).toContain('viewport-fit=cover');

  await page.locator('.bottom-nav [data-nav="ride"]').click();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-top', '59px');
    document.documentElement.style.setProperty('--safe-left', '47px');
    document.documentElement.style.setProperty('--safe-right', '47px');
  });

  const viewport = await page.locator('[data-screen="ride"]').evaluate((screen) => {
    const screenStyle = getComputedStyle(screen);
    const shieldStyle = getComputedStyle(screen, '::before');
    const navStyle = getComputedStyle(document.querySelector('.bottom-nav'));
    return {
      screenBackground: screenStyle.backgroundImage,
      shieldBackground: shieldStyle.backgroundImage,
      shieldHeight: shieldStyle.height,
      paddingTop: screenStyle.paddingTop,
      paddingLeft: screenStyle.paddingLeft,
      navPaddingLeft: navStyle.paddingLeft,
    };
  });

  expect(viewport.shieldHeight).toBe('59px');
  expect(viewport.shieldBackground).toBe(viewport.screenBackground);
  expect(viewport.shieldBackground).toContain('repeating-linear-gradient');
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

test('PWA host can remove another rider from a private ride', async ({ page }) => {
  await mockAuthenticatedApi(page);
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

test('installed PWA tab bar itself owns the iOS home-indicator inset', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#settings');
  await page.evaluate(() => {
    const root = document.documentElement;
    root.classList.add('pwa-standalone');
    root.style.setProperty('--bottom-safe-area', '34px');
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
      navHeight: getComputedStyle(nav).height,
      navPaddingBottom: getComputedStyle(nav).paddingBottom,
    };
  });

  expect(chrome.navSafeBottom).toBe('34px');
  expect(parseFloat(chrome.navHeight)).toBe(58 + 34 + 1);
  expect(parseFloat(chrome.navPaddingBottom)).toBe(34);

  expect(navBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);

  // The real nav box reaches the physical viewport edge; controls remain in
  // the 58px interaction rail above the home-indicator safe area.
  expect(buttonBox.y).toBeGreaterThanOrEqual(navBox.y - 1);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(navBox.y + 59);
  const railBottom = navBox.y + 58;
  const labelBottomGap = railBottom - (labelBox.y + labelBox.height);
  expect(labelBottomGap).toBeGreaterThanOrEqual(0);
  expect(labelBottomGap).toBeLessThanOrEqual(12);
});

test('PWA navigation summary extends through the installed iPhone bottom safe area', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#map');
  await page.evaluate(() => {
    const root = document.documentElement;
    root.classList.add('pwa-standalone');
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
  expect(metrics.height).toBe(88 + 34);
  expect(metrics.paddingBottom).toBe(34);
  // Fractional device-scale rounding can land the CSS edge just over one
  // logical pixel from the Playwright viewport. This still verifies the real
  // summary box reaches the physical edge rather than stopping above it.
  expect(Math.abs((summaryBox.y + summaryBox.height) - viewport.height)).toBeLessThanOrEqual(2);
});

test('PWA preserves backend avatar presets on friend surfaces', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/#friends');

  const avatars = page.locator('#friendList .avatar');
  await expect(avatars).toHaveCount(2);
  await expect(avatars.nth(0)).toHaveCSS('--avatar', '#4C8BF5');
  await expect(avatars.nth(1)).toHaveCSS('--avatar', '#3DD68C');
});

test('PWA direct messages load and send within a friend-only thread', async ({ page }) => {
  const sent = [];
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/messages' && request.method() === 'GET') {
      expect(url.searchParams.get('withRiderId')).toBe('rider_friend01');
      return { body: { messages: [{ id: 'message-1', fromRiderId: 'rider_friend01', toRiderId: RIDER_ID, text: 'Meet at the petrol station?', createdAt: 1_700_000_000_000 }], nextCursor: null } };
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

test('PWA chat stays pinned to the visible viewport when the iPhone keyboard changes geometry', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const listeners = { resize: new Set(), scroll: new Set() };
    const viewport = {
      height: window.innerHeight,
      offsetTop: 0,
      addEventListener(type, listener) { listeners[type]?.add(listener); },
      removeEventListener(type, listener) { listeners[type]?.delete(listener); },
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });
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
  await page.locator('[data-friend="rider_friend01"]').click();
  await page.locator('#messageFriend').click();
  await expect(page.locator('#chatScreen')).toBeVisible();
  await expect(page.locator('#chatInput')).not.toBeFocused();

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
    fullPage: true,
  });

  await page.evaluate(({ height }) => {
    window.__setRiderTestVisualViewport(height, 0);
  }, { height: initialViewportHeight });

  await expect(page.locator('html')).not.toHaveClass(/keyboard-open/);
  await expect.poll(async () => {
    const box = await page.locator('#chatScreen').boundingBox();
    return box ? Math.round(box.y + box.height) : -1;
  }).toBe(initialViewportHeight);
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
