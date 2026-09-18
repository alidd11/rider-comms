import { expect, test } from '@playwright/test';

const RIDER_ID = 'rider_visual01';
const PROFILE = {
  riderId: RIDER_ID,
  displayName: 'Alex Rider',
  handle: '@alex_rides',
  avatarId: 'AR',
  zoneTier: 'free',
  unitSystem: 'miles',
  shareLocation: false,
  instagramUsername: '',
  tiktokUsername: '',
  instagramVisibility: 'friends',
  tiktokVisibility: 'friends',
};

async function mockAuthenticatedApi(page, movement = 'stationary') {
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
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname === '/auth/me') body = { riderId: RIDER_ID };
    else if (url.pathname === `/riders/${RIDER_ID}/profile`) body = PROFILE;
    else if (url.pathname === `/riders/${RIDER_ID}/friends`) body = {
      friends: [
        { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto' },
        { riderId: 'rider_friend02', displayName: 'Jay', handle: '@jay125' },
      ],
    };
    else if (url.pathname === `/riders/${RIDER_ID}/friend-requests`) body = { incoming: [], outgoing: [] };
    else if (url.pathname === '/hazards/nearby') body = { hazards: [] };
    else if (url.pathname === '/config') body = { googleMapsApiKey: 'visual-test-key' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
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

test('PWA exposes session management and account deletion', async ({ page }) => {
  await mockAuthenticatedApi(page);
  let remoteRevoked = false;
  let accountDeleted = false;

  await page.route('**/auth/sessions**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'DELETE' && pathname === '/auth/sessions/session-remote') {
      remoteRevoked = true;
      return route.fulfill({ status: 204, body: '' });
    }
    if (request.method() === 'GET' && pathname === '/auth/sessions') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: remoteRevoked
            ? [{ id: 'session-current', deviceName: 'This iPhone', lastSeenAt: new Date().toISOString(), current: true }]
            : [
                { id: 'session-current', deviceName: 'This iPhone', lastSeenAt: new Date().toISOString(), current: true },
                { id: 'session-remote', deviceName: 'Other phone', lastSeenAt: new Date().toISOString(), current: false },
              ],
        }),
      });
    }
    return route.fallback();
  });

  await page.route('**/auth/me', async (route) => {
    if (route.request().method() === 'DELETE') {
      accountDeleted = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
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
  await page.locator('#deleteAccountBtn').click();
  await expect.poll(() => accountDeleted).toBe(true);
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
