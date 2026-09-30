// Checks a LiveKit server before pointing the backend at it:
//   LIVEKIT_URL=wss://voice.example.com LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
//     node scripts/livekit-smoke-test.mjs
// It verifies the credentials against the room API (the same API the
// backend uses to revoke participants) and that a Rider Comms-style token
// can be minted. It does not join a room or send media: test voice with two
// devices after switching. Pass --allow-insecure to test a local ws:// server.
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';

const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = process.env;
if (!url || !apiKey || !apiSecret) {
  console.error('Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.');
  process.exit(2);
}

const parsed = new URL(url);
const allowInsecure = process.argv.includes('--allow-insecure');
if (parsed.protocol !== 'wss:' && !(allowInsecure && parsed.protocol === 'ws:')) {
  console.error(`LIVEKIT_URL should use wss:// in production (got ${parsed.protocol}).`);
  process.exit(2);
}
const apiUrl = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');

try {
  const rooms = await new RoomServiceClient(apiUrl, apiKey, apiSecret).listRooms();
  console.log(`OK  room API reachable with these credentials (${rooms.length} active rooms).`);
} catch (error) {
  console.error(`FAIL room API: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Check the domain/DNS, that Caddy has a certificate, and that LIVEKIT_KEYS on the server matches.');
  process.exit(1);
}

const token = new AccessToken(apiKey, apiSecret, { identity: 'smoke-test', ttl: 60 });
token.addGrant({ room: 'smoke-test', roomJoin: true, canPublish: true, canPublishSources: [TrackSource.MICROPHONE], canSubscribe: true });
// toJwt() converts the grant in place, so mint exactly once.
const jwt = await token.toJwt();
console.log('OK  voice token minted.');

const validate = await fetch(`${apiUrl}/rtc/validate?access_token=${encodeURIComponent(jwt)}`).catch((error) => error);
if (validate instanceof Error || !validate.ok) {
  console.error(`FAIL signalling endpoint: ${validate instanceof Error ? validate.message : `HTTP ${validate.status}`}`);
  process.exit(1);
}
console.log('OK  signalling endpoint accepts the token.');
console.log('Next: set LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET on the Railway backend, then test voice on two devices.');
