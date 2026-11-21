// Turn-by-turn navigation in the web app, against a mocked Google route.
/* global google */
import { expect, test } from '@playwright/test';
import { PROFILE, RIDER_ID, mockAuthenticatedApi } from './helpers.js';

const HOME = { placeId: 'home', name: 'Home', secondary: 'Mill Lane', lat: 51.52, lng: -0.1 };

/** A two-step route north from the mocked rider (51.5, -0.1) to HOME. */
async function provideRoute(page, steps = [
  { from: [51.5, -0.1], to: [51.51, -0.1], instructions: 'Head <b>north</b> on Mill Lane', maneuver: '', meters: 1100 },
  { from: [51.51, -0.1], to: [51.52, -0.1], instructions: 'Turn <b>left</b> onto High Street', maneuver: 'turn-left', meters: 1100 },
]) {
  await page.evaluate((stepList) => {
    const latLng = ([lat, lng]) => new google.maps.LatLng(lat, lng);
    const built = stepList.map((step) => ({
      instructions: step.instructions,
      maneuver: step.maneuver,
      distance: { value: step.meters, text: `${step.meters} m` },
      duration: { value: step.seconds ?? Math.round(step.meters / 15), text: '' },
      start_location: latLng(step.from),
      end_location: latLng(step.to),
      path: [latLng(step.from), latLng(step.to)],
    }));
    const meters = stepList.reduce((sum, step) => sum + step.meters, 0);
    const seconds = built.reduce((sum, step) => sum + step.duration.value, 0);
    window.__riderCommsTestRoute = { routes: [{ legs: [{
      steps: built,
      distance: { value: meters, text: '' },
      duration: { value: seconds, text: '' },
      start_location: built[0].start_location,
      end_location: built.at(-1).end_location,
    }] }] };
  }, steps);
}

async function startNavigationHome(page, backendOverride = null, { start = true } = {}) {
  await mockAuthenticatedApi(page, 'stationary', backendOverride);
  await page.addInitScript(({ riderId, home }) => {
    localStorage.setItem(`riderComms.savedPlaces:${riderId}`, JSON.stringify({ home }));
    // Guidance in Rider Comms rather than handed to another app.
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ navigationProvider: 'in_app' }));
    window.__wakeLocks = [];
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (type) => {
      const lock = { type, released: false, listeners: [], addEventListener(_e, fn) { this.listeners.push(fn); }, async release() { this.released = true; } };
      window.__wakeLocks.push(lock);
      return lock;
    } } });
  }, { riderId: RIDER_ID, home: HOME });
  await page.goto('/');
  await expect(page.locator('#mapDrawer')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.google?.maps?.LatLng && window.__riderCommsTestMap));
  await provideRoute(page);
  await page.locator('[data-saved-place="home"]').click();
  if (!start) return;
  await page.locator('#routePreviewStart').click();
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
}

test('PWA keeps the screen on while navigating and lets it sleep after', async ({ page }) => {
  await startNavigationHome(page);
  await expect.poll(() => page.evaluate(() => window.__wakeLocks.map((lock) => [lock.type, lock.released]))).toEqual([['screen', false]]);
  await page.locator('#endNavBtn').click();
  await expect(page.locator('#app')).not.toHaveClass(/nav-mode/);
  await expect.poll(() => page.evaluate(() => window.__wakeLocks.map((lock) => lock.released))).toEqual([true]);
});

test('PWA says how far a long road goes when navigation starts', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(utterance) { window.__spoken.push(utterance.text); } } });
  });
  await mockAuthenticatedApi(page, 'stationary');
  await page.addInitScript(({ riderId, home }) => {
    localStorage.setItem(`riderComms.savedPlaces:${riderId}`, JSON.stringify({ home }));
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ navigationProvider: 'in_app', spokenDirections: true }));
  }, { riderId: RIDER_ID, home: HOME });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.google?.maps?.LatLng && window.__riderCommsTestMap));
  await provideRoute(page, [
    { from: [51.5, -0.1], to: [51.68, -0.1], instructions: 'Head <b>north</b> on the A1', maneuver: '', meters: 19_312 },
    { from: [51.68, -0.1], to: [51.69, -0.1], instructions: 'Turn <b>left</b> onto High Street', maneuver: 'turn-left', meters: 900 },
  ]);
  await page.locator('[data-saved-place="home"]').click();
  await page.locator('#routePreviewStart').click();
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  await expect.poll(() => page.evaluate(() => window.__spoken)).toContain('Head north on the A1. Continue for 12 mi.');
});

test('PWA shows the ways there before Start, with live traffic, and starts the one chosen', async ({ page }) => {
  await startNavigationHome(page);
  // Replace the route with two ways and live traffic, then start again.
  await page.locator('#endNavBtn').click();
  await page.evaluate(() => {
    const latLng = (lat, lng) => new google.maps.LatLng(lat, lng);
    const way = (minutes, typicalMinutes, zigzag) => {
      const path = Array.from({ length: 30 }, (_, i) => latLng(51.5 + i * 0.001, -0.1 + (zigzag ? (i % 2) * 0.0008 : 0)));
      const step = (from, to, instructions, maneuver) => ({
        instructions, maneuver,
        distance: { value: 1600, text: '' }, duration: { value: typicalMinutes * 30, text: '' },
        start_location: path[from], end_location: path[to], path: path.slice(from, to + 1),
      });
      return {
        overview_path: path,
        legs: [{
          steps: [step(0, 14, 'Head <b>north</b>', ''), step(14, 29, 'Turn <b>left</b>', 'turn-left')],
          distance: { value: 3200, text: '' },
          duration: { value: typicalMinutes * 60, text: '' },
          duration_in_traffic: { value: minutes * 60, text: '' },
          start_location: path[0], end_location: path[29],
        }],
      };
    };
    window.__riderCommsTestRoute = { routes: [way(23, 15, false), way(29, 29, true)] };
    window.__riderCommsTestRouteRequests = [];
  });
  await page.locator('[data-saved-place="home"]').click();

  // The ways there first, before any guidance (as in Google Maps and Waze).
  const preview = page.locator('#routePreview');
  await expect(preview).toBeVisible();
  await expect(page.locator('#app')).not.toHaveClass(/nav-mode/);
  await expect(page.locator('#mapDrawer')).toBeHidden();
  // Where from and to at the top; the chosen way's card at the bottom.
  await expect(page.locator('#routePreviewTop')).toBeVisible();
  await expect(page.locator('#routePreviewTo')).toHaveText('Home');
  await expect(page.locator('#routePreviewTime')).toHaveText('23 min');
  await expect(page.locator('#routePreviewTime')).toHaveAttribute('data-traffic', 'true');
  await expect(page.locator('#routePreviewTag')).toHaveText('Fastest');
  await expect(page.locator('#routePreviewNoteText')).toHaveText('Fastest despite +8 min of traffic');
  await expect(page.locator('#routePreviewRide')).toBeHidden();
  await expect(page.locator('#routePreviewMoreText')).toHaveText('1 other route');
  // No turn list here (the trip card has it once riding); the other ways open on demand.
  await expect(page.locator('#routePreview')).not.toContainText('Head north');
  await expect(page.locator('#routePreviewList')).toBeHidden();
  await page.locator('#routePreviewMore').click();
  await expect(page.locator('#routePreviewList')).toBeVisible();
  await expect(page.locator('#routePreviewMoreText')).toHaveText('Hide other routes');

  const request = await page.evaluate(() => window.__riderCommsTestRouteRequests[0]);
  expect(request.provideRouteAlternatives).toBe(true);
  expect(request.drivingOptions.trafficModel).toBe('bestguess');
  expect(Number.isNaN(Date.parse(request.drivingOptions.departureTime))).toBe(false);

  const rows = page.locator('#routePreviewList [role="radio"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('strong')).toHaveText(['23 min', '29 min']);
  await expect(rows.locator('.route-preview-tag')).toHaveText(['Fastest', 'Twisty · +6 min']);
  await expect(rows.first()).toHaveAttribute('aria-checked', 'true');
  await expect(rows.first().locator('.route-preview-meta')).toHaveText(/^Arrive .+ · 2(\.0)? mi · \+8 min traffic$/);
  // Every way is drawn: the chosen one in the accent colour, the other grey.
  const lines = () => page.evaluate(() => window.__riderCommsTestOverlays
    ?.filter((overlay) => overlay.options?.strokeColor && overlay.map)
    .map((overlay) => [overlay.options.strokeColor, overlay.options.strokeWeight]));
  // Google Maps' look: wide blue on a darker edge; the other way grey on grey.
  await expect.poll(lines).toEqual(expect.arrayContaining([['#0b4fb3', 13], ['#1a73e8', 9], ['#7f8c93', 10], ['#a9b4ba', 7]]));

  // Tapping the grey line chooses it, as does its row.
  await page.evaluate(() => window.__riderCommsTestOverlays
    .find((overlay) => overlay.map && overlay.options.strokeColor === '#a9b4ba').trigger('click'));
  await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#routePreviewTime')).toHaveText('29 min');
  await expect(page.locator('#routePreviewTag')).toHaveText('Twisty');
  await expect(page.locator('#routePreviewNoteText')).toHaveText('Usual traffic');
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-checked', 'true');
  // Choose the twisty way, then Start: guidance has no route buttons.
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true');
  await page.locator('#routePreviewStart').click();
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  await expect(preview).toBeHidden();
  await expect(page.locator('#navTraffic')).toBeHidden();
  const minutes = async () => Number((await page.locator('#navEta').textContent()).replace(/\D+/g, ''));
  await expect.poll(minutes).toBeGreaterThan(0);
  const twisty = await minutes();
  await page.locator('#endNavBtn').click();

  // The fastest way counts today's traffic, and the back button returns to the place.
  await page.locator('[data-saved-place="home"]').click();
  await expect(page.locator('#routePreviewTime')).toHaveText('23 min');
  await expect(page.locator('#routePreviewList')).toBeHidden();
  await page.locator('#routePreviewClose').click();
  await expect(page.locator('#routePreviewTop')).toBeHidden();
  await expect(preview).toBeHidden();
  await expect(page.locator('#destinationCard')).toBeVisible();
  await page.locator('[data-start-in-app-navigation]').click();
  await page.locator('#routePreviewStart').click();
  await expect(page.locator('#navTraffic')).toHaveText('+8 min traffic');
  // Same road geometry, so the times left compare as 23 (15 plus 8 of
  // traffic) to 29: the fastest counts today's traffic.
  await expect.poll(async () => Math.abs(await minutes() / twisty - 23 / 29)).toBeLessThan(0.07);
});

test('PWA switches to a faster route found in live traffic, and says so', async ({ page }) => {
  await page.addInitScript(() => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(utterance) { window.__spoken.push(utterance.text); } } });
  });
  await page.clock.install();
  await mockAuthenticatedApi(page, 'stationary');
  await page.addInitScript(({ riderId, home }) => {
    localStorage.setItem(`riderComms.savedPlaces:${riderId}`, JSON.stringify({ home }));
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ navigationProvider: 'in_app', spokenDirections: true }));
  }, { riderId: RIDER_ID, home: HOME });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.google?.maps?.LatLng && window.__riderCommsTestMap));
  const slowSteps = [
    { from: [51.5, -0.1], to: [51.51, -0.1], instructions: 'Head <b>north</b>', maneuver: '', meters: 1100, seconds: 1500 },
    { from: [51.51, -0.1], to: [51.52, -0.1], instructions: 'Turn <b>left</b>', maneuver: 'turn-left', meters: 1100, seconds: 1500 },
  ];
  await provideRoute(page, slowSteps);
  await page.locator('[data-saved-place="home"]').click();
  await page.locator('#routePreviewStart').click();
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);

  // Five minutes on, a route that saves too little changes nothing...
  await provideRoute(page, slowSteps.map((step) => ({ ...step, seconds: 1450 })));
  await page.evaluate(() => { window.__spoken = []; });
  await page.clock.runFor(5 * 60_000 + 1000);
  await expect.poll(() => page.evaluate(() => (window.__riderCommsTestRouteRequests || []).length)).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.__spoken.filter((text) => text.startsWith('Faster')))).toEqual([]);

  // ...and five minutes later a much quicker one is taken, and said.
  await provideRoute(page, slowSteps.map((step) => ({ ...step, seconds: 600 })));
  await page.clock.runFor(5 * 60_000 + 1000);
  await expect.poll(() => page.evaluate(() => window.__spoken.find((text) => text.startsWith('Faster')))).toMatch(/^Faster route found\. Saves \d+ min\.$/);
  await expect(page.locator('#navGpsNotice')).toContainText('Faster route found');
});

test('PWA finds petrol along the rest of the route and routes through it', async ({ page }) => {
  const searches = [];
  await page.addInitScript(() => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(utterance) { window.__spoken.push(utterance.text); } } });
  });
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname !== '/places/along-route') return null;
    const body = request.postDataJSON();
    searches.push(body);
    return { body: { places: body.query === 'cafe' ? [] : [
      { id: 'bp', name: 'BP', address: 'A1', lat: 51.515, lon: -0.1, travelSeconds: 900 },
      { id: 'shell', name: 'Shell', address: 'Mill Lane', lat: 51.505, lon: -0.1, travelSeconds: 30 },
    ] } };
  });
  await page.addInitScript(({ riderId, home }) => {
    localStorage.setItem(`riderComms.savedPlaces:${riderId}`, JSON.stringify({ home }));
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ navigationProvider: 'in_app', spokenDirections: true }));
  }, { riderId: RIDER_ID, home: HOME });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.google?.maps?.LatLng && window.__riderCommsTestMap));
  await provideRoute(page);
  await page.locator('[data-saved-place="home"]').click();
  await page.locator('#routePreviewStart').click();
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);

  await page.locator('#navStopsBtn').click();
  await expect(page.locator('#sheetTitle')).toHaveText('On the way');
  const rows = page.locator('#stopList [data-stop-index]');
  await expect(rows).toHaveCount(2);
  // Ordered by what each adds to the trip.
  await expect(rows.first()).toContainText('Shell');
  await expect(rows.first()).toContainText('On the way');
  await expect(rows.nth(1)).toContainText('BP');
  expect(searches[0].query).toBe('petrol station');
  // From the rider, along the rest of the route.
  expect(searches[0].path.length).toBeGreaterThanOrEqual(2);
  expect(searches[0].path.at(-1)).toEqual({ lat: 51.52, lon: -0.1 });

  await page.locator('[data-stop-kind="cafes"]').click();
  await expect(page.locator('#stopList')).toContainText('No cafés found along the rest of the route.');
  await page.locator('[data-stop-kind="petrol"]').click();
  await expect(rows).toHaveCount(2);

  await page.evaluate(() => { window.__riderCommsTestRouteRequests = []; });
  await rows.first().click();
  await expect(page.locator('#sheetBackdrop')).toBeHidden();
  const request = await page.evaluate(() => window.__riderCommsTestRouteRequests[0]);
  expect(request.waypoints).toEqual([{ location: { lat: 51.505, lng: -0.1 }, stopover: true }]);
  expect(request.provideRouteAlternatives).toBe(false);
  await expect(page.locator('#navGpsNotice')).toHaveText('Stop added: Shell.');
  await expect.poll(() => page.evaluate(() => window.__spoken)).toContain('Stop added: Shell.');

  // Not stopping after all: the trip card's Add stop is now Skip stop, and
  // the way goes straight on without it.
  await page.locator('#navTripToggle').click();
  await expect(page.locator('#navTripAddStop')).toBeHidden();
  const skip = page.locator('#navTripSkipStop');
  await expect(skip).toHaveAttribute('aria-label', 'Skip the stop at Shell');
  await page.evaluate(() => { window.__riderCommsTestRouteRequests = []; });
  await skip.click();
  await expect(page.locator('#navGpsNotice')).toHaveText('Skipped Shell.');
  const straight = await page.evaluate(() => window.__riderCommsTestRouteRequests[0]);
  expect(straight.waypoints).toBeUndefined();
  await page.locator('#navTripToggle').click();
  await expect(page.locator('#navTripAddStop')).toBeVisible();
  await expect(skip).toBeHidden();
});

test('PWA guidance looks like Google Maps: coloured banner, End in the trip card, Re-centre after moving the map', async ({ page }) => {
  await startNavigationHome(page);
  // The turn banner is the guidance colour with white type, day or night.
  const banner = await page.locator('#navBanner').evaluate((node) => ({
    background: getComputedStyle(node).backgroundColor,
    guidance: getComputedStyle(document.documentElement).getPropertyValue('--guidance').trim(),
    road: getComputedStyle(document.querySelector('#navInstruction')).color,
  }));
  expect(banner.guidance).toMatch(/^#[0-9a-f]{6}$/);
  expect(banner.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(banner.road).toBe('rgb(255, 255, 255)');
  // End sits at the left of the trip card, away from the turn.
  await expect(page.locator('#navSummary #endNavBtn')).toBeVisible();
  await expect(page.locator('#navBanner #endNavBtn')).toHaveCount(0);
  // Re-centre shows only once the rider has left follow mode.
  await expect(page.locator('#navRecentreBtn')).toBeHidden();
  await expect(page.locator('#navSpeedBadge')).toBeVisible();
  await page.locator('#navOverviewBtn').click();
  await expect(page.locator('#navRecentreBtn')).toBeVisible();
  await expect(page.locator('#navSpeedBadge')).toBeHidden();
  await page.locator('#navRecentreBtn').click();
  await expect(page.locator('#navRecentreBtn')).toBeHidden();
  await page.locator('#endNavBtn').click();
  await expect(page.locator('#app')).not.toHaveClass(/nav-mode/);
  await expect(page.locator('#navRecentreBtn')).toBeHidden();
});

test('PWA trip card opens while parked with the turns left, Share ETA, Add stop and End', async ({ page }) => {
  await page.addInitScript(() => {
    window.__shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => { window.__shared.push(data); } });
  });
  await startNavigationHome(page);
  const toggle = page.locator('#navTripToggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.locator('#navTripDetails')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const turns = page.locator('#navTripTurns li');
  await expect(turns).toHaveCount(2);
  await expect(turns.first()).toContainText('Turn left onto High Street');
  await expect(turns.last()).toContainText('Arrive at Home');
  // The controls on the map step aside while the card is open.
  await expect(page.locator('#navSpeedBadge')).toBeHidden();

  await page.locator('#navTripShare').click();
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
  const [{ text }] = await page.evaluate(() => window.__shared);
  expect(text).toMatch(/^On my way to Home\. Arriving about .+, .+ to go\. Sent from Rider Comms\.$/);

  await page.locator('#navTripAddStop').click();
  await expect(page.locator('#navTripDetails')).toBeHidden();
  await expect(page.locator('#navSpeedBadge')).toBeVisible();
  await expect(page.locator('#sheetTitle')).toHaveText('On the way');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheetBackdrop')).toBeHidden();

  await toggle.click();
  await page.locator('#navTripEnd').click();
  await expect(page.locator('#app')).not.toHaveClass(/nav-mode/);
  await expect(page.locator('#navTripDetails')).toBeHidden();
});

test('PWA starts the route on show when the rider moves off with the preview open', async ({ page }) => {
  await mockAuthenticatedApi(page, 'recovering');
  await page.addInitScript(({ riderId, home }) => {
    localStorage.setItem(`riderComms.savedPlaces:${riderId}`, JSON.stringify({ home }));
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ navigationProvider: 'in_app' }));
  }, { riderId: RIDER_ID, home: HOME });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.google?.maps?.LatLng && window.__riderCommsTestMap && window.gpsTest));
  const fixes = (metresPerSecond) => page.evaluate((speed) => {
    const base = Date.now() - 7000;
    for (let i = 0; i <= 7; i++) window.gpsTest.success({
      timestamp: base + i * 1000,
      coords: { latitude: 51.5 + i * 0.0001 * speed, longitude: -0.1, accuracy: 5, speed },
    });
  }, metresPerSecond);
  // Parked: the one-off fix navigation asks for comes back too.
  await page.evaluate(() => {
    navigator.geolocation.getCurrentPosition = (success) => success({ timestamp: Date.now(), coords: { latitude: 51.5, longitude: -0.1, accuracy: 5, speed: 0 } });
  });
  await provideRoute(page);
  await page.locator('[data-saved-place="home"]').click();
  await expect(page.locator('#routePreview')).toBeVisible();
  // The stops list open as they set off: it closes (a list to read).
  await page.route('**/places/along-route', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ places: [] }) }));
  await page.locator('#routePreviewAddStop').click();
  await expect(page.locator('#sheetTitle')).toHaveText('On the way');
  await fixes(12);
  await expect(page.locator('#sheetBackdrop')).toBeHidden();
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  await expect(page.locator('#routePreview')).toBeHidden();
  await expect(page.locator('#app')).not.toHaveClass(/route-preview-mode/);
});

test('PWA Start route on a place says it is planning, and asks once', async ({ page }) => {
  await startNavigationHome(page, null, { start: false });
  // Back from the preview: the place card.
  await page.locator('#routePreviewClose').click();
  const start = page.locator('[data-start-in-app-navigation]');
  await expect(start).toBeVisible();
  // Google slow to answer: hold each reply until the test lets it go.
  await page.evaluate(() => {
    const service = google.maps.DirectionsService.prototype;
    const route = service.route;
    window.__held = [];
    service.route = function held(request, callback) {
      window.__held.push(() => route.call(this, request, callback));
    };
    window.__release = () => { window.__held.splice(0).forEach((go) => go()); };
  });
  await start.click();
  await expect(start).toBeDisabled();
  await expect(start).toHaveAttribute('aria-label', 'Starting route to Home');
  await expect(start).toContainText('Planning route…');
  await start.dispatchEvent('click');
  await expect.poll(() => page.evaluate(() => window.__held.length)).toBe(1);
  await page.evaluate(() => window.__release());
  await expect(page.locator('#routePreview')).toBeVisible();
  // Back again: the card is as it was.
  await page.locator('#routePreviewClose').click();
  await expect(start).toBeEnabled();
  await expect(start).toContainText('In Rider Comms');
});

test('PWA preview: times on the map, riding styles, Avoid, Share, and the group ride', async ({ page }) => {
  await startNavigationHome(page);
  await page.locator('#endNavBtn').click();
  await page.evaluate(() => {
    const latLng = (lat, lng) => new google.maps.LatLng(lat, lng);
    const way = (minutes, east, zig = false) => {
      const path = Array.from({ length: 20 }, (_, i) => latLng(51.5 + i * 0.001, -0.1 + east + (zig ? (i % 2) * 0.0008 : 0)));
      return { summary: east ? 'B road' : 'M1', overview_path: path, legs: [{
        steps: [{ instructions: 'Head <b>north</b>', maneuver: '', distance: { value: 3000, text: '' }, duration: { value: minutes * 60, text: '' }, start_location: path[0], end_location: path[19], path }],
        distance: { value: 3000, text: '' }, duration: { value: minutes * 60, text: '' }, start_location: path[0], end_location: path[19],
      }] };
    };
    window.__way = way;
    window.__riderCommsTestRoute = { routes: [way(20, 0), way(26, 0.002)] };
    window.__riderCommsTestRouteRequests = [];
    window.__riderCommsTestMarkers = [];
    window.__shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data) => { window.__shared.push(data.text); } });
  });
  await page.locator('[data-saved-place="home"]').click();
  await expect(page.locator('#routePreview')).toBeVisible();

  const bubbles = () => page.evaluate(() => window.__riderCommsTestMarkers
    .filter((marker) => marker.map && marker.label?.text)
    .map((marker) => [marker.label.text, marker.label.color]));
  await expect.poll(bubbles).toEqual(expect.arrayContaining([['20 min', '#ffffff'], ['26 min', '#0b1216']]));
  // Tapping the other time on the map chooses that way.
  await page.evaluate(() => window.__riderCommsTestMarkers
    .find((marker) => marker.map && marker.label?.text === '26 min').trigger('click'));
  await expect(page.locator('#routePreviewTime')).toHaveText('26 min');

  // Share sends where, which way and when.
  await page.locator('#routePreviewShare').click();
  await expect.poll(() => page.evaluate(() => window.__shared)).toEqual([expect.stringMatching(/^Heading to Home via B road: 1\.9 mi, arriving about .+\. Sent from Rider Comms\.$/)]);

  // Swipe the card down to make it small (time and Start), and up again.
  const card = page.locator('#routePreview');
  const swipe = async (from, to) => {
    await card.dispatchEvent('pointerdown', { clientY: from });
    await card.dispatchEvent('pointerup', { clientY: to });
  };
  await swipe(700, 780);
  await expect(card).toHaveClass(/minimised/);
  await expect(page.locator('#routePreviewMeta')).toBeHidden();
  await expect(page.locator('#routePreviewStart')).toBeVisible();
  await swipe(780, 790);
  await expect(card).toHaveClass(/minimised/);
  await swipe(780, 700);
  await expect(card).not.toHaveClass(/minimised/);
  await swipe(700, 600);
  await expect(card).toHaveClass(/expanded/);
  await expect(page.locator('#routePreviewList')).toBeVisible();
  await swipe(600, 700);
  await expect(card).not.toHaveClass(/expanded/);
  // A drag that starts on a button stays a tap.
  await page.locator('#routePreviewShare').dispatchEvent('pointerdown', { clientY: 700 });
  await card.dispatchEvent('pointerup', { clientY: 800 });
  await expect(card).not.toHaveClass(/minimised/);
  // The handle: small to the chosen way, then to every way, then back.
  await swipe(700, 800);
  await page.locator('#routePreviewHandle').click();
  await expect(card).not.toHaveClass(/minimised/);
  await page.locator('#routePreviewHandle').click();
  await expect(card).toHaveClass(/expanded/);
  await page.locator('#routePreviewHandle').click();
  await expect(card).not.toHaveClass(/expanded/);

  // Riding style, in Route options: Twisty keeps off motorways and shows the
  // bendiest way, for this trip only (the motorways setting isn't changed).
  const options = page.locator('#routePreviewAvoidBtn');
  await expect(options).toHaveAttribute('aria-label', 'Route options, Fastest');
  await expect(page.locator('#routePreviewOptions')).toBeHidden();
  await options.click();
  const twisty = page.locator('[data-preview-style="twisty"]');
  await expect(page.locator('[data-preview-style="fastest"]')).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => { window.__riderCommsTestRoute = { routes: [window.__way(24, 0), window.__way(31, 0.002, true)] }; });
  await twisty.click();
  // Picking a style closes the menu.
  await expect(page.locator('#routePreviewOptions')).toBeHidden();
  await expect(page.locator('#routePreviewTime')).toHaveText('31 min');
  await expect(options).toHaveAttribute('aria-label', 'Route options, Twisty');
  await expect(page.locator('#routePreviewAvoidCount')).toHaveText('1');
  await options.click();
  await expect(twisty).toHaveAttribute('aria-checked', 'true');
  let requests = await page.evaluate(() => window.__riderCommsTestRouteRequests);
  expect(requests.at(-1).avoidHighways).toBe(true);
  expect(requests.at(-1).provideRouteAlternatives).toBe(true);
  expect(await page.evaluate(() => Object.values(localStorage).some((value) => value.includes('"avoidHighways":true')))).toBe(false);
  // Fastest again asks with the rider's own setting and shows the quickest.
  await page.locator('[data-preview-style="fastest"]').click();
  await expect(page.locator('#routePreviewAvoidCount')).toBeHidden();
  await expect(page.locator('#routePreviewTime')).toHaveText('24 min');
  requests = await page.evaluate(() => window.__riderCommsTestRouteRequests);
  expect(requests.at(-1).avoidHighways).toBe(false);

  // Avoid tolls: the same setting as Settings, and new ways asked for.
  await page.locator('#routePreviewAvoidBtn').click();
  const tolls = page.locator('[data-preview-avoid="avoidTolls"]');
  await expect(tolls).toHaveAttribute('aria-checked', 'false');
  await tolls.click();
  await expect(tolls).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#routePreviewAvoidCount')).toHaveText('1');
  await expect(page.locator('#routePreviewAvoidBtn')).toHaveAttribute('aria-label', 'Route options, Fastest, avoiding tolls or ferries');
  requests = await page.evaluate(() => window.__riderCommsTestRouteRequests);
  expect(requests.at(-1).avoidTolls).toBe(true);
  expect(await page.evaluate(() => Object.values(localStorage).some((value) => value.includes('"avoidTolls":true')))).toBe(true);

  // No way without ferries: the setting goes back and the routes stay.
  await page.evaluate(() => { window.__riderCommsTestRoute = null; });
  const ferries = page.locator('[data-preview-avoid="avoidFerries"]');
  await ferries.click();
  await expect(ferries).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#routePreviewTime')).toHaveText('24 min');
  await expect(page.locator('#routePreviewStart')).toBeEnabled();

  // A different destination: back to the search box.
  await page.locator('#routePreviewTo').click();
  await expect(page.locator('#routePreview')).toBeHidden();
  await expect(page.locator('#app')).not.toHaveClass(/route-preview-mode/);
});

test('PWA keeps a voice button while navigating: tap to mute, hold to leave Nearby Voice', async ({ page }) => {
  let shareLocation = false;
  let presenceDeletes = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT' && typeof request.postDataJSON().shareLocation === 'boolean') shareLocation = request.postDataJSON().shareLocation;
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') return { body: { inZoneWith: [], transitions: [], radiusMiles: 1 } };
    if (url.pathname === '/presence' && request.method() === 'DELETE') { presenceDeletes += 1; return { body: {} }; }
    if (url.pathname === '/voice/token' && request.method() === 'POST') return { body: { connections: [], refreshAfterMs: 20_000 } };
    return null;
  });
  await page.addInitScript(({ riderId, home }) => {
    localStorage.setItem(`riderComms.savedPlaces:${riderId}`, JSON.stringify({ home }));
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ navigationProvider: 'in_app' }));
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => fakeStream } });
    window.LivekitClient = {};
  }, { riderId: RIDER_ID, home: HOME });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.google?.maps?.LatLng && window.__riderCommsTestMap));
  // Nearby Voice on, then off to Home.
  await page.locator('#joinNearbyBtn').click();
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('aria-pressed', 'true');
  await provideRoute(page);
  await page.locator('[data-saved-place="home"]').click();
  await page.locator('#routePreviewStart').click();
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);

  const voice = page.locator('#navVoiceBtn');
  await expect(voice).toBeVisible();
  await expect(voice).toHaveAttribute('aria-label', 'Mute your microphone');
  // A hold (or a right click) opens the options; the route keeps going.
  const menu = page.locator('#navVoiceMenu');
  await voice.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('.nav-voice-menu-note')).toHaveText('Nearby Voice · your route keeps going');
  await page.locator('#navVoiceCancelItem').click();
  await expect(menu).toBeHidden();
  await voice.dispatchEvent('pointerdown');
  await page.waitForTimeout(600);
  await voice.dispatchEvent('pointerup');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await voice.click({ button: 'right' });
  await page.locator('#navVoiceLeaveItem').click();
  await expect.poll(() => presenceDeletes).toBeGreaterThan(0);
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  await expect(voice).toBeHidden();
});

test('PWA preview says when Twisty found nothing bendier than the fastest way', async ({ page }) => {
  await startNavigationHome(page);
  await page.locator('#endNavBtn').click();
  await page.evaluate(() => {
    const latLng = (lat, lng) => new google.maps.LatLng(lat, lng);
    const path = Array.from({ length: 20 }, (_, i) => latLng(51.5 + i * 0.001, -0.1 + (i % 2) * 0.0008));
    const way = (minutes) => ({ summary: 'A1', overview_path: path, legs: [{
      steps: [{ instructions: 'Head <b>north</b>', maneuver: '', distance: { value: 3000, text: '' }, duration: { value: minutes * 60, text: '' }, start_location: path[0], end_location: path[19], path }],
      distance: { value: 3000, text: '' }, duration: { value: minutes * 60, text: '' }, start_location: path[0], end_location: path[19],
    }] });
    window.__riderCommsTestRoute = { routes: [way(20)] };
  });
  await page.locator('[data-saved-place="home"]').click();
  await page.locator('#routePreviewAvoidBtn').click();
  await page.locator('[data-preview-style="twisty"]').click();
  await expect(page.locator('#routePreviewNoteText')).toHaveText('Also the twistiest way Google found');
  await expect(page.locator('#routePreviewNote')).toHaveAttribute('data-traffic', 'false');
  // One way only: no list to open, so a swipe up from the card does nothing more.
  await expect(page.locator('#routePreviewMore')).toBeHidden();
});

test('PWA preview says what riders have reported on each way', async ({ page }) => {
  const report = (id, type, lat, lon = -0.1) => ({
    id, type, lat, lon, reportedBy: 'rider_other', createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER, confirmations: 0, denials: 0,
  });
  await startNavigationHome(page, ({ url }) => (url.pathname === '/hazards/nearby'
    ? { body: { hazards: [
      report('police', 'police', 51.505),
      report('closure', 'road_closure', 51.515),
      report('elsewhere', 'accident', 51.505, -0.09),
    ] } }
    : null), { start: false });
  const hazards = page.locator('#routePreviewHazards');
  await expect(hazards).toBeVisible();
  // Along a line from you to the destination, each where it is, as in Waze;
  // one sentence for a screen reader.
  await expect(hazards).toHaveAttribute('aria-label', 'Reported on the way: road closure, police');
  const markers = hazards.locator('.route-hazard-marker');
  await expect(markers).toHaveCount(2);
  await expect(markers.first()).toHaveAttribute('data-type', 'police');
  await expect(markers.nth(1)).toHaveAttribute('data-type', 'road_closure');
  await expect(markers.nth(1)).toHaveAttribute('data-serious', 'true');
  await expect(hazards).not.toContainText('Reported');
  // Police a quarter of the way to the closure at three quarters: in order, left to right.
  const [police, closure] = await markers.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().x));
  const box = await hazards.boundingBox();
  expect(police).toBeLessThan(box.x + box.width / 2);
  expect(closure).toBeGreaterThan(box.x + box.width / 2);
  // With another way: each row has its own icons, small; one with none has none.
  await page.locator('#routePreviewClose').click();
  await page.evaluate(() => {
    const latLng = (lat, lng) => new google.maps.LatLng(lat, lng);
    const way = (lng, minutes) => {
      const path = [latLng(51.5, lng), latLng(51.52, lng)];
      return { summary: '', overview_path: path, legs: [{ steps: [{ instructions: 'Head <b>north</b>', maneuver: '', distance: { value: 2200, text: '' }, duration: { value: minutes * 60, text: '' }, start_location: path[0], end_location: path[1], path }], distance: { value: 2200, text: '' }, duration: { value: minutes * 60, text: '' }, start_location: path[0], end_location: path[1] }] };
    };
    window.__riderCommsTestRoute = { routes: [way(-0.1, 10), way(-0.08, 14)] };
  });
  await page.locator('[data-start-in-app-navigation]').click();
  await page.locator('#routePreviewMore').click();
  const row = page.locator('[data-preview-route="0"]');
  await expect(row.locator('.route-hazard-chip')).toHaveCount(2);
  await expect(row).toHaveAttribute('aria-label', /, reported on the way: road closure, police$/);
  await expect(page.locator('[data-preview-route="1"] .route-hazard-chip')).toHaveCount(0);
  await page.locator('#routePreviewMore').click();
  // Swiped small, the card keeps only the time and Start. (A card scrolled
  // down, as on a short landscape screen, scrolls back first.)
  await page.locator('#routePreview').evaluate((node) => { node.scrollTop = 0; });
  await page.locator('#routePreview').dispatchEvent('pointerdown', { clientY: 600 });
  await page.locator('#routePreview').dispatchEvent('pointerup', { clientY: 700 });
  await expect(page.locator('#routePreview')).toHaveClass(/minimised/);
  await expect(hazards).toBeHidden();
});

test('PWA preview adds a stop on the way before Start, and Start keeps it', async ({ page }) => {
  const searches = [];
  await page.clock.install();
  await startNavigationHome(page, ({ request, url }) => {
    if (url.pathname !== '/places/along-route') return null;
    searches.push(request.postDataJSON());
    return { body: { places: [{ id: 'shell', name: 'Shell', address: 'Mill Lane', lat: 51.505, lon: -0.1, travelSeconds: 30 }] } };
  }, { start: false });
  // In the top bar, above Route options.
  const addStop = page.locator('#routePreviewTop #routePreviewAddStop');
  await expect(addStop).toBeVisible();
  const [plus, options] = await Promise.all([addStop.boundingBox(), page.locator('#routePreviewAvoidBtn').boundingBox()]);
  expect(plus.y + plus.height).toBeLessThanOrEqual(options.y);
  expect(Math.abs(plus.x - options.x)).toBeLessThan(2);
  await addStop.click();
  await expect(page.locator('#sheetTitle')).toHaveText('On the way');
  const rows = page.locator('#stopList [data-stop-index]');
  await expect(rows).toHaveCount(1);
  // Along the whole of the way shown, from where it starts.
  expect(searches[0].path[0]).toEqual({ lat: 51.5, lon: -0.1 });
  expect(searches[0].path.at(-1)).toEqual({ lat: 51.52, lon: -0.1 });

  await page.evaluate(() => { window.__riderCommsTestRouteRequests = []; });
  await rows.first().click();
  await expect(page.locator('#sheetBackdrop')).toBeHidden();
  await expect(page.locator('#routePreviewStopText')).toHaveText('Stop: Shell');
  await expect(addStop).toBeHidden();
  const asked = await page.evaluate(() => window.__riderCommsTestRouteRequests[0]);
  expect(asked.waypoints).toEqual([{ location: { lat: 51.505, lng: -0.1 }, stopover: true }]);
  expect(asked.provideRouteAlternatives).toBe(false);

  // A riding style keeps the stop.
  await page.locator('#routePreviewAvoidBtn').click();
  await page.locator('[data-preview-style="twisty"]').click();
  await expect.poll(() => page.evaluate(() => window.__riderCommsTestRouteRequests.length)).toBe(2);
  expect((await page.evaluate(() => window.__riderCommsTestRouteRequests[1])).waypoints).toHaveLength(1);

  // Taken out again: the ways there without it.
  await page.locator('#routePreviewStopRemove').click();
  await expect(page.locator('#routePreviewStop')).toBeHidden();
  await expect(addStop).toBeVisible();
  expect((await page.evaluate(() => window.__riderCommsTestRouteRequests[2])).waypoints).toBeUndefined();

  // Added again and started: navigation follows the way through it.
  await addStop.click();
  await rows.first().click();
  await expect(page.locator('#routePreviewStopText')).toHaveText('Stop: Shell');
  await page.locator('#routePreviewStart').click();
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  // The faster-route check five minutes on still goes through the stop.
  await page.evaluate(() => { window.__riderCommsTestRouteRequests = []; });
  await page.clock.runFor(5 * 60_000 + 1000);
  await expect.poll(() => page.evaluate(() => window.__riderCommsTestRouteRequests.length)).toBeGreaterThanOrEqual(1);
  expect((await page.evaluate(() => window.__riderCommsTestRouteRequests[0])).waypoints).toEqual([{ location: { lat: 51.505, lng: -0.1 }, stopover: true }]);
});

test('PWA arrives at the end point, or parked close to it on a good fix', async ({ page }) => {
  await startNavigationHome(page, null, { start: false });
  // Hear every GPS watch started from here on (navigation's own).
  await page.evaluate(() => {
    const geo = navigator.geolocation;
    const watch = geo.watchPosition.bind(geo);
    window.__watchers = [];
    geo.watchPosition = (success, error, options) => { window.__watchers.push(success); return watch(success, error, options); };
  });
  await page.locator('#routePreviewStart').click();
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  await expect.poll(() => page.evaluate(() => window.__watchers.length)).toBeGreaterThan(0);
  const fix = (lat, { speed = 0, accuracy = 5, at = 0 } = {}) => page.evaluate(({ lat, speed, accuracy, at }) => {
    const position = { timestamp: Date.now() + at, coords: { latitude: lat, longitude: -0.1, accuracy, speed, heading: 0 } };
    window.__watchers.forEach((success) => success(position));
  }, { lat, speed, accuracy, at });
  await fix(51.505, { speed: 10 });
  await fix(51.512, { speed: 10 });
  // About 90 m short of Home, still riding: not yet.
  await fix(51.5192, { speed: 6 });
  await fix(51.5192, { speed: 6, at: 20_000 });
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  // On a poor fix, stopping there doesn't count.
  await fix(51.5192, { accuracy: 80, at: 21_000 });
  await fix(51.5192, { accuracy: 80, at: 40_000 });
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  // Parked there on a good fix: after 15 seconds, arrived.
  await fix(51.5192, { at: 41_000 });
  await fix(51.5192, { at: 50_000 });
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  await fix(51.5192, { at: 57_000 });
  await expect(page.locator('#app')).not.toHaveClass(/nav-mode/);
  await expect(page.locator('#destinationCard')).toContainText('You’ve arrived');
});

test('PWA preview shows reports along the whole way, beyond the 40 miles round the rider', async ({ page }) => {
  const asked = [];
  await startNavigationHome(page, ({ request, url }) => {
    if (url.pathname === '/hazards/nearby') return { body: { hazards: [] } };
    if (url.pathname !== '/hazards/along-route') return null;
    asked.push(request.postDataJSON());
    return { body: { hazards: [{ id: 'far', type: 'road_closure', lat: 51.515, lon: -0.1, createdAt: 1, expiresAt: Number.MAX_SAFE_INTEGER, confirmations: 0, denials: 0 }] } };
  }, { start: false });
  const hazards = page.locator('#routePreviewHazards');
  await expect(hazards).toHaveAttribute('aria-label', 'Reported on the way: road closure');
  // The way shown, as { lat, lon } points from its start to its end.
  expect(asked[0].path[0]).toEqual({ lat: 51.5, lon: -0.1 });
  expect(asked[0].path.at(-1)).toEqual({ lat: 51.52, lon: -0.1 });
});
