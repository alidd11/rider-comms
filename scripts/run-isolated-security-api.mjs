// Disposable, strictly loopback-only API for public GitHub Actions security scans.
import { createApp } from '../backend/src/server.ts';
import { ensureMigrated, closeDatabase } from '../backend/src/db.ts';

const PORT = 4186;
if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.SECURITY_ISOLATED_RUN !== '1' || !process.env.DATABASE_URL) {
  throw new Error('not_an_isolated_github_actions_runner');
}
const db = new URL(process.env.DATABASE_URL);
if (db.protocol !== 'postgres:' || db.hostname !== '127.0.0.1' || db.port !== '5432' ||
    db.pathname !== '/rider_comms_security_ci' || db.search || db.hash) {
  throw new Error('security_scan_database_must_be_local_and_disposable');
}
for (const name of ['RAILWAY_ENVIRONMENT_ID', 'RAILWAY_SERVICE_ID', 'ADMIN_RIDER_IDS',
  'GOOGLE_MAPS_API_KEY', 'LIVEKIT_API_SECRET', 'EXPO_ACCESS_TOKEN',
  'SOCIAL_MEDIA_S3_ACCESS_KEY_ID', 'SOCIAL_MEDIA_S3_SECRET_ACCESS_KEY']) {
  if (process.env[name]) throw new Error('forbidden_production_setting_' + name);
}
await ensureMigrated();
const disabledExternal = async () => { throw new Error('external_provider_disabled'); };
const server = createApp({
  publicApiUrl: 'http://127.0.0.1:' + PORT,
  allowedOrigins: ['http://localhost:' + PORT],
  trustProxy: false,
  liveKitCredentials: null,
  socialMedia: null,
  socialPostingEnabled: false,
  socialOpenBetaEnabled: false,
  socialPilotRiderIds: [],
  pushNotifier: { notify: async () => undefined },
  directionsProvider: disabledExternal,
  placesProvider: disabledExternal,
  placesAlongRouteProvider: disabledExternal,
  placeSuggestionsProvider: disabledExternal,
  placeDetailsProvider: disabledExternal,
});
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
}
process.once('SIGTERM', () => void stop().catch((e) => { console.error(e); process.exitCode = 1; }));
process.once('SIGINT', () => void stop().catch((e) => { console.error(e); process.exitCode = 1; }));
server.listen(PORT, '127.0.0.1', () => console.log('isolated_security_api_ready'));
