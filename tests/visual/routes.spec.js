// Curated routes.
import { expect, test } from '@playwright/test';
import { mockAuthenticatedApi, assertNoViewportOverflow, openFromMenu } from './helpers.js';

test('PWA route discovery previews route shape and hands the start back to the map', async ({ page }, testInfo) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();

  await openFromMenu(page, 'routes');
  const firstRoute = page.locator('.curated-route-card').first();
  await expect(firstRoute).toBeVisible();
  await expect(firstRoute.locator('.route-trace-card')).toBeHidden();
  const routeCardBox = await firstRoute.boundingBox();
  expect(routeCardBox).not.toBeNull();
  // Cards now provide a legible text strip beneath the photo rather than
  // squeezing all metadata into the old 136px-wide-format mockup.
  expect(routeCardBox.height).toBeGreaterThanOrEqual(200);
  const visualHierarchy = await firstRoute.evaluate((card) => {
    const image = card.querySelector('img')?.getBoundingClientRect();
    const details = card.querySelector('.curated-route-overlay')?.getBoundingClientRect();
    const stats = card.querySelector('.route-quick-stats')?.getBoundingClientRect();
    return { imageHeight: image?.height, detailsHeight: details?.height, statsHeight: stats?.height };
  });
  expect(visualHierarchy.imageHeight).toBeGreaterThanOrEqual(120);
  expect(visualHierarchy.detailsHeight).toBeGreaterThanOrEqual(70);
  expect(visualHierarchy.statsHeight).toBeGreaterThan(10);
  await expect(firstRoute.locator('.route-quick-stats svg')).toHaveCount(3);

  await firstRoute.click();
  await expect(page.locator('.route-detail')).toBeVisible();
  await expect(page.locator('.route-trace-detail')).toBeVisible();
  await expect(page.locator('[data-start-full-route]')).toBeVisible();
  await expect(page.locator('.route-itinerary li').first()).toContainText('Start');
  expect(await page.locator('.route-itinerary li').count()).toBeGreaterThanOrEqual(3);
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

test('PWA Navigate full route sends every named checkpoint in order to the map', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await openFromMenu(page, 'routes');
  await page.locator('.curated-route-card').first().click();
  await expect(page.locator('.route-detail')).toBeVisible();

  const itinerary = await page.locator('.route-itinerary li strong').allTextContents();
  expect(itinerary.length).toBeGreaterThanOrEqual(3);
  await page.evaluate(() => {
    window.__curatedItineraryTest = null;
    window.addEventListener('rider-comms:navigate-curated-route', (event) => {
      window.__curatedItineraryTest = event.detail;
    }, { once: true });
  });

  await page.locator('[data-start-full-route]').click();
  const payload = await page.evaluate(() => window.__curatedItineraryTest);
  expect(payload?.routeId).toBeTruthy();
  expect(payload?.stops).toHaveLength(itinerary.length - 1);
  expect([...payload.stops.map((stop) => stop.label), payload.end.label]).toEqual(itinerary);
  for (const point of [...payload.stops, payload.end]) {
    expect(Number.isFinite(point.lat)).toBe(true);
    expect(Number.isFinite(point.lng)).toBe(true);
  }
  await expect(page.locator('[data-screen="map"]')).toHaveClass(/active/);
});

test('PWA keeps unfinished scenic stops when reaching the finish and requests one recovery route', async ({ page }) => {
  await mockAuthenticatedApi(page, 'recovering');
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.google?.maps?.LatLng && window.__riderCommsTestMap));
  await page.evaluate(() => {
    // Preserve the real curated-navigation event and defer the first GPS fix
    // until its destination is known. This uses the existing Maps mock.
    window.__curatedGpsCallbacks = [];
    navigator.geolocation.getCurrentPosition = (success) => {
      window.__curatedGpsCallbacks.push(success);
    };
    window.addEventListener('rider-comms:navigate-curated-route', (event) => {
      const { stops, end } = event.detail;
      window.__curatedTestFinish = end;
      const point = ({ lat, lng }) => new window.google.maps.LatLng(lat, lng);
      // The first catalogue route is a loop (start === finish); choose a
      // distinct intermediate point so the mocked last leg has real geometry.
      const start = point(stops[1] ?? stops[0]);
      const finish = point(end);
      const step = {
        instructions: 'Continue to the scenic finish',
        distance: { value: 1500, text: '1.5 km' },
        duration: { value: 120, text: '2 min' },
        start_location: start,
        end_location: finish,
        path: [start, finish],
      };
      window.__riderCommsTestRoute = { routes: [{ legs: [{
        steps: [step],
        distance: { value: 1500, text: '1.5 km' },
        duration: { value: 120, text: '2 min' },
        start_location: start,
        end_location: finish,
      }] }] };
      window.__riderCommsTestRouteRequests = [];
      for (const resolve of window.__curatedGpsCallbacks.splice(0)) {
        resolve({ timestamp: Date.now(), coords: {
          latitude: end.lat, longitude: end.lng, accuracy: 5, speed: 0, heading: 0,
        } });
      }
    }, { once: true });
  });
  await openFromMenu(page, 'routes');
  await page.locator('.curated-route-card').first().click();
  await page.locator('[data-start-full-route]').click();

  await expect(page.locator('#app')).toHaveClass(/nav-mode/);
  await expect.poll(() => page.evaluate(() => window.__riderCommsTestRouteRequests?.length ?? 0)).toBe(1);
  await page.evaluate(() => {
    const end = window.__curatedTestFinish;
    window.gpsTest.success({ timestamp: Date.now(), coords: {
      latitude: end.lat, longitude: end.lng, accuracy: 5, speed: 0, heading: 0,
    } });
  });
  await expect.poll(() => page.evaluate(() => window.__riderCommsTestRouteRequests?.length ?? 0)).toBe(2);
  const requests = await page.evaluate(() => window.__riderCommsTestRouteRequests);
  expect(requests[0].waypoints.length).toBeGreaterThan(0);
  expect(requests[1].waypoints).toEqual(requests[0].waypoints);
  await expect(page.locator('#app')).toHaveClass(/nav-mode/);

  // The same fix must not trigger another network reroute while stopped.
  await page.evaluate(() => {
    const end = window.__curatedTestFinish;
    window.gpsTest.success({ timestamp: Date.now(), coords: {
      latitude: end.lat, longitude: end.lng, accuracy: 5, speed: 0, heading: 0,
    } });
  });
  expect(await page.evaluate(() => window.__riderCommsTestRouteRequests.length)).toBe(2);
});

test('PWA Routes shows only roads that suit the rider’s vehicle', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  await openFromMenu(page, 'routes');
  const count = page.locator('.routes-count');
  await expect(count).toHaveText('21 rides');
  await page.evaluate(() => window.RiderCuratedRoutes.setVehicle('scooter'));
  await expect(count).toHaveText('15 rides');
  await page.evaluate(() => window.RiderCuratedRoutes.setVehicle('motorcycle_small'));
  await expect(count).toHaveText('21 rides');
});

test('PWA loads no route photos until Routes is opened', async ({ page }) => {
  const photos = [];
  page.on('request', (request) => { if (/assets\/routes\/cards|wikimedia/.test(request.url())) photos.push(request.url()); });
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(photos).toEqual([]);
  await openFromMenu(page, 'routes');
  await expect.poll(() => photos.length).toBeGreaterThan(0);
});
