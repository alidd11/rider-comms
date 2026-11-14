// The map: controls, movement and the riding HUD, the Where to drawer, back behaviour, search and music.
import { expect, test } from '@playwright/test';
import { RIDER_ID, mockAuthenticatedApi, openTab, openFromMenu } from './helpers.js';

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

test('PWA keeps controls available when movement can’t be verified', async ({ page }) => {
  await mockAuthenticatedApi(page, 'unknown');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  // No Ride-safe banner at all, on any screen.
  await expect(page.locator('#movementSafetyBanner')).toHaveCount(0);
  // Unverified movement doesn't lock anything: the menu (and Routes in it)
  // stays available.
  const menuButton = page.locator('#mapAvatarButton');
  await expect(menuButton).toBeVisible();
  await expect(menuButton).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('#mapSearchSlot')).toBeVisible();
  await expect(page.locator('.map-header')).not.toHaveAttribute('inert', '');
  await openFromMenu(page, 'routes');
  await expect(page.locator('[data-screen="routes"]')).toHaveClass(/active/);
});

test('PWA hides the map\'s distracting controls while moving, like the native app', async ({ page }) => {
  await mockAuthenticatedApi(page, 'recovering');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  const moving = (speed) => page.evaluate((metresPerSecond) => {
    const base = Date.now() - 7000;
    for (let i = 0; i <= 7; i++) window.gpsTest.success({
      timestamp: base + i * 1000,
      coords: { latitude: 51.5074 + i * 0.0001 * metresPerSecond, longitude: -0.1278, accuracy: 5, speed: metresPerSecond },
    });
  }, speed);
  await moving(12);
  await expect(page.locator('#app')).toHaveClass(/safety-locked/);
  // Gone, not half see-through over the map.
  for (const selector of ['#mapSearchSlot', '#mapAvatarButton', '#reportHazardBtn']) {
    await expect(page.locator(selector)).toBeHidden();
  }
  await expect(page.locator('#locateBtn')).toBeVisible();
});

test('PWA map has compact Report and Go live buttons when parked and a glanceable HUD while riding', async ({ page }) => {
  await mockAuthenticatedApi(page, 'recovering');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#mapStatusText')).toHaveText('Nearby off');
  const live = page.locator('#joinNearbyBtn');
  await expect(live).toBeVisible();
  await expect(live).toHaveAccessibleName('Go live nearby');
  const [liveBox, hazardBox, locateBox] = await Promise.all([live.boundingBox(), page.locator('#reportHazardBtn').boundingBox(), page.locator('#locateBtn').boundingBox()]);
  // One compact size for all three, above the touch minimum, so the map
  // stays the main thing: Report bottom-left, Go live bottom-right with
  // Centre on me above it.
  for (const box of [liveBox, hazardBox, locateBox]) {
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeLessThanOrEqual(56);
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
  }
  expect(hazardBox.x).toBeLessThan(liveBox.x - 150);
  expect(Math.abs((locateBox.x + locateBox.width) - (liveBox.x + liveBox.width))).toBeLessThanOrEqual(2);
  expect(locateBox.y + locateBox.height).toBeLessThanOrEqual(liveBox.y);
  await expect(page.locator('#ridingHud')).toBeHidden();

  await page.evaluate(() => {
    const base = Date.now() - 7000;
    for (let i = 0; i <= 7; i++) window.gpsTest.success({
      timestamp: base + i * 1000,
      coords: { latitude: 51.5074 + i * 0.0012, longitude: -0.1278, accuracy: 5, speed: 12 },
    });
  });
  await expect(page.locator('#ridingHud')).toBeVisible();
  await expect(page.locator('#mapBottomBar')).toBeHidden();
  await expect(page.locator('#movementSafetyBanner')).toBeHidden();
  await expect(page.locator('#hudSpeedValue')).toHaveText('27');
  const hudHazard = page.locator('#hudHazardBtn');
  const hudBox = await hudHazard.boundingBox();
  expect(hudBox.height).toBeGreaterThanOrEqual(64);
  // Without a voice room there is nothing to mute.
  await expect(page.locator('#hudMuteBtn')).toBeHidden();
  await hudHazard.click();
  await expect(page.locator('#hazardTypeChips')).toBeVisible();
  await expect(page.locator('#hazardAutoClose')).toContainText('Closes in');
});

test('PWA loads the map-matched navigation puck', async ({ page }) => {
  await mockAuthenticatedApi(page, 'recovering');
  await page.goto('/');
  const snapped = await page.evaluate(() => {
    const puck = window.RiderNavigationPuck;
    const path = puck.buildNavigationPathIndex([{ lat: 51.5, lon: -0.12 }, { lat: 51.505, lon: -0.12 }]);
    // 8 m east of the road, heading north at 12 m/s.
    const match = puck.matchFixToPath(path, { lat: 51.502, lon: -0.11988, accuracyMeters: 10, headingDegrees: 0, speedMps: 12 });
    return { snapped: match.snapped, lon: match.lon };
  });
  expect(snapped).toEqual({ snapped: true, lon: -0.12 });
});

test('PWA GPS timeout recovers without another permission request or startup lock', async ({ page }) => {
  await mockAuthenticatedApi(page, 'recovering');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('[data-menu-nav="friends"]')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.locator('[data-menu-nav="ride"]')).not.toHaveAttribute('aria-disabled', 'true');
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
  await openTab(page, 'friends');
  await expect(page.locator('[data-screen="friends"]')).toHaveClass(/active/);
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

test('PWA map drawer slides up to recent places and holds Home, Work and Petrol', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.addInitScript(({ riderId }) => {
    localStorage.setItem(`riderComms.recentSearches:${riderId}`, JSON.stringify([
      { placeId: 'ace', name: 'Ace Cafe London', secondary: 'North Circular Rd', lat: 51.541, lng: -0.277 },
    ]));
  }, { riderId: RIDER_ID });
  await page.goto('/');
  const drawer = page.locator('#mapDrawer');
  const handle = page.locator('#mapDrawerHandle');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('data-state', 'peek');
  await expect(page.locator('#mapDrawerRecent')).toBeHidden();
  await expect(page.locator('#placeSearchInput')).toHaveAttribute('placeholder', 'Where to?');

  // The floating controls rest above the drawer, inside the screen,
  // measured once the screen's 3px slide-in has finished.
  await page.locator('[data-screen="map"]').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const [drawerBox, hazardBox] = await Promise.all([drawer.boundingBox(), page.locator('#reportHazardBtn').boundingBox()]);
  expect(hazardBox.y + hazardBox.height).toBeLessThanOrEqual(drawerBox.y);
  expect(drawerBox.y + drawerBox.height).toBeLessThanOrEqual(page.viewportSize().height + 1);

  // Slide it up: recent places.
  const start = await handle.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  // Part-way through, the drawer has grown by exactly the slide so far (the
  // list itself also runs on through the drawer's bottom padding).
  const pressY = start.y + start.height / 2;
  await page.mouse.move(start.x + start.width / 2, pressY - 40, { steps: 4 });
  const midway = await drawer.evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(midway - drawerBox.height - 40)).toBeLessThanOrEqual(2);
  await page.mouse.move(start.x + start.width / 2, start.y - 120, { steps: 6 });
  await page.mouse.up();
  await expect(drawer).toHaveAttribute('data-state', 'open');
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#mapDrawerRecent')).toContainText('Ace Cafe London');
  // Pulled up, it reaches to just below the avatar and the Nearby chip,
  // leaving room under recent places for more. (A landscape phone is too
  // short for both: the open drawer keeps a usable minimum height there.)
  const viewport = page.viewportSize();
  if (viewport.height > viewport.width) await expect.poll(async () => {
    const [drawerTop, chipBottom] = await Promise.all([
      drawer.evaluate((element) => element.getBoundingClientRect().top),
      page.locator('#mapStatusChip').evaluate((element) => element.getBoundingClientRect().bottom),
    ]);
    return drawerTop - chipBottom;
  }).toBeLessThanOrEqual(40);
  if (viewport.height > viewport.width) expect(await drawer.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(await page.locator('#mapStatusChip').evaluate((element) => element.getBoundingClientRect().bottom));
  await expect(page.locator('#ridePill')).toBeHidden();

  // A recent place puts it on the map; the drawer steps aside for its card
  // and comes back, settled down, once the card is dismissed.
  await page.locator('[data-drawer-recent="0"]').click();
  await expect(page.locator('#destinationCard')).toContainText('Ace Cafe London');
  await page.locator('[data-dismiss-destination]').click();
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('data-state', 'peek');

  // Tapping the handle toggles it; Escape closes it.
  await handle.click();
  await expect(drawer).toHaveAttribute('data-state', 'open');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveAttribute('data-state', 'peek');
  await expect(handle).toBeFocused();

  // Tapping the search opens the full search page.
  await page.locator('#mapSearchSlot').click();
  await expect(page.locator('#searchScreen')).toBeVisible();
  await page.locator('#searchScreenBack').click();

  // Home the first time: search says it is choosing Home, without the
  // category chips, and the chosen place is saved.
  const home = page.locator('[data-saved-place="home"]');
  await expect(home).toHaveAttribute('aria-label', 'Set Home');
  await home.click();
  await expect(page.locator('#searchScreen')).toBeVisible();
  await expect(page.locator('#searchSaveBanner')).toHaveText('Choose your Home');
  await expect(page.locator('#poiChipRow')).toBeHidden();
  await page.locator('#searchScreenResults [data-recent-index="0"]').click();
  await expect(page.locator('#searchScreen')).toBeHidden();
  await expect(home).toHaveAttribute('aria-label', 'Home, Ace Cafe London');
  await page.locator('[data-dismiss-destination]').click();
  // Then one tap starts the route, with the rider's navigation app
  // (Google Maps unless they chose another).
  await page.evaluate(() => {
    window.openedUrls = [];
    window.open = (url) => { window.openedUrls.push(String(url)); return null; };
  });
  await home.click();
  await expect(page.locator('#searchScreen')).toBeHidden();
  await expect(page.locator('#destinationCard')).toContainText('Ace Cafe London');
  const opened = await page.evaluate(() => window.openedUrls);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain('https://www.google.com/maps/dir/');
  expect(opened[0]).toContain('51.541');
  await page.locator('[data-dismiss-destination]').click();
  // Press and hold (or right-click) to change or remove it.
  await home.dispatchEvent('contextmenu');
  await expect(page.locator('#sheetTitle')).toHaveText('Home');
  await page.locator('#savedPlaceRemove').click();
  await expect(home).toHaveAttribute('aria-label', 'Set Home');
  await expect(page.locator('[data-saved-place="work"]')).toHaveAttribute('aria-label', 'Set Work');

  // Petrol opens search on nearby petrol stations.
  await page.locator('#drawerPetrol').click();
  await expect(page.locator('#searchScreen')).toBeVisible();
  await expect(page.locator('#searchSaveBanner')).toBeHidden();
  await expect(page.locator('.poi-chip[data-poi-type="gas_station"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#searchScreenBack').click();

  // Ride and Friends live in the menu, and back returns to the map.
  await page.locator('#mapAvatarButton').click();
  await page.locator('[data-menu-nav="ride"]').click();
  await expect(page.locator('[data-screen="ride"]')).toBeVisible();
  await page.locator('.screen.active [data-back-to-map]').click();
  await expect(drawer).toBeVisible();

  // Turn-by-turn navigation owns the bottom of the map: no drawer.
  await page.evaluate(() => document.querySelector('#app').classList.add('nav-mode'));
  await expect(drawer).toBeHidden();
});

test('PWA back gesture closes overlays first and the map stays one step back', async ({ page }) => {
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await expect(page.locator('#mapDrawer')).toBeVisible();
  const onScreen = (name) => expect(page.locator(`.screen[data-screen="${name}"]`)).toHaveClass(/active/);

  // The menu closes on back, leaving the map.
  await page.locator('#mapAvatarButton').click();
  await expect(page.locator('#appMenu')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#appMenu')).toBeHidden();
  await onScreen('map');

  // A sheet opened from the menu closes on back.
  await page.locator('#mapAvatarButton').click();
  await page.locator('[data-menu-sheet="help"]').click();
  await expect(page.locator('#sheetBackdrop')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#sheetBackdrop')).toBeHidden();
  await onScreen('map');

  // Search and the expanded drawer close on back too.
  await page.locator('#mapSearchSlot').click();
  await expect(page.locator('#searchScreen')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#searchScreen')).toBeHidden();
  await page.locator('#mapDrawerHandle').click();
  await expect(page.locator('#mapDrawer')).toHaveAttribute('data-state', 'open');
  await page.goBack();
  await expect(page.locator('#mapDrawer')).toHaveAttribute('data-state', 'peek');
  await onScreen('map');

  // Back to map steps back, so a later back never returns to Friends.
  await page.locator('#mapAvatarButton').click();
  await page.locator('[data-menu-nav="friends"]').click();
  await onScreen('friends');
  await page.locator('.screen.active [data-back-to-map]').click();
  await onScreen('map');
  await page.locator('#mapAvatarButton').click();
  await page.locator('[data-menu-nav="ride"]').click();
  await onScreen('ride');
  await page.goBack();
  await onScreen('map');

  // A settings page steps up one level on back, then the screen goes back.
  await page.locator('#mapAvatarButton').click();
  await page.locator('[data-menu-nav="settings"]').click();
  await onScreen('settings');
  await page.locator('#settingsList [data-settings-open="general"]').click();
  await expect(page.locator('#sheetBackdrop')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#sheetBackdrop')).toBeHidden();
  await onScreen('settings');
  // A sheet closed with its own button leaves no dead back press behind.
  await page.locator('#settingsList [data-settings-open="general"]').click();
  await page.locator('#closeSheetAll').click();
  await expect(page.locator('#sheetBackdrop')).toBeHidden();
  await page.goBack();
  await onScreen('map');
});

test('PWA says when the connection drops and clears the notice when it returns', async ({ page, context }) => {
  await mockAuthenticatedApi(page, 'stationary');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  const banner = page.locator('#offlineBanner');
  await expect(banner).toBeHidden();

  await context.setOffline(true);
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText(/No connection/);
  // The notice must never block the map or controls underneath it.
  expect(await banner.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');

  await context.setOffline(false);
  await expect(banner).toBeHidden();
});

test('PWA place search and the category chips use the backend Places endpoints, like the native app', async ({ page }) => {
  const calls = [];
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (!url.pathname.startsWith('/places/')) return null;
    const body = JSON.parse(request.postData() || '{}');
    calls.push({ path: url.pathname, body });
    if (url.pathname === '/places/autocomplete') {
      return { body: { suggestions: [{ id: 'place-ace', name: 'Ace Cafe London', address: 'North Circular Road, London', distanceMeters: 8200 }] } };
    }
    if (url.pathname === '/places/details') {
      return { body: { place: { id: 'place-ace', name: 'Ace Cafe London', address: 'North Circular Road, London', lat: 51.5413, lon: -0.2796 } } };
    }
    return { body: { places: [
      { id: 'fuel-far', name: 'Far Fuel', address: 'Far Road', lat: 51.52, lon: -0.1278 },
      { id: 'fuel-near', name: 'Near Fuel', address: 'Near Road', lat: 51.508, lon: -0.1278 },
    ] } };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.__riderCommsTestMap))).toBe(true);
  // No Places library on the map script any more.
  expect(await page.evaluate(() => Boolean(window.google?.maps?.places?.AutocompleteService && document.querySelector('script[src*="libraries=places"]')))).toBe(false);

  await page.locator('#mapSearchSlot').click();
  await page.locator('#searchScreenInput').fill('ace');
  const row = page.locator('#searchScreenResults [data-place-id="place-ace"]');
  await expect(row).toContainText('Ace Cafe London');
  await expect(row).toContainText('North Circular Road, London');
  const suggest = calls.find((call) => call.path === '/places/autocomplete');
  expect(suggest.body.input).toBe('ace');
  expect(suggest.body.near).toEqual({ lat: 51.5074, lon: -0.1278 });
  expect(suggest.body.sessionToken).toMatch(/^rc[0-9a-f]{30}$/);
  await row.click();
  await expect(page.locator('#searchScreen')).toBeHidden();
  await expect(page.locator('#destinationCard')).toContainText('Ace Cafe London');
  // The pick ends the same billing session the suggestions used.
  const details = calls.find((call) => call.path === '/places/details');
  expect(details.body).toEqual({ placeId: 'place-ace', sessionToken: suggest.body.sessionToken });
  await page.locator('[data-dismiss-destination]').click();

  // Petrol: nearest first.
  await page.locator('#drawerPetrol').click();
  await expect(page.locator('#searchScreenResults .nearby-result-row strong')).toHaveText(['Near Fuel', 'Far Fuel']);
  const nearby = calls.find((call) => call.path === '/places/nearby');
  expect(nearby.body.includedTypes).toEqual(['gas_station']);
});

test('PWA map and navigation cards turn dark when sunset passes while the app stays open', async ({ page }) => {
  // 15:00 in London on 13 Nov: daylight. Sunset is about 16:15.
  await page.clock.install({ time: new Date('2026-11-13T15:00:00Z') });
  await page.emulateMedia({ colorScheme: 'light' });
  await mockAuthenticatedApi(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__riderCommsTestMap?.options?.colorScheme ?? null)).toBe('FOLLOW_SYSTEM');
  const before = await page.evaluate(() => (window.__riderCommsTestMaps || []).length);
  // Navigation cards are white over the day map.
  await expect(page.locator('html')).toHaveClass(/map-day/);
  expect(await page.locator('#navSummary').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');

  // 22:39 the same evening: the open map is rebuilt dark, keeping its markers.
  await page.clock.setSystemTime(new Date('2026-11-13T22:39:00Z'));
  await page.clock.runFor(61_000);
  await expect.poll(() => page.evaluate(() => window.__riderCommsTestMap?.options?.colorScheme ?? null)).toBe('DARK');
  const after = await page.evaluate(() => {
    const maps = window.__riderCommsTestMaps || [];
    const current = maps[maps.length - 1];
    const markers = window.__riderCommsTestMarkers || [];
    return {
      count: maps.length,
      onOldMap: markers.filter((marker) => marker.map && marker.map !== current).length,
      background: current.options.backgroundColor,
    };
  });
  expect(after.count).toBe(before + 1);
  expect(after.onOldMap).toBe(0);
  expect(after.background).toBe('#080d10');
  // ...and dark again over the night map.
  await expect(page.locator('html')).not.toHaveClass(/map-day/);
  expect(await page.locator('#navSummary').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');

  // Another minute at night changes nothing.
  await page.clock.runFor(61_000);
  expect(await page.evaluate(() => (window.__riderCommsTestMaps || []).length)).toBe(after.count);
});

test('PWA works out the riding speed from GPS fixes when Safari reports none', async ({ page }) => {
  await mockAuthenticatedApi(page, 'recovering');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  // Fixes two seconds apart, 22 m further north each time (about 25 mph),
  // with no speed of their own, as iOS Safari often sends them.
  await page.evaluate(() => {
    const base = Date.now() - 14_000;
    for (let i = 0; i <= 7; i++) window.gpsTest.success({
      timestamp: base + i * 2000,
      coords: { latitude: 51.5074 + i * 0.0002, longitude: -0.1278, accuracy: 5, speed: null },
    });
  });
  await expect(page.locator('#ridingHud')).toBeVisible();
  await expect(page.locator('#hudSpeedValue')).toHaveText('25');

  // Standing still, with the fix wandering inside its accuracy: 0, not a guess.
  await page.evaluate(() => {
    const base = Date.now();
    for (let i = 1; i <= 4; i++) window.gpsTest.success({
      timestamp: base + i * 2000,
      coords: { latitude: 51.5088 + (i % 2) * 0.00001, longitude: -0.1278, accuracy: 8, speed: -1 },
    });
  });
  await expect(page.locator('#hudSpeedValue')).toHaveText('0');
});

test('PWA keeps a road report made with no signal and sends it when signal returns', async ({ page }) => {
  let signal = false;
  const sent = [];
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/hazards' && request.method() === 'POST') {
      const report = request.postDataJSON();
      sent.push(report.type);
      return { status: 201, body: { id: 'hz_queued', ...report, reportedBy: RIDER_ID, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000, confirmations: 0, denials: 0 } };
    }
    return null;
  });
  // Registered after the mock, so it's consulted first: no signal drops the
  // report before it reaches the server.
  await page.route('https://backend-production-7fa0.up.railway.app/hazards', (route) => (
    !signal && route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback()
  ));
  await page.addInitScript(() => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(utterance) { window.__spoken.push(utterance.text); } } });
  });
  await page.clock.install();
  await page.goto('/');

  await page.locator('#reportHazardBtn').click();
  await page.locator('[data-hazard-type="police"]').click();
  // The sheet closes rather than holding the rider there with an error.
  await expect(page.locator('#sheetBackdrop')).toBeHidden();
  await expect(page.locator('#appNotification')).toContainText('No signal. Your police report will send when you’re back in signal.');
  expect(sent).toEqual([]);

  signal = true;
  await page.clock.runFor(16_000);
  await expect.poll(() => sent).toEqual(['police']);
  await expect(page.locator('#appNotification')).toContainText('Police report sent.');
  expect(await page.evaluate(() => window.__spoken)).toEqual([
    'No signal. Your police report will send when you’re back in signal.',
    'Police report sent.',
  ]);
  // Sent once only.
  await page.clock.runFor(30_000);
  expect(sent).toEqual(['police']);
});

test('PWA sends a road report still waiting from when the app was last closed, then forgets it', async ({ page }) => {
  const sent = [];
  await mockAuthenticatedApi(page, 'stationary', async ({ request, url }) => {
    if (url.pathname === '/hazards' && request.method() === 'POST') {
      const report = request.postDataJSON();
      sent.push(report);
      return { status: 201, body: { id: 'hz_saved', ...report, reportedBy: RIDER_ID, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000, confirmations: 0, denials: 0 } };
    }
    return null;
  });
  await page.addInitScript(({ riderId }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(`riderComms.queuedHazardReports.${riderId}`, JSON.stringify([
      { hazardType: 'road_closure', lat: 51.49, lon: -0.12, queuedAt: Date.now() },
      { hazardType: 'not-a-hazard', lat: 1, lon: 1, queuedAt: Date.now() },
    ]));
    // Someone else's waiting report on this browser is never sent.
    localStorage.setItem('riderComms.queuedHazardReports.rider_other', JSON.stringify([
      { hazardType: 'police', lat: 51, lon: 0, queuedAt: Date.now() },
    ]));
  }, { riderId: RIDER_ID });
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('#reportHazardBtn')).toBeVisible();
  await page.clock.runFor(16_000);
  await expect.poll(() => sent).toEqual([{ type: 'road_closure', lat: 51.49, lon: -0.12 }]);
  await expect(page.locator('#appNotification')).toContainText('Road closure report sent.');
  expect(await page.evaluate((riderId) => localStorage.getItem(`riderComms.queuedHazardReports.${riderId}`), RIDER_ID)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('riderComms.queuedHazardReports.rider_other'))).not.toBeNull();
});
