// Shared fixtures for the web app's Playwright tests: a mocked backend and
// Google Maps, and helpers for standalone geometry, settings and the menu.
import { expect } from '@playwright/test';

export const RIDER_ID = 'rider_visual01';
export const PROFILE = {
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

export async function mockAuthenticatedApi(page, movement = 'stationary', backendOverride = null) {
  await page.addInitScript(({ riderId, movementState }) => {
    localStorage.setItem('rider-comms-session-v1', JSON.stringify({ riderId, token: 'visual-test-token', emailVerified: true }));
    Object.defineProperty(navigator, 'permissions', { value: { query: async ({ name } = {}) => ({ state: name === 'microphone' ? 'prompt' : ['stationary', 'recovering', 'stale-timestamp'].includes(movementState) ? 'granted' : 'denied', addEventListener() {} }) } });
    let watchId = 0;
    window.__riderCommsGetCurrentPositionCalls = 0;
    // 'stale-timestamp' is a stationary phone whose fixes carry a two-minute
    // old timestamp, as iOS Safari does when it reuses its last known fix.
    const timestampLagMs = movementState === 'stale-timestamp' ? 120_000 : 0;
    const stationaryLike = movementState === 'stationary' || movementState === 'stale-timestamp';
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(success, error) {
        if (movementState === 'recovering') {
          window.gpsTest = { success, error, cleared: false };
          return ++watchId;
        }
        if (!stationaryLike) {
          error?.({ code: 1, name: 'NotAllowedError' });
          return ++watchId;
        }
        const base = Date.now() - 7000 - timestampLagMs;
        for (let index = 0; index <= 7; index += 1) success({
          timestamp: base + index * 1000,
          coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 5, speed: 0 },
        });
        return ++watchId;
      },
      clearWatch() { if (window.gpsTest) window.gpsTest.cleared = true; },
      getCurrentPosition(success, error) {
        window.__riderCommsGetCurrentPositionCalls += 1;
        if (!stationaryLike) return error?.({ code: 1, name: 'NotAllowedError' });
        success({ timestamp: Date.now() - timestampLagMs, coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 5, speed: 0 } });
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
    else if (url.pathname === '/billing') body = { tier: PROFILE.zoneTier, expiresAt: null, purchasesEnabled: false };
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
        LatLng: class LatLng { constructor(lat, lng) { this.latValue = lat; this.lngValue = lng; } lat() { return this.latValue; } lng() { return this.lngValue; } },
        SymbolPath: { CIRCLE: 0 },
        Animation: { BOUNCE: 1, DROP: 2 },
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

export async function assertNoViewportOverflow(page) {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(overflow.width, `document width ${overflow.width}px exceeds ${overflow.viewport}px viewport`).toBeLessThanOrEqual(overflow.viewport + 1);
}

export async function waitForViewportSettled(page) {
  // app.js intentionally resamples the standalone viewport across two paint
  // frames after launch/pageshow. Wait one additional frame before overriding
  // the safe-area test fixture so the production resync cannot race the test.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }));
}

export async function installStandaloneFixture(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
}

export async function setSyntheticSafeArea(page, bottom) {
  await page.evaluate((value) => {
    const root = document.documentElement;
    root.style.setProperty('--safe-bottom', `${value}px`);
    root.style.setProperty('--bottom-safe-area', `${value}px`);
  }, bottom);
}

export async function standaloneGeometry(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const app = document.querySelector('#app');
    const screen = document.querySelector('.screen.active');
    const map = document.querySelector('#mapCanvas');
    const box = (element) => element?.getBoundingClientRect();
    const appBox = box(app);
    const screenBox = box(screen);
    const mapBox = box(map);
    return {
      viewportHeight: root.clientHeight,
      viewportWidth: root.clientWidth,
      appTop: appBox?.top,
      appBottom: appBox?.bottom,
      screenBottom: screenBox?.bottom,
      mapBottom: mapBox?.bottom,
      documentWidth: root.scrollWidth,
    };
  });
}

// Routes and Settings live in the menu behind the rider's avatar on the
// map (Map, Ride and Friends are the tabs).
// There is no tab bar: the map is home, and Ride, Friends, Routes and
// Settings open from the menu behind the rider's avatar. Every other page
// goes back to the map with its back arrow.
export async function openTab(page, screen) {
  const back = page.locator('.screen.active [data-back-to-map]');
  if (await back.isVisible()) {
    // Back to map steps back through history; WebKit can leave Playwright
    // waiting for a page load that a same-page history step never fires, so
    // dispatch the click and wait for the map itself.
    await back.dispatchEvent('click');
    await expect(page.locator('.screen[data-screen="map"]')).toHaveClass(/active/);
  }
  if (screen === 'map') return;
  await openFromMenu(page, screen);
}

export const SETTINGS_PARENT = { navigationApp: 'mapNavigation', blockedRiders: 'privacy', devices: 'account', email: 'account' };
/** Settings: open a category from the root, then its page. */
export async function openSettingsPage(page, key) {
  const parent = SETTINGS_PARENT[key];
  if (parent) {
    if (await page.locator('#sheetBackdrop').isVisible()) await page.locator('#closeSheetAll').click();
    await page.locator(`#settingsList [data-settings-open="${parent}"]`).click();
  }
  await page.locator(`#sheetBody [data-settings-open="${key}"], #settingsList [data-settings-open="${key}"]`).first().click();
}

export async function openFromMenu(page, screen) {
  await openTab(page, 'map');
  await page.locator('#mapAvatarButton').click();
  await expect(page.locator('#appMenu')).toBeVisible();
  // The menu is full screen: nothing else (the safety banner included) may
  // sit on top of its rows.
  await expect(page.locator('#movementSafetyBanner')).toBeHidden();
  await page.locator(`[data-menu-nav="${screen}"]`).click();
  await expect(page.locator('#appMenu')).toBeHidden();
}

// View profile in the avatar menu opens your profile page; Edit profile is a
// page of its own behind it.
export async function openOwnProfile(page, { edit = false } = {}) {
  await openTab(page, 'map');
  await page.locator('#mapAvatarButton').click();
  await expect(page.locator('#appMenu')).toBeVisible();
  await page.locator('#appMenuViewProfile').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Profile');
  if (edit) {
    await page.locator('#sheetBody [data-settings-open="editProfile"]').first().click();
    await expect(page.locator('#sheetTitle')).toHaveText('Edit profile');
  }
}

export function expectNear(actual, expected, tolerance = 1.5) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}
