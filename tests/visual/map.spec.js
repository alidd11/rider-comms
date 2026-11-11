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

test('PWA keeps controls available when movement cannot be verified', async ({ page }) => {
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

test('PWA map has a labelled Go live bar when parked and a glanceable HUD while riding', async ({ page }) => {
  await mockAuthenticatedApi(page, 'recovering');
  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#mapStatusText')).toHaveText('Nearby off');
  const live = page.locator('#joinNearbyBtn');
  await expect(live).toBeVisible();
  await expect(page.locator('#joinNearbyLabel')).toHaveText('Go live');
  const [liveBox, hazardBox] = await Promise.all([live.boundingBox(), page.locator('#reportHazardBtn').boundingBox()]);
  // A wide, labelled primary action beside a smaller hazard button.
  expect(liveBox.width).toBeGreaterThan(hazardBox.width * 2);
  expect(liveBox.height).toBeGreaterThanOrEqual(56);
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

  // The floating controls rest above the drawer, inside the screen.
  const [drawerBox, hazardBox] = await Promise.all([drawer.boundingBox(), page.locator('#reportHazardBtn').boundingBox()]);
  expect(hazardBox.y + hazardBox.height).toBeLessThanOrEqual(drawerBox.y);
  expect(drawerBox.y + drawerBox.height).toBeLessThanOrEqual(page.viewportSize().height + 1);

  // Slide it up: recent places.
  const start = await handle.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  // Part-way through, the list has grown by exactly the slide so far.
  const pressY = start.y + start.height / 2;
  await page.mouse.move(start.x + start.width / 2, pressY - 40, { steps: 4 });
  const midway = await page.locator('#mapDrawerRecent').evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(midway - 40)).toBeLessThanOrEqual(2);
  await page.mouse.move(start.x + start.width / 2, start.y - 120, { steps: 6 });
  await page.mouse.up();
  await expect(drawer).toHaveAttribute('data-state', 'open');
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#mapDrawerRecent')).toContainText('Ace Cafe London');
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
