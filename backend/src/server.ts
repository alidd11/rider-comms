import http from 'node:http';
import { createLiveKitRoomAdmin, getLiveKitCredentialsFromEnv } from './liveKitToken.ts';
import type { LiveKitCredentials, LiveKitRoomAdmin } from './liveKitToken.ts';
import { fetchGoogleDrivingRoute } from './directionsProvider.ts';
import type { DrivingRoute, RouteCoordinate } from './directionsProvider.ts';
import { DirectionsCache, wrapDirectionsProviderWithCache } from './directionsCache.ts';
import { RetentionStore } from './retentionStore.ts';
import { configureErrorAlerts, ErrorAlerter, flushErrorAlerts, reportOperationalError } from './errorAlerts.ts';
import { sendOperationalEmail } from './email.ts';
import { fetchGooglePlaces } from './placesProvider.ts';
import type { PlaceSearchRequest, PlaceSummary } from './placesProvider.ts';
import { AuthStore } from './authStore.ts';
import { RideStore } from './rideStore.ts';
import type { RideMemberLocation } from './rideStore.ts';
import { PresenceStore } from './presenceStore.ts';
import { ProfileStore } from './profileStore.ts';
import { FriendStore } from './friendStore.ts';
import { MessageStore } from './messageStore.ts';
import { HideoutStore } from './hideoutStore.ts';
import { ModerationStore } from './moderationStore.ts';
import { HazardStore } from './hazardStore.ts';
import { ScenicRouteStore } from './scenicRouteStore.ts';
import { AccountDeletionStore } from './accountDeletionStore.ts';
import { SocialRateLimitStore } from './socialRateLimitStore.ts';
import { RateLimitStore } from './rateLimitStore.ts';
import { SocialActivityStore } from './socialActivityStore.ts';
import { SocialEventStore } from './socialEventStore.ts';
import { checkDatabaseReady, closeDatabase, ensureMigrated } from './db.ts';
import { NOT_HANDLED } from './routes/context.ts';
import type { RouteContext, RouteDeps } from './routes/context.ts';
import { handlePublicRoutes } from './routes/public.ts';
import { handleAccountRoutes } from './routes/account.ts';
import { handleLiveRoutes } from './routes/live.ts';
import { handleSafetyRoutes } from './routes/safety.ts';
import { handleProfileRoutes } from './routes/profiles.ts';
import { handleRideRoutes } from './routes/rides.ts';
import { handleRiderRoutes } from './routes/riders.ts';
import { handleSocialRoutes } from './routes/social.ts';
import { handleNavigationRoutes } from './routes/navigation.ts';
import { handleHazardRoutes } from './routes/hazards.ts';
import { handleModerationRoutes } from './routes/moderation.ts';
import { handleScenicRouteRoutes } from './routes/scenicRoutes.ts';
import {
  applyCors,
  applyResponsePolicy,
  bearerToken,
  clientAddress,
  consumeRateLimit,
  parseAllowedOrigins,
  RequestError,
  rateLimitSubject,
  requestId,
  sendEmpty,
  sendJson,
} from './serverHttp.ts';

export { parseAllowedOrigins };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
const AUTH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const SOCIAL_RATE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const SOCIAL_STATE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export interface ApiServerOptions {
  allowedOrigins?: readonly string[];
  trustProxy?: boolean;
  logger?: (event: ApiRequestLog) => void;
  /** Defaults to reading LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL from
   * the environment; pass null explicitly (e.g. in tests) to force the
   * "voice not configured" path regardless of the real environment. */
  liveKitCredentials?: LiveKitCredentials | null;
  liveKitRoomAdmin?: Partial<Pick<LiveKitRoomAdmin, 'revokeRideParticipant' | 'revokeProximityParticipant'>> | null;
  accountDeletionStore?: Pick<AccountDeletionStore, 'deleteRider'>;
  rateLimitStore?: Pick<RateLimitStore, 'consume'>;
  directionsProvider?: (origin: RouteCoordinate, destination: RouteCoordinate) => Promise<DrivingRoute>;
  directionsCache?: Pick<DirectionsCache, 'get' | 'set'>;
  placesProvider?: (request: PlaceSearchRequest) => Promise<PlaceSummary[]>;
  socialRateLimitStore?: Pick<SocialRateLimitStore, 'consume'>;
  socialActivityStore?: Pick<SocialActivityStore, 'touch' | 'getFriendActivity'>;
  socialEventStore?: Pick<SocialEventStore, 'waitForEvents'> & Partial<Pick<SocialEventStore, 'close'>>;
  readinessCheck?: () => Promise<void>;
}

/** Everything createApp can be given. Stores default to their Postgres-backed
 * implementations; tests and the production entry point pass only what they
 * need to share or replace. */
export interface CreateAppOptions extends ApiServerOptions {
  rideStore?: RideStore;
  presenceStore?: PresenceStore;
  profileStore?: ProfileStore;
  friendStore?: FriendStore;
  messageStore?: MessageStore;
  hideoutStore?: HideoutStore;
  authStore?: AuthStore;
  moderationStore?: ModerationStore;
  hazardStore?: HazardStore;
  scenicRouteStore?: ScenicRouteStore;
}

export interface ApiRequestLog {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  clientAddress: string;
}

async function authRider(req: http.IncomingMessage, res: http.ServerResponse, auth: AuthStore): Promise<string | undefined> {
  const riderId = await auth.riderForToken(bearerToken(req));
  if (!riderId) sendJson(res, 401, { error: 'unauthorized' });
  return riderId;
}
function requiresVerifiedEmail(method: string | undefined, pathname: string): boolean {
  if (method !== 'POST') return false;
  if ([
    '/presence',
    '/voice/token',
    '/reports',
    '/friends/requests',
    '/messages',
    '/hideouts',
    '/hazards',
    '/scenic-routes',
  ].includes(pathname)) return true;
  return /^\/hazards\/[^/]+\/(confirm|deny)$/.test(pathname);
}

async function requireVerifiedEmail(
  res: http.ServerResponse,
  authStore: AuthStore,
  actorId: string,
): Promise<boolean> {
  const identity = await authStore.getIdentity(actorId);
  if (!identity || identity.emailVerified) return true;
  sendJson(res, 403, { error: 'email_verification_required' });
  return false;
}

export function createApp(options: CreateAppOptions = {}): http.Server {
  const rideStore = options.rideStore ?? new RideStore();
  const presenceStore = options.presenceStore ?? new PresenceStore();
  const profileStore = options.profileStore ?? new ProfileStore();
  const friendStore = options.friendStore ?? new FriendStore(profileStore);
  const messageStore = options.messageStore ?? new MessageStore();
  const hideoutStore = options.hideoutStore ?? new HideoutStore();
  const authStore = options.authStore ?? new AuthStore();
  const moderationStore = options.moderationStore ?? new ModerationStore();
  const hazardStore = options.hazardStore ?? new HazardStore();
  const scenicRouteStore = options.scenicRouteStore ?? new ScenicRouteStore();
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const liveKitCredentials = 'liveKitCredentials' in options ? options.liveKitCredentials : getLiveKitCredentialsFromEnv();
  const liveKitRoomAdmin = 'liveKitRoomAdmin' in options
    ? options.liveKitRoomAdmin
    : liveKitCredentials ? createLiveKitRoomAdmin(liveKitCredentials) : null;
  const accountDeletionStore = options.accountDeletionStore ?? new AccountDeletionStore();
  const rateLimitStore = options.rateLimitStore ?? new RateLimitStore();
  const socialRateLimitStore = options.socialRateLimitStore ?? new SocialRateLimitStore();
  const socialActivityStore = options.socialActivityStore ?? new SocialActivityStore();
  const socialEventStore = options.socialEventStore ?? new SocialEventStore();
  const readinessCheck = options.readinessCheck ?? checkDatabaseReady;
  const directionsCache = options.directionsCache ?? new DirectionsCache();
  const directionsProvider = wrapDirectionsProviderWithCache(
    options.directionsProvider ?? ((origin: RouteCoordinate, destination: RouteCoordinate) => fetchGoogleDrivingRoute(origin, destination)),
    directionsCache,
  );
  const placesProvider = options.placesProvider ?? ((request: PlaceSearchRequest) => fetchGooglePlaces(request));
  const revokeRideVoiceParticipants = async (rideId: string, riderIds: Iterable<string>): Promise<void> => {
    const revokeRideParticipant = liveKitRoomAdmin?.revokeRideParticipant;
    if (!revokeRideParticipant) return;
    const uniqueRiderIds = [...new Set(riderIds)];
    const results = await Promise.allSettled(
      uniqueRiderIds.map((riderId) => revokeRideParticipant(rideId, riderId)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(JSON.stringify({
          level: 'error',
          event: 'ride_voice_revocation_failed',
          rideId,
          riderId: uniqueRiderIds[index],
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }));
      }
    });
  };
  const revokeProximityVoiceParticipants = async (riderA: string, riderB: string): Promise<void> => {
    const revokeProximityParticipant = liveKitRoomAdmin?.revokeProximityParticipant;
    if (!revokeProximityParticipant) return;
    const riderIds = [...new Set([riderA, riderB])];
    const revokedAt = Date.now();
    const results = await Promise.allSettled(
      riderIds.map((riderId) => revokeProximityParticipant(riderA, riderB, riderId, revokedAt)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(JSON.stringify({
          level: 'error',
          event: 'proximity_voice_revocation_failed',
          riderA,
          riderB,
          riderId: riderIds[index],
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }));
      }
    });
  };

  const visibleRideLocationsFor = async (actorId: string, locations: RideMemberLocation[]): Promise<RideMemberLocation[]> => {
    const peerIds = locations
      .map((location) => location.riderId)
      .filter((riderId) => riderId !== actorId);
    if (peerIds.length === 0) return locations;
    const allowedPeerIds = new Set(await moderationStore.filterAllowedPeerIds(actorId, peerIds));
    return locations.filter((location) =>
      location.riderId === actorId || allowedPeerIds.has(location.riderId));
  };
  const deps: RouteDeps = {
    rideStore, presenceStore, profileStore, friendStore, messageStore, hideoutStore, authStore,
    moderationStore, hazardStore, scenicRouteStore, accountDeletionStore, rateLimitStore,
    socialRateLimitStore, socialActivityStore, socialEventStore, readinessCheck, directionsProvider,
    placesProvider, liveKitCredentials, revokeRideVoiceParticipants, revokeProximityVoiceParticipants,
    visibleRideLocationsFor,
  };
  const app = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const id = requestId(req, REQUEST_ID_PATTERN);
    const address = clientAddress(req, options.trustProxy === true);
    applyResponsePolicy(res, id);
    res.once('finish', () => {
      try {
        options.logger?.({ requestId: id, method: req.method ?? 'UNKNOWN', path: new URL(req.url ?? '/', 'http://localhost').pathname, status: res.statusCode, durationMs: Date.now() - startedAt, clientAddress: address });
      } catch (error) {
        console.error('request logger failed', error);
      }
    });
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!applyCors(req, res, allowedOrigins)) return sendJson(res, 403, { error: 'origin_not_allowed' });
      if (req.method === 'OPTIONS') return sendEmpty(res, 204);
      if ((await handlePublicRoutes({ ...deps, req, res, url, address })) !== NOT_HANDLED) return;
      const actorId = await authRider(req, res, authStore); if (!actorId) return;
      const ctx: RouteContext = { ...deps, req, res, url, address, actorId, s: url.pathname.split('/').filter(Boolean) };
      await socialActivityStore.touch(actorId);
      if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'api'))) return;
      if ((await handleAccountRoutes(ctx)) !== NOT_HANDLED) return;
      if (requiresVerifiedEmail(req.method, url.pathname) && !(await requireVerifiedEmail(res, authStore, actorId))) return;
      if ((await handleLiveRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleSafetyRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleProfileRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleRideRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleRiderRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleSocialRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleNavigationRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleHazardRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleModerationRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleScenicRouteRoutes(ctx)) !== NOT_HANDLED) return;
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) { if (error instanceof RequestError) return sendJson(res, error.status, { error: error.message }); if (error instanceof URIError) return sendJson(res, 400, { error: 'invalid URL encoding' }); const failedPath = new URL(req.url ?? '/', 'http://localhost').pathname; const failureMessage = error instanceof Error ? error.message : String(error); console.error(JSON.stringify({ level: 'error', event: 'request_failed', requestId: id, method: req.method, path: failedPath, message: failureMessage, stack: error instanceof Error ? error.stack : undefined })); reportOperationalError('request_failed', `${req.method} ${failedPath} (request ${id}): ${failureMessage}`); return sendJson(res, 500, { error: 'internal_error' }); }
  });
  app.once('close', () => {
    void socialEventStore.close?.().catch((error) => console.error('social event listener close failed', error));
  });
  return app;
}
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
async function startProductionServer(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be an integer from 1 to 65535');
  const host = process.env.HOST?.trim() || '0.0.0.0';
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  // Apply and verify every required migration before the listening socket is
  // opened. A deployment with an incompatible/unreachable database therefore
  // never advertises itself as ready or receives product traffic.
  await ensureMigrated();
  const productionAuthStore = new AuthStore();
  const productionRateLimitStore = new RateLimitStore();
  const productionSocialRateLimitStore = new SocialRateLimitStore();
  const productionSocialActivityStore = new SocialActivityStore();
  const productionSocialEventStore = new SocialEventStore();
  const productionRetentionStore = new RetentionStore();
  configureErrorAlerts(new ErrorAlerter({
    recipients: () => productionAuthStore.listAlertRecipients(),
    send: (to, subject, text) => sendOperationalEmail(to, subject, text),
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? 'production',
  }));
  const initialCleanup = await productionAuthStore.cleanupExpiredRecords();
  const initialRateCleanup = await productionRateLimitStore.cleanupExpired();
  const initialSocialRateCleanup = await productionSocialRateLimitStore.cleanupExpired();
  const initialSocialActivityCleanup = await productionSocialActivityStore.cleanupExpired();
  const initialSocialEventCleanup = await productionSocialEventStore.cleanupExpired();
  const initialRetentionSweep = await productionRetentionStore.sweep();
  console.log(JSON.stringify({ level: 'info', event: 'auth_records_cleaned', ...initialCleanup }));
  console.log(JSON.stringify({ level: 'info', event: 'rate_limit_events_cleaned', deleted: initialRateCleanup }));
  console.log(JSON.stringify({ level: 'info', event: 'social_rate_events_cleaned', deleted: initialSocialRateCleanup }));
  console.log(JSON.stringify({ level: 'info', event: 'social_activity_cleaned', deleted: initialSocialActivityCleanup }));
  console.log(JSON.stringify({ level: 'info', event: 'social_events_cleaned', deleted: initialSocialEventCleanup }));
  console.log(JSON.stringify({ level: 'info', event: 'retention_sweep_completed', ...initialRetentionSweep }));
  const app = createApp({
    authStore: productionAuthStore,
    allowedOrigins,
    trustProxy: process.env.TRUST_PROXY === 'true',
    logger: (event) => console.log(JSON.stringify({ level: 'info', event: 'http_request', ...event })),
    rateLimitStore: productionRateLimitStore,
    socialRateLimitStore: productionSocialRateLimitStore,
    socialActivityStore: productionSocialActivityStore,
    socialEventStore: productionSocialEventStore,
  });
  app.requestTimeout = 15_000;
  app.headersTimeout = 10_000;
  app.keepAliveTimeout = 5_000;
  app.maxRequestsPerSocket = 1_000;
  const authCleanupTimer = setInterval(() => {
    void productionAuthStore.cleanupExpiredRecords()
      .then((counts) => console.log(JSON.stringify({ level: 'info', event: 'auth_records_cleaned', ...counts })))
      .catch((error) => console.error(JSON.stringify({ level: 'error', event: 'auth_record_cleanup_failed', message: error instanceof Error ? error.message : String(error) })));
  }, AUTH_CLEANUP_INTERVAL_MS);
  authCleanupTimer.unref();
  const rateLimitCleanupTimer = setInterval(() => {
    void productionRateLimitStore.cleanupExpired()
      .then((deleted) => console.log(JSON.stringify({ level: 'info', event: 'rate_limit_events_cleaned', deleted })))
      .catch((error) => console.error(JSON.stringify({ level: 'error', event: 'rate_limit_cleanup_failed', message: error instanceof Error ? error.message : String(error) })));
  }, RATE_LIMIT_CLEANUP_INTERVAL_MS);
  rateLimitCleanupTimer.unref();
  const socialRateCleanupTimer = setInterval(() => {
    void productionSocialRateLimitStore.cleanupExpired()
      .then((deleted) => console.log(JSON.stringify({ level: 'info', event: 'social_rate_events_cleaned', deleted })))
      .catch((error) => console.error(JSON.stringify({ level: 'error', event: 'social_rate_cleanup_failed', message: error instanceof Error ? error.message : String(error) })));
  }, SOCIAL_RATE_CLEANUP_INTERVAL_MS);
  socialRateCleanupTimer.unref();
  const socialStateCleanupTimer = setInterval(() => {
    void Promise.all([
      productionSocialActivityStore.cleanupExpired(),
      productionSocialEventStore.cleanupExpired(),
    ])
      .then(([activity, events]) => console.log(JSON.stringify({ level: 'info', event: 'social_state_cleaned', activity, events })))
      .catch((error) => console.error(JSON.stringify({ level: 'error', event: 'social_state_cleanup_failed', message: error instanceof Error ? error.message : String(error) })));
  }, SOCIAL_STATE_CLEANUP_INTERVAL_MS);
  socialStateCleanupTimer.unref();
  const retentionSweepTimer = setInterval(() => {
    void productionRetentionStore.sweep()
      .then((counts) => console.log(JSON.stringify({ level: 'info', event: 'retention_sweep_completed', ...counts })))
      .catch((error) => console.error(JSON.stringify({ level: 'error', event: 'retention_sweep_failed', message: error instanceof Error ? error.message : String(error) })));
  }, RETENTION_SWEEP_INTERVAL_MS);
  retentionSweepTimer.unref();

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    clearInterval(authCleanupTimer);
    clearInterval(rateLimitCleanupTimer);
    clearInterval(socialRateCleanupTimer);
    clearInterval(socialStateCleanupTimer);
    clearInterval(retentionSweepTimer);
    void flushErrorAlerts();
    void productionSocialEventStore.close().catch((error) => console.error(JSON.stringify({ level: 'error', event: 'social_event_listener_shutdown_failed', message: error instanceof Error ? error.message : String(error) })));
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
    const forceExit = setTimeout(() => {
      console.error(JSON.stringify({ level: 'error', event: 'shutdown_timeout', signal }));
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    app.close(async (error) => {
      if (error) {
        console.error(JSON.stringify({ level: 'error', event: 'shutdown_failed', message: error.message }));
        process.exitCode = 1;
      }
      try {
        await productionSocialEventStore.close();
        await closeDatabase();
        console.log(JSON.stringify({ level: 'info', event: 'shutdown_complete', signal }));
      } catch (databaseError) {
        console.error(JSON.stringify({ level: 'error', event: 'database_shutdown_failed', message: databaseError instanceof Error ? databaseError.message : String(databaseError) }));
        process.exitCode = 1;
      } finally {
        clearTimeout(forceExit);
      }
    });
  };
  // Last-resort crash logging. An unhandled rejection is logged and the
  // process keeps serving; an uncaught exception leaves the process in an
  // unknown state, so it is logged and the process exits for the host to
  // restart it.
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error(JSON.stringify({ level: 'error', event: 'unhandled_rejection', message, stack: reason instanceof Error ? reason.stack : undefined }));
    reportOperationalError('unhandled_rejection', message);
  });
  process.on('uncaughtException', (error) => {
    console.error(JSON.stringify({ level: 'fatal', event: 'uncaught_exception', message: error.message, stack: error.stack }));
    reportOperationalError('uncaught_exception', error.message);
    // Give the alert email a few seconds, then exit whatever happens.
    void flushErrorAlerts().finally(() => process.exit(1));
  });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  app.listen(port, host, () => console.log(JSON.stringify({ level: 'info', event: 'server_started', host, port, allowedOrigins })));
}

if (isMainModule) {
  void startProductionServer().catch(async (error) => {
    console.error(JSON.stringify({ level: 'error', event: 'startup_failed', message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
    try { await closeDatabase(); } catch { /* startup failure is already logged */ }
  });
}
