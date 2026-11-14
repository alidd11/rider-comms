// Turn-by-turn navigation in the web app, against a mocked Google route.
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
      duration: { value: Math.round(step.meters / 15), text: '' },
      start_location: latLng(step.from),
      end_location: latLng(step.to),
      path: [latLng(step.from), latLng(step.to)],
    }));
    const meters = stepList.reduce((sum, step) => sum + step.meters, 0);
    window.__riderCommsTestRoute = { routes: [{ legs: [{
      steps: built,
      distance: { value: meters, text: '' },
      duration: { value: Math.round(meters / 15), text: '' },
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
