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

test('PWA shows and clears the remote Nearby Voice active speaker', async ({ page }) => {
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
          // +/-5 around the midpoint is ~0.039 RMS: below the old 0.06
          // threshold, but above the tuned 0.035 speech attack threshold.
          getByteTimeDomainData(data) {
            for (let index = 0; index < data.length; index += 1) data[index] = index % 2 ? 123 : 133;
          },
        };
      }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
  }, { riderId: RIDER_ID });

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
            this.localParticipant = { setMicrophoneEnabled: async () => {} };
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
          async disconnect() { this.emit(RoomEvent.Disconnected); }
        }
        window.LivekitClient = { Room, RoomEvent, Track };
      })();
    `,
  }));

  await page.goto('/');
  await page.locator('#joinNearbyBtn').click();

  const localVoiceButton = page.locator('#voiceStatusBtn');
  await expect(localVoiceButton).toHaveAttribute('aria-label', 'Talking');

  const speakerChip = page.locator('#voiceSpeakerChip');
  await expect(speakerChip).toBeVisible();
  await expect(speakerChip).toHaveText('Peer Rider speaking');

  await page.evaluate(() => {
    window.__voiceSpeakerTestRoom.emit('activeSpeakersChanged', []);
  });
  await expect(speakerChip).toBeHidden();
});
