// Turn-by-turn navigation in the web app, against a mocked Google route.
/* global google */
import { expect, test } from '@playwright/test';
import { RIDER_ID, mockAuthenticatedApi } from './helpers.js';

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
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  await expect.poll(() => page.evaluate(() => window.__spoken)).toContain('Head north on the A1. Continue for 12 mi.');
});

test('PWA asks for live traffic, offers the other ways there while parked, and switches on a tap', async ({ page }) => {
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
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);

  const request = await page.evaluate(() => window.__riderCommsTestRouteRequests[0]);
  expect(request.provideRouteAlternatives).toBe(true);
  expect(request.drivingOptions.trafficModel).toBe('bestguess');
  expect(Number.isNaN(Date.parse(request.drivingOptions.departureTime))).toBe(false);

  const choices = page.locator('#navRouteChoices [role="radio"]');
  await expect(choices).toHaveText(['Fastest · 23 min', 'Twisty · 29 min · +6 min']);
  await expect(choices.first()).toHaveAttribute('aria-checked', 'true');
  // Traffic is adding 8 minutes today; the arrival time counts it.
  await expect(page.locator('#navTraffic')).toHaveText('+8 min traffic');
  const minutes = async () => Number((await page.locator('#navEta').textContent()).replace(/\D+/g, ''));
  const withTraffic = await minutes();

  await choices.nth(1).click();
  await expect(page.locator('#navRouteChoices [role="radio"]').nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#navTraffic')).toBeHidden();
  // Same road geometry, so the times left compare as 23 (15 plus 8 of
  // traffic) to 29: the first counts today's traffic.
  await expect.poll(async () => Math.abs(withTraffic / await minutes() - 23 / 29)).toBeLessThan(0.07);

  await page.locator('#endNavBtn').click();
  await expect(page.locator('#navRouteChoices')).toBeHidden();
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
