import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLiveKitCredentialsFromEnv, mintVoiceToken, rideRoomName, channelRoomName } from '../src/liveKitToken.ts';

const FAKE_CREDS = { apiKey: 'fake-key', apiSecret: 'fake-secret-at-least-32-bytes-long!!', url: 'wss://example.livekit.cloud' };

describe('liveKitToken', () => {
  it('reads credentials from env only when all three vars are present', () => {
    assert.equal(getLiveKitCredentialsFromEnv({}), null);
    assert.equal(getLiveKitCredentialsFromEnv({ LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }), null);
    assert.deepEqual(
      getLiveKitCredentialsFromEnv({ LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', LIVEKIT_URL: 'wss://x' }),
      { apiKey: 'k', apiSecret: 's', url: 'wss://x' }
    );
  });

  it('room naming keeps rides and channels in clearly separate namespaces', () => {
    assert.equal(rideRoomName('abc123'), 'ride:abc123');
    assert.equal(channelRoomName('4:7'), 'channel:4:7');
  });

  it('mints a real, well-formed JWT carrying the requested room and identity', async () => {
    const { token, url } = await mintVoiceToken(FAKE_CREDS, 'rider_alice', 'ride:abc123');
    assert.equal(url, FAKE_CREDS.url);
    const parts = token.split('.');
    assert.equal(parts.length, 3); // header.payload.signature

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    assert.equal(payload.sub, 'rider_alice');
    assert.equal(payload.video.room, 'ride:abc123');
    assert.equal(payload.video.roomJoin, true);
  });
});
