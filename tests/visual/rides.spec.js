// Private group rides: consent, location sharing, speakers and the roster.
import { expect, test } from '@playwright/test';
import { RIDER_ID, PROFILE, mockAuthenticatedApi, openTab } from './helpers.js';

test('friend profile exposes only fresh consented private-ride location actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-17-pro-max-webkit', 'Friend-profile mockup screenshot targets iPhone 17 Pro Max geometry.');

  const rideId = 'ride_visual01';
  const friendLocation = { riderId: 'rider_friend01', lat: 51.5142, lon: -0.1183, updatedAt: Date.now() };
  const ride = {
    rideId,
    createdBy: RIDER_ID,
    createdAt: Date.now() - 60_000,
    memberIds: [RIDER_ID, 'rider_friend01'],
    shareRideLocation: true,
    code: 'RIDE01',
  };
  let rideLocationReads = 0;

  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/rides/current') return { body: { ride } };
    if (url.pathname === `/rides/${rideId}` && request.method() === 'GET') return { body: ride };
    if (url.pathname === `/rides/${rideId}/locations`) {
      rideLocationReads += 1;
      return {
        body: {
          locations: [
            { riderId: RIDER_ID, lat: 51.5074, lon: -0.1278, updatedAt: Date.now() },
            { ...friendLocation, updatedAt: Date.now() },
          ],
        },
      };
    }
    if (url.pathname === `/profiles/${RIDER_ID}`) {
      return { body: { riderId: RIDER_ID, displayName: PROFILE.displayName, handle: PROFILE.handle, avatarId: PROFILE.avatarId, instagramUsername: '', tiktokUsername: '' } };
    }
    if (url.pathname === '/profiles/rider_friend01') {
      return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge', instagramUsername: '', tiktokUsername: '' } };
    }
    if (url.pathname === '/friends/activity') {
      return { body: { activity: [{ riderId: 'rider_friend01', online: true, lastSeenAt: Date.now() }] } };
    }
    return null;
  });

  await page.goto('/');
  await expect(page.locator('#app')).toBeVisible();
  await expect.poll(() => page.locator('#activeRideLocationConsent').isChecked()).toBe(true);
  await expect.poll(() => rideLocationReads).toBeGreaterThan(0);

  await openTab(page, 'friends');
  await page.locator('#friendList [data-friend="rider_friend01"]').click();
  await expect(page.locator('.friend-profile-card')).toBeVisible();
  await expect(page.locator('#shareFriendId')).toHaveCount(0);
  await expect(page.locator('#shareFriendLocation')).toBeEnabled();
  await expect(page.locator('#shareFriendLocation')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#shareFriendLocation')).toContainText('Sharing location');
  await expect(page.locator('#shareFriendLocation')).toHaveAttribute('aria-label', 'Stop sharing your location with this group ride');
  await expect(page.locator('#shareFriendLocation')).toHaveAttribute('title', 'Shares your location with everyone in your current group ride, not just this rider.');
  await expect(page.locator('#friendMapAction')).toBeEnabled();
  await expect(page.locator('.friend-profile-detail-list')).toContainText('Location');
  await expect(page.locator('.friend-profile-detail-list')).toContainText('Shared in your current ride');
  await expect(page.locator('.friend-profile-detail-list')).toContainText('Group ride');
  await expect(page.locator('.friend-profile-detail-list')).toContainText('2 riders');
  await expect(page.locator('#viewFriendOnMap')).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath('iphone-17-pro-max-friend-detail-shared-ride.png'),
    fullPage: true,
  });

  await page.locator('#friendMapAction').click();
  await expect(page.locator('[data-screen="map"]')).toHaveClass(/active/);
  await expect.poll(async () => page.evaluate(() => {
    const centre = window.__riderCommsTestMap?.centre;
    return centre ? [centre.lat, centre.lng] : null;
  })).toEqual([friendLocation.lat, friendLocation.lon]);
});

test('PWA restores server ride consent and clears a removed cached ride on reopen', async ({ page }) => {
  let currentRide = {
    rideId: 'ride-reopen-1', code: 'ABCDEF', createdBy: RIDER_ID,
    memberIds: [RIDER_ID], shareRideLocation: true,
  };
  await mockAuthenticatedApi(page, 'stationary', ({ url }) =>
    url.pathname === '/rides/current' ? { body: { ride: currentRide } } : null);
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({
      screen: 'ride', profile,
      activeRide: { rideId: 'ride-reopen-1', code: 'OLD123', memberIds: [riderId], shareRideLocation: false },
    }));
  }, { riderId: RIDER_ID, profile: PROFILE });
  await page.goto('/');
  await expect(page.locator('#rideActiveState')).toBeVisible();
  await expect(page.locator('#activeRideCode')).toHaveText('ABCDEF');
  await expect(page.locator('#activeRideLocationConsent')).toBeChecked();
  await expect(page.locator('#rideVoiceStatus')).toContainText('Resume voice');
  currentRide = null;
  await page.reload();
  await expect(page.locator('#rideJoinState')).toBeVisible();
  await expect(page.locator('#rideActiveState')).toBeHidden();
  const cached = await page.evaluate((id) => JSON.parse(localStorage.getItem(`rider-comms-pwa-v4:${id}`)), RIDER_ID);
  expect(cached.activeRide).toBeNull();
});

test('PWA resumes consented ride location after its first GPS fix and maps members at real coordinates', async ({ page }) => {
  let uploads = 0;
  const other = { riderId: 'rider_guest01', displayName: 'Guest Rider', handle: '@guest_rider' };
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/rides/current') return { body: { ride: {
      rideId: 'ride-reopen-1', code: 'ABCDEF', createdBy: RIDER_ID,
      memberIds: [RIDER_ID, other.riderId], shareRideLocation: true,
    } } };
    if (url.pathname === `/profiles/${other.riderId}`) return { body: other };
    if (url.pathname === '/rides/ride-reopen-1/location' && request.method() === 'POST') {
      uploads += 1;
      return { body: { ok: true } };
    }
    if (url.pathname === '/rides/ride-reopen-1/locations') return { body: { locations: [
      { riderId: other.riderId, lat: 51.51, lon: -0.13, recordedAt: Date.now() },
    ] } };
    return null;
  });
  await page.goto('/');
  await expect(page.locator('#activeRideLocationConsent')).toBeChecked();
  await expect.poll(() => uploads).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const markers = window.__riderCommsTestMarkers || [];
    return markers.filter((marker) => marker.title === 'Guest Rider').map((marker) => marker.position);
  })).toContainEqual({ lat: 51.51, lng: -0.13 });
  const guestPositions = await page.evaluate(() => (window.__riderCommsTestMarkers || [])
    .filter((marker) => marker.title === 'Guest Rider').map((marker) => marker.position));
  expect(guestPositions.every((point) => point.lat === 51.51 && point.lng === -0.13)).toBe(true);
});

test('PWA keeps private-ride speaker identity visible across tabs', async ({ page }) => {
  let currentRide = null;
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === '/rides/current' && request.method() === 'GET') {
      return { body: { ride: currentRide } };
    }
    if (url.pathname === '/rides' && request.method() === 'POST') {
      currentRide = {
        rideId: 'ride-speaker-1',
        code: 'VOICE1',
        createdBy: RIDER_ID,
        memberIds: [RIDER_ID, 'rider_friend01'],
        shareRideLocation: false,
      };
      return { body: currentRide };
    }
    if (url.pathname === `/profiles/${RIDER_ID}`) {
      return { body: PROFILE };
    }
    if (url.pathname === '/profiles/rider_friend01') {
      return { body: { riderId: 'rider_friend01', displayName: 'Maya', handle: '@maya_moto', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      return { body: { token: 'private-ride-token', url: 'wss://voice.example.test' } };
    }
    return null;
  });

  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    class FakeAudioContext {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() {
        return {
          fftSize: 512,
          frequencyBinCount: 32,
          getByteTimeDomainData(data) { data.fill(128); },
        };
      }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  });

  // These tests serve a fake LiveKit build, which the real SRI hash would
  // reject; ignore the integrity attribute for the stub only.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLScriptElement.prototype, 'integrity', { configurable: true, get() { return ''; }, set() {} });
  });
  await page.route('https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      (() => {
        const RoomEvent = {
          TrackSubscribed: 'trackSubscribed',
          TrackUnsubscribed: 'trackUnsubscribed',
          ActiveSpeakersChanged: 'activeSpeakersChanged',
          Reconnected: 'reconnected',
          Disconnected: 'disconnected',
        };
        const Track = { Kind: { Audio: 'audio' } };
        class Room {
          constructor() {
            this.handlers = new Map();
            this.canPlaybackAudio = true;
            this.localParticipant = { setMicrophoneEnabled: async () => {} };
          }
          on(event, handler) {
            const handlers = this.handlers.get(event) || [];
            handlers.push(handler);
            this.handlers.set(event, handlers);
            return this;
          }
          emit(event, ...args) {
            for (const handler of this.handlers.get(event) || []) handler(...args);
          }
          async connect() {
            setTimeout(() => this.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'rider_friend01' }]), 0);
          }
          async startAudio() { this.canPlaybackAudio = true; }
          async disconnect() { this.emit(RoomEvent.Disconnected); }
        }
        window.LivekitClient = { Room, RoomEvent, Track };
      })();
    `,
  }));

  const initialRideRestore = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/rides/current' && response.request().method() === 'GET';
  });
  await page.goto('/');
  await initialRideRestore;
  await openTab(page, 'ride');
  // "Start a ride" sits beside "Join a ride" on the Ride page.
  await expect(page.locator('#createRideBtn')).toBeVisible();
  await page.locator('#createRideBtn').click();

  // On the Ride screen its own voice chip names the speaker; the floating
  // pill (a shortcut to this screen) is hidden here.
  await expect(page.locator('#rideVoiceStatusText')).toHaveText('Maya speaking');
  await expect(page.locator('#ridePill')).toBeHidden();
  await expect(page.locator('#ridePill small')).toHaveText('Maya speaking');
  await expect(page.locator('#ridePill')).toHaveAttribute('aria-label', 'Active ride · Maya speaking');

  await openTab(page, 'friends');
  await expect(page.locator('[data-screen="friends"]')).toHaveClass(/active/);
  await expect(page.locator('#ridePill')).toBeVisible();
  await expect(page.locator('#ridePill small')).toHaveText('Maya speaking');
});

test('PWA host can remove another rider from a private ride', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) =>
    url.pathname === '/rides/current' ? { body: { ride: {
      rideId: 'ride-visual-1', code: 'ABCDEF', createdBy: RIDER_ID,
      memberIds: [RIDER_ID, 'rider_guest01'], shareRideLocation: false,
    } } } : null);
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
});

test('PWA ride roster offers report and block for other riders', async ({ page }) => {
  const reports = [];
  const blocks = [];
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/rides/current') return { body: { ride: {
      rideId: 'ride-visual-1', code: 'ABCDEF', createdBy: RIDER_ID,
      memberIds: [RIDER_ID, 'rider_guest01'], shareRideLocation: false,
    } } };
    if (url.pathname === '/rides/ride-visual-1' && request.method() === 'GET') return { body: {
      rideId: 'ride-visual-1', createdBy: RIDER_ID, createdAt: Date.now(), memberIds: [RIDER_ID, 'rider_guest01'],
    } };
    if (url.pathname === '/profiles/rider_guest01') return { body: { riderId: 'rider_guest01', displayName: 'Guest Rider', handle: '@guest_rider' } };
    if (url.pathname === '/reports' && request.method() === 'POST') { reports.push(request.postDataJSON()); return { status: 201, body: { ok: true } }; }
    if (url.pathname === '/blocks' && request.method() === 'POST') { blocks.push(request.postDataJSON()); return { status: 201, body: { ok: true } }; }
    return null;
  });
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({
      screen: 'ride',
      profile,
      activeRide: {
        rideId: 'ride-visual-1', code: 'ABCDEF', isHost: true, createdBy: riderId,
        memberIds: [riderId, 'rider_guest01'],
        members: [
          { riderId, displayName: profile.displayName, handle: profile.handle },
          { riderId: 'rider_guest01', displayName: 'Guest Rider', handle: '@guest_rider' },
        ],
        shareRideLocation: false,
      },
    }));
  }, { riderId: RIDER_ID, profile: PROFILE });

  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/#ride');
  await expect(page.locator(`[data-rider-safety="${RIDER_ID}"]`)).toHaveCount(0);
  await page.locator('[data-rider-safety="rider_guest01"]').click();
  await page.locator('#riderReportBtn').click();
  await page.locator('[data-report-rider="harassment"]').click();
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]).toMatchObject({ riderId: 'rider_guest01', reason: 'harassment', details: 'Reported from the ride roster' });

  await page.locator('[data-rider-safety="rider_guest01"]').click();
  await page.locator('#riderBlockBtn').click();
  await expect.poll(() => blocks.length).toBe(1);
  expect(blocks[0]).toEqual({ riderId: 'rider_guest01' });
});

test('PWA ride roster shows this rider from their own profile', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => (url.pathname === '/rides/current'
    ? { body: { ride: { rideId: 'ride-visual-1', code: 'ABCDEF', createdBy: RIDER_ID, memberIds: [RIDER_ID], shareRideLocation: false } } }
    : null));
  await page.goto('/#ride');
  await expect(page.locator('#rideRoster')).toContainText(`${PROFILE.displayName} · You`);
  await expect(page.locator('#rideRoster')).not.toContainText(RIDER_ID);
});

test('PWA join failures say what to do next and keep the code to fix', async ({ page }) => {
  let reply = { status: 404, body: { error: 'invalid_or_expired' } };
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => (
    url.pathname === '/rides/join' && request.method() === 'POST' ? reply : null
  ));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
  });
  await page.goto('/');
  await openTab(page, 'ride');
  const code = page.locator('#rideCode');
  const error = page.locator('#rideError');
  await code.fill('ABC234');
  await page.locator('#joinRideForm button[type="submit"]').click();
  await expect(error).toHaveText('That code doesn’t match an active ride. Check it with your host.');
  await expect(code).toHaveValue('ABC234');

  reply = { status: 409, body: { error: 'ride_full' } };
  await page.locator('#joinRideForm button[type="submit"]').click();
  await expect(error).toHaveText('This ride is full (20 riders max). Ask the host to start another.');

  // No connection is a different problem from a bad code.
  await page.route('https://backend-production-7fa0.up.railway.app/rides/join', (route) => route.abort('internetdisconnected'));
  await page.locator('#joinRideForm button[type="submit"]').click();
  await expect(error).toHaveText('Couldn’t reach Rider Comms. Check your connection and try again.');
});

test('PWA shows the host’s regroup point to the group, and the host can clear and set it', async ({ page }) => {
  const esso = { lat: 51.52, lon: -0.11, label: 'Esso, A1', setAt: 1 };
  let regroup = esso;
  const requests = [];
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/rides/current') return { body: { ride: {
      rideId: 'ride-regroup-1', code: 'ABCDEF', createdBy: RIDER_ID,
      memberIds: [RIDER_ID], shareRideLocation: false, regroup,
    } } };
    if (url.pathname === '/rides/ride-regroup-1/regroup') {
      const body = request.postDataJSON?.() ?? null;
      requests.push({ method: request.method(), body });
      regroup = request.method() === 'PUT' ? { ...body, setAt: 2 } : null;
      return { body: { regroup } };
    }
    return null;
  });
  await page.goto('/');
  const chip = page.locator('#regroupChip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Regroup · Esso, A1');
  // Layout can land a hair under a whole pixel (43.99999 on CI); round first.
  expect(Math.round((await chip.boundingBox()).height)).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => (window.__riderCommsTestMarkers || [])
    .some((marker) => marker.position?.lat === 51.52 && marker.position?.lng === -0.11))).toBe(true);

  // One tap shows the place with its route; the host can clear it.
  await chip.click();
  const card = page.locator('#destinationCard');
  await expect(card).toContainText('Esso, A1');
  await expect(card).toContainText('Regroup point · set by the host');
  await card.getByRole('button', { name: 'Clear the regroup point' }).click();
  await expect(chip).toBeHidden();
  expect(requests).toEqual([{ method: 'DELETE', body: null }]);

  // With no regroup point the same place offers "Regroup here".
  await card.getByRole('button', { name: 'Regroup here' }).click();
  await expect(chip).toBeVisible();
  expect(requests[1]).toEqual({ method: 'PUT', body: { lat: 51.52, lon: -0.11, label: 'Esso, A1' } });
});

test('PWA tells the host when the regroup point could not be saved', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => {
    if (url.pathname === '/rides/current') return { body: { ride: {
      rideId: 'ride-regroup-2', code: 'ABCDEF', createdBy: RIDER_ID, memberIds: [RIDER_ID], shareRideLocation: false,
      regroup: { lat: 51.52, lon: -0.11, label: '', setAt: 1 },
    } } };
    if (url.pathname === '/rides/ride-regroup-2/regroup') return { status: 503, body: { error: 'unavailable' } };
    return null;
  });
  await page.goto('/');
  await expect(page.locator('#regroupChip')).toContainText('Regroup · Regroup point');
  await page.locator('#regroupChip').click();
  await page.getByRole('button', { name: 'Clear the regroup point' }).click();
  await expect(page.locator('#destinationCard')).toContainText('Couldn’t reach Rider Comms. Check your connection and try again.');
  await expect(page.getByRole('button', { name: 'Clear the regroup point' })).toBeEnabled();
});

test('PWA greys out a ride member whose updates stopped and says when they were last seen', async ({ page }) => {
  const other = { riderId: 'rider_quiet01', displayName: 'Quiet Rider', handle: '@quiet' };
  await mockAuthenticatedApi(page, 'stationary', ({ request, url }) => {
    if (url.pathname === '/rides/current') return { body: { ride: {
      rideId: 'ride-quiet-1', code: 'ABCDEF', createdBy: RIDER_ID,
      memberIds: [RIDER_ID, other.riderId], shareRideLocation: true,
    } } };
    if (url.pathname === `/profiles/${other.riderId}`) return { body: other };
    if (url.pathname === '/rides/ride-quiet-1/location' && request.method() === 'POST') return { body: { ok: true } };
    if (url.pathname === '/rides/ride-quiet-1/locations') return { body: { locations: [
      { riderId: other.riderId, lat: 51.51, lon: -0.13, updatedAt: Date.now() - 3 * 60_000 - 5_000 },
    ] } };
    return null;
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window.__riderCommsTestMarkers || [])
    .find((marker) => marker.position?.lat === 51.51)?.label?.text)).toBe('Quiet · 3 min ago');
  expect(await page.evaluate(() => (window.__riderCommsTestMarkers || [])
    .find((marker) => marker.position?.lat === 51.51)?.title)).toBe('Quiet Rider · last seen 3 min ago');
});

test('PWA ride ticket shows the code large with Copy code and Share invite', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => url.pathname === '/rides/current'
    ? { body: { ride: { rideId: 'ride-ticket-1', code: 'K7Q2MX', createdBy: 'rider_host01', memberIds: [RIDER_ID, 'rider_host01'], shareRideLocation: false } } }
    : null);
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied = text; } } }); });
  await page.goto('/');
  await openTab(page, 'ride');
  const ticket = page.locator('.ride-ticket');
  await expect(ticket).toContainText('Ride live');
  await expect(ticket).toContainText('2 riders · You are member');
  await expect(page.locator('#activeRideCode')).toHaveText('K7Q2MX');
  await expect(page.locator('#rideRosterCount')).toHaveText('2');
  await page.getByRole('button', { name: 'Copy ride code' }).click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toBe('K7Q2MX');
  await expect(page.getByRole('button', { name: 'Share invite' })).toBeVisible();
  for (const button of await ticket.locator('.ride-ticket-actions .button').all()) {
    expect(Math.round((await button.boundingBox()).height)).toBeGreaterThanOrEqual(44);
  }
});

test('PWA tells a member, on screen and aloud, when the host sets a regroup point', async ({ page }) => {
  let regroup = null;
  await mockAuthenticatedApi(page, 'stationary', ({ url }) => url.pathname === '/rides/current'
    ? { body: { ride: { rideId: 'ride-announce-1', code: 'ABCDEF', createdBy: 'rider_host01', memberIds: [RIDER_ID, 'rider_host01'], shareRideLocation: false, regroup } } }
    : null);
  await page.addInitScript(() => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(utterance) { window.__spoken.push(utterance.text); } } });
  });
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('#regroupChip')).toBeHidden();
  // The host sets a point; the member's next ride poll picks it up.
  regroup = { lat: 51.52, lon: -0.11, label: 'Esso, A1', setAt: 5 };
  await page.clock.runFor(11_000);
  await expect(page.locator('#regroupChip')).toContainText('Esso, A1');
  await expect(page.getByText('Regroup at Esso, A1.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual(['Regroup at Esso, A1.']);
  // The same point on the next poll says nothing more.
  await page.clock.runFor(11_000);
  expect(await page.evaluate(() => window.__spoken)).toEqual(['Regroup at Esso, A1.']);
});
