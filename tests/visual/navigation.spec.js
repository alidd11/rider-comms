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

async function startNavigationHome(page) {
  await mockAuthenticatedApi(page, 'stationary');
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
  // The list of every way and the turns opens on demand.
  await expect(page.locator('#routePreviewList')).toBeHidden();
  await page.locator('#routePreviewStepsBtn').click();
  await expect(page.locator('#routePreviewSteps li')).toHaveText(['Head north1.0 mi', 'Turn left1.0 mi', 'Arrive at Home']);

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
  await fixes(12);
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  await expect(page.locator('#routePreview')).toBeHidden();
  await expect(page.locator('#app')).not.toHaveClass(/route-preview-mode/);
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

  // Riding style: Twisty keeps off motorways and shows the bendiest way,
  // for this trip only (the motorways setting isn't changed).
  const twisty = page.locator('[data-preview-style="twisty"]');
  await expect(page.locator('[data-preview-style="fastest"]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { window.__riderCommsTestRoute = { routes: [window.__way(24, 0), window.__way(31, 0.002, true)] }; });
  await twisty.click();
  await expect(twisty).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#routePreviewTime')).toHaveText('31 min');
  let requests = await page.evaluate(() => window.__riderCommsTestRouteRequests);
  expect(requests.at(-1).avoidHighways).toBe(true);
  expect(requests.at(-1).provideRouteAlternatives).toBe(true);
  expect(await page.evaluate(() => Object.values(localStorage).some((value) => value.includes('"avoidHighways":true')))).toBe(false);
  // Fastest again asks with the rider's own setting and shows the quickest.
  await page.locator('[data-preview-style="fastest"]').click();
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
  await expect(page.locator('#routePreviewAvoidBtn')).toHaveAttribute('aria-label', 'Avoid tolls or ferries, 1 on');
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
