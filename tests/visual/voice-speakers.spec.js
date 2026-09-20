import { expect, test } from '@playwright/test';

const RIDER_ID = 'rider_voice_self';
const PEER_ID = 'rider_voice_peer';
const PROFILE = {
  riderId: RIDER_ID,
  displayName: 'Alex Rider',
  handle: '@alex_rides',
  avatarId: 'ember',
  zoneTier: 'free',
  unitSystem: 'miles',
  shareLocation: false,
  instagramUsername: '',
  tiktokUsername: '',
  instagramVisibility: 'friends',
  tiktokVisibility: 'friends',
};

test('PWA retries a transient pre-connect voice failure and preserves VOX/speaker state', async ({ page }) => {
  await page.addInitScript(({ riderId }) => {
    localStorage.setItem('rider-comms-session-v1', JSON.stringify({ riderId, token: 'voice-speaker-test-token' }));
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: async () => ({ state: 'granted', addEventListener() {} }) },
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition(success) {
          const base = Date.now() - 7000;
          for (let index = 0; index <= 7; index += 1) {
            success({
              timestamp: base + index * 1000,
              coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 5, speed: 0 },
            });
          }
          return 1;
        },
        clearWatch() {},
        getCurrentPosition(success) {
          success({
            timestamp: Date.now(),
            coords: { latitude: 51.5074, longitude: -0.1278, accuracy: 5, speed: 0 },
          });
        },
      },
    });
    window.__voiceGetUserMediaCount = 0;
    window.__voiceTrackStopCount = 0;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          window.__voiceGetUserMediaCount += 1;
          const track = {
            stop() { window.__voiceTrackStopCount += 1; },
          };
          return { getTracks: () => [track] };
        },
      },
    });
    window.__voiceTestAmplitude = 0;
    window.__voiceAudioResumeCount = 0;
    window.__voiceMicrophoneStates = [];
    class FakeAudioContext {
      constructor() {
        this.state = 'running';
        this.onstatechange = null;
        window.__voiceTestAudioContext = this;
      }
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() {
        return {
          fftSize: 512,
          frequencyBinCount: 32,
          getByteTimeDomainData(data) {
            const amplitude = window.__voiceTestAmplitude || 0;
            for (let index = 0; index < data.length; index += 1) {
              data[index] = 128 + (index % 2 ? -amplitude : amplitude);
            }
          },
        };
      }
      async resume() {
        window.__voiceAudioResumeCount += 1;
        this.state = 'running';
        this.onstatechange?.();
      }
      close() {
        this.state = 'closed';
        return Promise.resolve();
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  }, { riderId: RIDER_ID });

  let voiceTokenRequests = 0;
  await page.route('https://backend-production-7fa0.up.railway.app/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
      return;
    }

    let body = {};
    if (url.pathname === '/auth/me') body = { riderId: RIDER_ID };
    else if (url.pathname === `/riders/${RIDER_ID}/profile` && request.method() === 'PUT') body = { ...PROFILE, shareLocation: true };
    else if (url.pathname === `/riders/${RIDER_ID}/profile`) body = PROFILE;
    else if (url.pathname === `/riders/${RIDER_ID}/friends`) body = { friends: [] };
    else if (url.pathname === `/riders/${RIDER_ID}/friend-requests`) body = { incoming: [], outgoing: [] };
    else if (url.pathname === `/profiles/${PEER_ID}`) body = { riderId: PEER_ID, displayName: 'Peer Rider', handle: '@peer', avatarId: 'ridge' };
    else if (url.pathname === '/presence' && request.method() === 'POST') {
      body = {
        inZoneWith: [PEER_ID],
        transitions: [{ a: RIDER_ID, b: PEER_ID, type: 'entered' }],
        radiusMiles: 1,
      };
    } else if (url.pathname === '/voice/token' && request.method() === 'POST') {
      voiceTokenRequests += 1;
      if (voiceTokenRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers,
          body: JSON.stringify({ error: 'voice_temporarily_unavailable' }),
        });
        return;
      }
      body = {
        connections: [{ peerId: PEER_ID, token: 'speaker-livekit-token', url: 'wss://voice.example.test' }],
        refreshAfterMs: 20_000,
      };
    } else if (url.pathname === '/hazards/nearby') body = { hazards: [] };
    else if (url.pathname === '/rides/current') body = { ride: null };
    else if (url.pathname === '/config') body = { googleMapsApiKey: '' };

    await route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
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
            this.localParticipant = {
              setMicrophoneEnabled: async (enabled) => {
                window.__voiceMicrophoneStates.push(Boolean(enabled));
              },
            };
            window.__voiceSpeakerTestRoom = this;
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
            queueMicrotask(() => this.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'rider_voice_peer' }]));
          }
          async startAudio() { this.canPlaybackAudio = true; }
          async disconnect() {
            window.__voiceRoomDisconnectCount = (window.__voiceRoomDisconnectCount || 0) + 1;
            this.emit(RoomEvent.Disconnected);
          }
        }
        window.LivekitClient = { Room, RoomEvent, Track };
      })();
    `,
  }));

  await page.goto('/');
  await page.locator('#joinNearbyBtn').click();

  // The first token mint is deliberately failed above before any LiveKit
  // Room exists. Rider Comms must self-recover through the reconnect scheduler
  // rather than requiring the rider to toggle Nearby off/on again.
  await expect.poll(() => voiceTokenRequests, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);

  const localVoiceButton = page.locator('#voiceStatusBtn');
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Listening — hands-free');

  // Physical iOS PWA testing previously reported the system microphone
  // indicator disappearing roughly 4–5 seconds after enabling public Nearby.
  // With an authorised peer actually connected, that must not be Rider Comms
  // tearing down the pair room or the independent VOX meter stream. Hold this
  // simulated public connection beyond that window and verify both remain live.
  const persistenceBefore = await page.evaluate(() => ({
    getUserMediaCount: window.__voiceGetUserMediaCount || 0,
    trackStopCount: window.__voiceTrackStopCount || 0,
    disconnectCount: window.__voiceRoomDisconnectCount || 0,
  }));
  expect(persistenceBefore.getUserMediaCount).toBeGreaterThanOrEqual(2);
  expect(persistenceBefore.trackStopCount).toBe(1);
  expect(persistenceBefore.disconnectCount).toBe(0);

  await page.waitForTimeout(5_500);
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Listening — hands-free');

  const persistenceAfter = await page.evaluate(() => ({
    trackStopCount: window.__voiceTrackStopCount || 0,
    disconnectCount: window.__voiceRoomDisconnectCount || 0,
  }));
  expect(persistenceAfter.trackStopCount).toBe(1);
  expect(persistenceAfter.disconnectCount).toBe(0);

  // A brief ~0.039 RMS burst is above the tuned 0.035 attack threshold but
  // shorter than the 70 ms attack hold. This models a helmet/wind bump and
  // must not open the transmitter.
  await page.evaluate(() => { window.__voiceTestAmplitude = 5; });
  await page.waitForTimeout(30);
  await page.evaluate(() => { window.__voiceTestAmplitude = 0; });
  await page.waitForTimeout(120);
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Listening — hands-free');

  // The same level held as real speech should open the mic even though it is
  // still below the old 0.06 gate.
  await page.evaluate(() => { window.__voiceTestAmplitude = 5; });
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Talking');

  // Installed WebKit can suspend Web Audio independently of the LiveKit room
  // after an app switch, lock-screen/media interruption, or similar lifecycle
  // event. Rider Comms must fail closed immediately instead of leaving the
  // last VOX transmit state latched on, then resume the analyser on foreground.
  await page.evaluate(() => {
    window.__voiceTestAmplitude = 0;
    window.__voiceTestAudioContext.state = 'suspended';
    window.__voiceTestAudioContext.onstatechange?.();
  });
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Resume voice');
  await expect.poll(() => page.evaluate(() => window.__voiceMicrophoneStates.at(-1))).toBe(false);

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => page.evaluate(() => window.__voiceAudioResumeCount)).toBeGreaterThanOrEqual(1);
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Listening — hands-free');

  // After the context has resumed, VOX must still be able to open again.
  await page.evaluate(() => { window.__voiceTestAmplitude = 5; });
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Talking');

  // A short natural pause must stay open through the 650 ms release hangtime,
  // then close again once the pause genuinely persists.
  await page.evaluate(() => { window.__voiceTestAmplitude = 0; });
  await page.waitForTimeout(250);
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Talking');
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Listening — hands-free', { timeout: 1_200 });

  const speakerChip = page.locator('#voiceSpeakerChip');
  await expect(speakerChip).toBeVisible();
  await expect(speakerChip).toHaveText('Peer Rider speaking');

  await page.evaluate(() => {
    window.__voiceSpeakerTestRoom.emit('activeSpeakersChanged', []);
  });
  await expect(speakerChip).toBeHidden();
});
