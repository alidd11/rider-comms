// Nearby: going live, public presence and Nearby Voice.
import { expect, test } from '@playwright/test';
import { RIDER_ID, PROFILE, mockAuthenticatedApi } from './helpers.js';

test('PWA clears persisted Nearby live state instead of auto-rejoining after reload', async ({ page }) => {
  let presenceUpdates = 0;
  let presenceDeletes = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) return { body: { ...PROFILE, shareLocation: true } };
    if (url.pathname === '/presence' && request.method() === 'POST') presenceUpdates += 1;
    if (url.pathname === '/presence' && request.method() === 'DELETE') {
      presenceDeletes += 1;
      return { body: {} };
    }
    return null;
  });
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ screen: 'map', profile, publicLive: true }));
  }, { riderId: RIDER_ID, profile: { ...PROFILE, shareLocation: true } });
  await page.goto('/');
  await expect.poll(() => presenceDeletes).toBeGreaterThan(0);
  expect(presenceUpdates).toBe(0);
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'false');
  const cached = await page.evaluate((riderId) =>
    JSON.parse(localStorage.getItem(`rider-comms-pwa-v4:${riderId}`) || '{}'), RIDER_ID);
  expect(cached.publicLive).toBe(false);
});

test('PWA Nearby control switches public visibility and proximity voice off together', async ({ page }) => {
  let shareLocation = false;
  let presenceUpdates = 0;
  let presenceDeletes = 0;
  const profileSharingUpdates = [];

  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') {
          shareLocation = update.shareLocation;
          profileSharingUpdates.push(update.shareLocation);
        }
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      presenceUpdates += 1;
      return { body: { inZoneWith: [], transitions: [], radiusMiles: 1 } };
    }
    if (url.pathname === '/presence' && request.method() === 'DELETE') {
      presenceDeletes += 1;
      return { body: {} };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      return { body: { connections: [], refreshAfterMs: 20_000 } };
    }
    return null;
  });

  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    window.LivekitClient = {};
  });

  await page.goto('/');
  const nearby = page.locator('#joinNearbyBtn');

  await expect(nearby).toHaveAttribute('data-active', 'false');
  await expect(nearby).toHaveAttribute('aria-label', 'Go live nearby');
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');
  await expect(nearby).toHaveAttribute('aria-busy', 'false');
  const locationCallsBeforeNearby = await page.evaluate(() => window.__riderCommsGetCurrentPositionCalls);

  await nearby.click();
  await expect.poll(() => presenceUpdates).toBe(1);
  await expect.poll(() => profileSharingUpdates.at(-1)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__riderCommsGetCurrentPositionCalls)).toBe(locationCallsBeforeNearby);
  await expect(nearby).toHaveAttribute('data-active', 'true');
  await expect(nearby).toHaveAttribute('aria-label', 'Leave nearby');
  await expect(nearby).toHaveAttribute('aria-pressed', 'true');
  await expect(nearby).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#voiceStatusBtn')).toBeVisible();
  await expect(page.locator('#voiceStatusBtn')).toHaveAttribute('aria-label', 'Nearby Voice · waiting for riders');

  await nearby.click();
  await expect.poll(() => presenceDeletes).toBeGreaterThan(0);
  await expect.poll(() => profileSharingUpdates.at(-1)).toBe(false);
  await expect(nearby).toHaveAttribute('data-active', 'false');
  await expect(nearby).toHaveAttribute('aria-label', 'Go live nearby');
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');
  await expect(nearby).toHaveAttribute('aria-busy', 'false');

  const cached = await page.evaluate((riderId) =>
    JSON.parse(localStorage.getItem(`rider-comms-pwa-v4:${riderId}`) || '{}'), RIDER_ID);
  expect(cached.publicLive).toBe(false);
  expect(cached.profile.shareLocation).toBe(false);
});

test('PWA Nearby handles server rejections during background refresh like the native app', async ({ page }) => {
  let shareLocation = false;
  let presenceUpdates = 0;
  let presenceDeletes = 0;
  // Switched by the test, not by a request count, so the "still live after
  // rejected jumps" assertion cannot race the next 400 ms refresh.
  let sharingDisabledElsewhere = false;

  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') shareLocation = update.shareLocation;
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      presenceUpdates += 1;
      // 1: go live. Then rejected jumps (recoverable, one toast only) until
      // the test switches sharing off elsewhere, which must end Nearby.
      if (sharingDisabledElsewhere) return { status: 403, body: { error: 'location_sharing_disabled' } };
      if (presenceUpdates >= 2) return { status: 422, body: { error: 'implausible_location_jump' } };
      return { body: { inZoneWith: [], transitions: [], radiusMiles: 1 } };
    }
    if (url.pathname === '/presence' && request.method() === 'DELETE') {
      presenceDeletes += 1;
      return { body: {} };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      return { body: { connections: [], refreshAfterMs: 20_000 } };
    }
    return null;
  });

  await page.addInitScript(() => {
    const realSetInterval = window.setInterval.bind(window);
    window.setInterval = (handler, timeout = 0, ...args) =>
      realSetInterval(handler, timeout === 8_000 ? 400 : timeout, ...args);
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    window.LivekitClient = {};
  });

  await page.goto('/');
  const nearby = page.locator('#joinNearbyBtn');
  await nearby.click();
  await expect(nearby).toHaveAttribute('data-active', 'true');

  await expect.poll(() => presenceUpdates).toBeGreaterThanOrEqual(3);
  await expect(nearby).toHaveAttribute('data-active', 'true');

  sharingDisabledElsewhere = true;
  await expect(nearby).toHaveAttribute('data-active', 'false');
  await expect.poll(() => presenceDeletes).toBeGreaterThan(0);
  const cached = await page.evaluate((riderId) =>
    JSON.parse(localStorage.getItem(`rider-comms-pwa-v4:${riderId}`) || '{}'), RIDER_ID);
  expect(cached.publicLive).toBe(false);
  expect(cached.profile.shareLocation).toBe(false);
});

test('PWA Nearby Voice waits without holding the mic, then connects when a rider enters range', async ({ page }) => {
  let shareLocation = false;
  let presenceUpdates = 0;
  // The test decides when the other rider enters range. Tying it to a count
  // of presence refreshes left the waiting state on screen for only one
  // 300 ms refresh, which a slow CI runner could miss.
  let peerInRange = false;

  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') shareLocation = update.shareLocation;
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      presenceUpdates += 1;
      const peerVisible = peerInRange;
      return {
        body: {
          inZoneWith: peerVisible ? ['rider_peer01'] : [],
          transitions: peerVisible ? [{ a: RIDER_ID, b: 'rider_peer01', type: 'entered' }] : [],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      return {
        body: {
          connections: peerInRange
            ? [{ peerId: 'rider_peer01', token: 'peer-token', url: 'wss://voice.example.test' }]
            : [],
          refreshAfterMs: 20_000,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    // Keep the production cadence unchanged while making the second public
    // presence refresh deterministic and fast enough for this browser test.
    const realSetInterval = window.setInterval.bind(window);
    window.setInterval = (handler, timeout = 0, ...args) =>
      realSetInterval(handler, timeout === 8_000 ? 300 : timeout, ...args);

    window.__nearbyVoiceRoomsCreated = 0;
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
    window.LivekitClient = {
      Room: class {
        constructor() {
          window.__nearbyVoiceRoomsCreated += 1;
          this.localParticipant = { setMicrophoneEnabled: async () => {} };
        }
        on() { return this; }
        async connect() {}
        async startAudio() {}
        async disconnect() {}
      },
      RoomEvent: {
        TrackSubscribed: 'trackSubscribed',
        TrackUnsubscribed: 'trackUnsubscribed',
        ActiveSpeakersChanged: 'activeSpeakersChanged',
        Reconnected: 'reconnected',
        Disconnected: 'disconnected',
      },
      Track: { Kind: { Audio: 'audio' } },
    };
  });

  await page.goto('/');
  const nearby = page.locator('#joinNearbyBtn');
  const voice = page.locator('#voiceStatusBtn');

  await nearby.click();
  await expect(nearby).toHaveAttribute('data-active', 'true');
  await expect(voice).toBeVisible();
  await expect(voice).toHaveAttribute('aria-label', 'Nearby Voice · waiting for riders');
  // Still waiting after further presence refreshes, with no room opened.
  const refreshesBeforePeer = presenceUpdates;
  await expect.poll(() => presenceUpdates).toBeGreaterThan(refreshesBeforePeer + 1);
  await expect(voice).toHaveAttribute('aria-label', 'Nearby Voice · waiting for riders');
  expect(await page.evaluate(() => window.__nearbyVoiceRoomsCreated)).toBe(0);

  peerInRange = true;
  await expect.poll(() => page.evaluate(() => window.__nearbyVoiceRoomsCreated)).toBe(1);
  await expect(voice).toHaveAttribute('aria-label', 'Listening hands-free');
});

test('PWA public voice fails closed when proximity authorization can’t be renewed', async ({ page }) => {
  let shareLocation = false;
  let voiceTokenRequests = 0;

  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') shareLocation = update.shareLocation;
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      return {
        body: {
          inZoneWith: ['rider_peer01'],
          transitions: [{ a: RIDER_ID, b: 'rider_peer01', type: 'entered' }],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      voiceTokenRequests += 1;
      if (voiceTokenRequests > 1) {
        return { status: 503, body: { error: 'voice_temporarily_unavailable' } };
      }
      return {
        body: {
          connections: [{ peerId: 'rider_peer01', token: 'leased-peer-token', url: 'wss://voice.example.test' }],
          refreshAfterMs: 20_000,
          authorizationLeaseMs: 600,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (handler, timeout = 0, ...args) =>
      realSetTimeout(handler, timeout === 20_000 ? 150 : timeout, ...args);

    window.__publicVoiceDisconnects = 0;
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
    window.LivekitClient = {
      Room: class {
        constructor() {
          this.localParticipant = { setMicrophoneEnabled: async () => {} };
        }
        on() { return this; }
        async connect() {}
        async startAudio() {}
        async disconnect() { window.__publicVoiceDisconnects += 1; }
      },
      RoomEvent: {
        TrackSubscribed: 'trackSubscribed',
        TrackUnsubscribed: 'trackUnsubscribed',
        ActiveSpeakersChanged: 'activeSpeakersChanged',
        Reconnected: 'reconnected',
        Disconnected: 'disconnected',
      },
      Track: { Kind: { Audio: 'audio' } },
    };
  });

  await page.goto('/');
  const nearby = page.locator('#joinNearbyBtn');
  const voice = page.locator('#voiceStatusBtn');

  await nearby.click();
  await expect(nearby).toHaveAttribute('data-active', 'true');
  await expect(voice).toHaveAttribute('aria-label', 'Listening hands-free');
  await expect.poll(() => voiceTokenRequests).toBeGreaterThanOrEqual(2);

  // A transient refresh miss keeps the still-valid pair alive until the
  // server-provided authorization lease expires.
  await expect.poll(() => page.evaluate(() => window.__publicVoiceDisconnects), { timeout: 400 }).toBe(0);

  // Token expiry alone does not eject a connected LiveKit participant.
  // Rider Comms must therefore mute/disconnect the pair itself once it can no
  // longer re-confirm current proximity/block authorization.
  await expect.poll(() => page.evaluate(() => window.__publicVoiceDisconnects), { timeout: 1_500 }).toBeGreaterThanOrEqual(1);
  await expect(voice).toHaveAttribute('aria-label', 'Nearby Voice · reconnecting');
  await expect(nearby).toHaveAttribute('data-active', 'true');
});

test('PWA cancels a delayed Nearby Voice connect after the rider turns Nearby off', async ({ page }) => {
  let shareLocation = false;
  let voiceTokenRequested = false;
  let releaseVoiceToken;
  const voiceTokenGate = new Promise((resolve) => { releaseVoiceToken = resolve; });

  await mockAuthenticatedApi(page, 'stationary', async ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') shareLocation = update.shareLocation;
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      return {
        body: {
          inZoneWith: ['rider_peer01'],
          transitions: [{ a: RIDER_ID, b: 'rider_peer01', type: 'entered' }],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/presence' && request.method() === 'DELETE') return { body: {} };
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      voiceTokenRequested = true;
      await voiceTokenGate;
      return {
        body: {
          connections: [{ peerId: 'rider_peer01', token: 'delayed-token', url: 'wss://voice.example.test' }],
          refreshAfterMs: 20_000,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    window.__nearbyVoiceRoomsCreated = 0;
    window.LivekitClient = {
      Room: class {
        constructor() {
          window.__nearbyVoiceRoomsCreated += 1;
          this.localParticipant = { setMicrophoneEnabled: async () => {} };
        }
        on() { return this; }
        async connect() {}
        async startAudio() {}
        async disconnect() {}
      },
      RoomEvent: { Disconnected: 'disconnected' },
      Track: { Kind: { Audio: 'audio' } },
    };
  });

  await page.goto('/');
  const nearby = page.locator('#joinNearbyBtn');

  await nearby.click();
  await expect(nearby).toHaveAttribute('data-active', 'true');
  await expect.poll(() => voiceTokenRequested).toBe(true);

  // The token request is deliberately still in flight. Turning Nearby off
  // invalidates it before it can construct/publish a proximity room.
  await nearby.click();
  await expect(nearby).toHaveAttribute('data-active', 'false');
  await expect(nearby).toHaveAttribute('aria-pressed', 'false');

  releaseVoiceToken();
  await expect.poll(() => page.evaluate(() => window.__nearbyVoiceRoomsCreated)).toBe(0);
  await expect(page.locator('#voiceStatusBtn')).toBeHidden();
});

test('PWA coalesces overlapping Nearby Voice authorization refreshes', async ({ page }) => {
  let shareLocation = false;
  let voiceTokenRequests = 0;
  let presenceUpdates = 0;
  let releaseFirstToken;
  const firstTokenGate = new Promise((resolve) => { releaseFirstToken = resolve; });

  await mockAuthenticatedApi(page, 'stationary', async ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') shareLocation = update.shareLocation;
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      presenceUpdates += 1;
      const peerVisible = presenceUpdates % 2 === 1;
      return {
        body: {
          inZoneWith: peerVisible ? ['rider_peer01'] : [],
          transitions: [{ a: RIDER_ID, b: 'rider_peer01', type: peerVisible ? 'entered' : 'left' }],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      voiceTokenRequests += 1;
      if (voiceTokenRequests === 1) await firstTokenGate;
      return {
        body: {
          connections: [{ peerId: 'rider_peer01', token: `peer-token-${voiceTokenRequests}`, url: 'wss://voice.example.test' }],
          refreshAfterMs: 20_000,
          authorizationLeaseMs: 60_000,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    const realSetInterval = window.setInterval.bind(window);
    window.setInterval = (handler, timeout = 0, ...args) =>
      realSetInterval(handler, timeout === 8_000 ? 75 : timeout, ...args);

    window.__nearbyVoiceRoomsCreated = 0;
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
    window.LivekitClient = {
      Room: class {
        constructor() {
          window.__nearbyVoiceRoomsCreated += 1;
          this.localParticipant = { setMicrophoneEnabled: async () => {} };
        }
        on() { return this; }
        async connect() {}
        async startAudio() {}
        async disconnect() {}
      },
      RoomEvent: {
        TrackSubscribed: 'trackSubscribed',
        TrackUnsubscribed: 'trackUnsubscribed',
        ActiveSpeakersChanged: 'activeSpeakersChanged',
        Reconnected: 'reconnected',
        Disconnected: 'disconnected',
      },
      Track: { Kind: { Audio: 'audio' } },
    };
  });

  await page.goto('/');
  await page.locator('#joinNearbyBtn').click();
  await expect.poll(() => voiceTokenRequests).toBe(1);

  // Presence keeps refreshing while the first token request is deliberately
  // blocked. Those refreshes must collapse into one pending replay instead of
  // constructing multiple LiveKit pair rooms for the same peer.
  await page.waitForTimeout(250);
  expect(voiceTokenRequests).toBe(1);

  releaseFirstToken();
  await expect.poll(() => voiceTokenRequests).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.evaluate(() => window.__nearbyVoiceRoomsCreated)).toBe(1);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__nearbyVoiceRoomsCreated)).toBe(1);
});

test('PWA attaches subscribed Nearby Voice audio after Go Live', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile` && request.method() === 'PUT') {
      return { body: { ...PROFILE, shareLocation: true } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      return {
        body: {
          inZoneWith: ['rider_peer01'],
          transitions: [{ a: RIDER_ID, b: 'rider_peer01', type: 'entered' }],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      return {
        body: {
          connections: [{
            peerId: 'rider_peer01',
            token: 'visual-livekit-token',
            url: 'wss://voice.example.test',
          }],
          refreshAfterMs: 20_000,
        },
      };
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
            const attached = [];
            const track = {
              kind: 'audio',
              attach() {
                const element = document.createElement('audio');
                attached.push(element);
                return element;
              },
              detach() { return attached.splice(0); },
            };
            this.emit(RoomEvent.TrackSubscribed, track, {}, { identity: 'rider_peer01' });
          }
          async startAudio() { this.canPlaybackAudio = true; }
          async disconnect() { this.emit(RoomEvent.Disconnected); }
        }
        window.LivekitClient = { Room, RoomEvent, Track };
      })();
    `,
  }));

  await page.goto('/');
  await page.locator('#joinNearbyBtn').click();

  await expect.poll(() => page.locator('audio[data-rider-comms-voice="true"]').count()).toBe(1);
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'true');
});

test('PWA boosts Nearby Voice on iPhone without playing each voice twice', async ({ page }) => {
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile` && request.method() === 'PUT') {
      return { body: { ...PROFILE, shareLocation: true } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      return {
        body: {
          inZoneWith: ['rider_peer01'],
          transitions: [{ a: RIDER_ID, b: 'rider_peer01', type: 'entered' }],
          radiusMiles: 1,
        },
      };
    }
    if (url.pathname === '/profiles/rider_peer01') {
      return { body: { riderId: 'rider_peer01', displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' } };
    }
    if (url.pathname === '/voice/token' && request.method() === 'POST') {
      return {
        body: {
          connections: [{
            peerId: 'rider_peer01',
            token: 'visual-livekit-token',
            url: 'wss://voice.example.test',
          }],
          refreshAfterMs: 20_000,
        },
      };
    }
    return null;
  });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    window.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
    window.__voiceGain = null;
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => fakeStream },
    });
    class FakeAudioContext {
      constructor() { this.state = 'running'; this.destination = {}; }
      addEventListener() {}
      removeEventListener() {}
      resume() { return Promise.resolve(); }
      createGain() { const node = { gain: { value: 1 }, connect() {}, disconnect() {} }; window.__voiceGain = node; return node; }
      createDynamicsCompressor() {
        const param = () => ({ value: 0 });
        return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {}, disconnect() {} };
      }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
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
            const attached = [];
            window.__attachedVoiceElements = attached;
            const track = {
              kind: 'audio',
              mediaStreamTrack: { kind: 'audio' },
              attach() {
                const element = document.createElement('audio');
                attached.push(element);
                return element;
              },
              detach() { return attached.splice(0); },
            };
            this.emit(RoomEvent.TrackSubscribed, track, {}, { identity: 'rider_peer01' });
          }
          async startAudio() {
            // Real LiveKit unmutes every attached element here.
            for (const element of window.__attachedVoiceElements || []) element.muted = false;
            this.canPlaybackAudio = true;
          }
          async disconnect() { this.emit(RoomEvent.Disconnected); }
        }
        window.LivekitClient = { Room, RoomEvent, Track };
      })();
    `,
  }));

  await page.goto('/');
  await page.locator('#joinNearbyBtn').click();

  await expect.poll(() => page.locator('audio[data-rider-comms-voice="true"]').count()).toBe(1);
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'true');
  // The boosted Web Audio copy plays at twice the gain...
  await expect.poll(() => page.evaluate(() => window.__voiceGain?.gain.value)).toBe(2);
  // ...and the plain element stays muted even after startAudio() unmuted it,
  // so each voice plays exactly once.
  await page.waitForTimeout(200);
  expect(await page.locator('audio[data-rider-comms-voice="true"]').evaluate((element) => element.muted)).toBe(true);
});

test('PWA pauses saved public presence when current server consent is off', async ({ page }) => {
  let presenceUpdates = 0;
  await mockAuthenticatedApi(page, 'stationary', ({ url, request }) => {
    if (url.pathname === '/presence' && request.method() === 'POST') presenceUpdates += 1;
    return null;
  });
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ screen: 'map', profile, publicLive: true }));
  }, { riderId: RIDER_ID, profile: { ...PROFILE, shareLocation: true } });
  await page.goto('/');
  await expect.poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem(`rider-comms-pwa-v4:${id}`)).profile.shareLocation, RIDER_ID)).toBe(false);
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'false');
  expect(presenceUpdates).toBe(0);
});

test('PWA clears stale Nearby state without restoring public presence on reload', async ({ page }) => {
  let presenceUpdates = 0;
  await mockAuthenticatedApi(page, 'denied', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) return { body: { ...PROFILE, shareLocation: true } };
    if (url.pathname === '/presence' && request.method() === 'POST') presenceUpdates += 1;
    return null;
  });
  await page.addInitScript(({ riderId, profile }) => {
    localStorage.setItem(`rider-comms-pwa-v4:${riderId}`, JSON.stringify({ screen: 'map', profile, publicLive: true }));
  }, { riderId: RIDER_ID, profile: { ...PROFILE, shareLocation: true } });
  await page.goto('/');
  await expect(page.locator('#joinNearbyBtn')).toHaveAttribute('data-active', 'false');
  expect(presenceUpdates).toBe(0);
});

test('goes live when iOS hands back fixes with an old timestamp', async ({ page }) => {
  let shareLocation = false;
  const presenceBodies = [];
  await mockAuthenticatedApi(page, 'stale-timestamp', ({ url, request }) => {
    if (url.pathname === `/riders/${RIDER_ID}/profile`) {
      if (request.method() === 'PUT') {
        const update = request.postDataJSON();
        if (typeof update.shareLocation === 'boolean') shareLocation = update.shareLocation;
      }
      return { body: { ...PROFILE, shareLocation } };
    }
    if (url.pathname === '/presence' && request.method() === 'POST') {
      const body = request.postDataJSON();
      presenceBodies.push(body);
      // Same rule as the server: a fix more than 30 s old is refused.
      if (body.fixAgeMs > 30_000) return { status: 400, body: { error: 'location fix timestamp is stale or invalid' } };
      return { body: { inZoneWith: [], transitions: [], radiusMiles: 1 } };
    }
    if (url.pathname === '/presence' && request.method() === 'DELETE') return { body: {} };
    if (url.pathname === '/voice/token' && request.method() === 'POST') return { body: { connections: [], refreshAfterMs: 20_000 } };
    return null;
  });
  await page.addInitScript(() => {
    const fakeStream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => fakeStream } });
    window.LivekitClient = {};
  });

  await page.goto('/');
  const nearby = page.locator('#joinNearbyBtn');
  await expect(nearby).toHaveAttribute('data-active', 'false');
  await nearby.click();
  await expect(nearby).toHaveAttribute('data-active', 'true');
  expect(presenceBodies.length).toBeGreaterThan(0);
  expect(presenceBodies[0].fixAgeMs).toBeLessThan(30_000);
  expect(Date.now() - presenceBodies[0].recordedAt).toBeGreaterThan(100_000);
});
