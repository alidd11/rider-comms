import http from 'node:http';
import { errorFields, log } from './log.ts';
import { RequestMetrics, routeKey } from './requestMetrics.ts';
import { apiPath, openApiDocument, requiresVerifiedEmail } from './apiCatalogue.ts';
import { createLiveKitRoomAdmin, getLiveKitCredentialsFromEnv } from './liveKitToken.ts';
import type { LiveKitCredentials, LiveKitRoomAdmin } from './liveKitToken.ts';
import { fetchDrivingRoute } from './directionsProvider.ts';
import { DirectionsCache, wrapDirectionsProviderWithCache } from './directionsCache.ts';
import type { DirectionsProvider } from './directionsCache.ts';
import { RetentionStore } from './retentionStore.ts';
import { configureErrorAlerts, ErrorAlerter, flushErrorAlerts, reportOperationalError } from './errorAlerts.ts';
import { DEFAULT_PUBLIC_APP_URL, sendOperationalEmail } from './email.ts';
import { SITE_CHECK_INTERVAL_MS, SiteMonitor } from './siteMonitor.ts';
import { createShutdown, errorMessage, installCrashHandlers, runMaintenance, scheduleMaintenance } from './processLifecycle.ts';
import { onceAcrossReplicas } from './jobLease.ts';
import { runStaffAlerts, STAFF_ALERT_INTERVAL_MS } from './staffAlerts.ts';
import { fetchGooglePlaceDetails, fetchGooglePlaces, fetchGooglePlacesAlongRoute, fetchGooglePlaceSuggestions } from './placesProvider.ts';
import type { PlaceAlongRoute, PlaceAlongRouteRequest, PlaceAutocompleteRequest, PlaceSearchRequest, PlaceSuggestion, PlaceSummary } from './placesProvider.ts';
import { AuthStore } from './authStore.ts';
import { RideStore } from './rideStore.ts';
import type { RideMemberLocation } from './rideStore.ts';
import { PresenceStore } from './presenceStore.ts';
import { ProfileStore } from './profileStore.ts';
import { FriendStore } from './friendStore.ts';
import { MessageStore } from './messageStore.ts';
import { HideoutStore } from './hideoutStore.ts';
import { ModerationStore } from './moderationStore.ts';
import { AdminStatsStore } from './adminStatsStore.ts';
import { HazardStore } from './hazardStore.ts';
import { ScenicRouteStore } from './scenicRouteStore.ts';
import { AccountDeletionStore } from './accountDeletionStore.ts';
import { BillingStore } from './billingStore.ts';
import { storeVerifiersFromEnv } from './storeBilling.ts';
import { SocialRateLimitStore } from './socialRateLimitStore.ts';
import { RateLimitStore } from './rateLimitStore.ts';
import { SocialActivityStore } from './socialActivityStore.ts';
import { SocialEventStore } from './socialEventStore.ts';
import { checkDatabaseReady, closeDatabase, ensureMigrated, getPool } from './db.ts';
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
import { isReservedSocialAppPath, isSocialOpenBetaEnabled, isSocialPostingEnabled, parseSocialPilotRiderIds, socialCapabilities } from './socialPilot.ts';
import { socialMediaServiceFromEnv } from './socialMediaService.ts';
import type { SocialMediaService } from './socialMediaService.ts';
import { SocialPostStore } from './socialPostStore.ts';
import { processSocialMediaDeletes } from './socialMediaDeletionOutbox.ts';
import { handleSocialMediaRoute, handleSocialModerationRoutes, handleSocialPostRoutes } from './routes/socialPosts.ts';
import { handlePushRoutes } from './routes/push.ts';
import { PushNotifier } from './pushNotifier.ts';
import { PushStore } from './pushStore.ts';
import { handleNavigationRoutes } from './routes/navigation.ts';
import { handleHazardRoutes } from './routes/hazards.ts';
import { handleModerationRoutes } from './routes/moderation.ts';
import { handleAdminRoutes } from './routes/admin.ts';
import { handleScenicRouteRoutes } from './routes/scenicRoutes.ts';
import { handleBillingNotificationRoutes, handleBillingRoutes } from './routes/billing.ts';
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
  responseErrorCode,
  sendEmpty,
  sendJson,
} from './serverHttp.ts';

export { parseAllowedOrigins };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
const AUTH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const SOCIAL_RATE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const SOCIAL_STATE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const SOCIAL_MEDIA_SWEEP_INTERVAL_MS = 5 * 60_000;
const RETENTION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const BILLING_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const SUSPENSION_EXPIRY_INTERVAL_MS = 5 * 60_000;

export interface ApiServerOptions {
  allowedOrigins?: readonly string[];
  trustProxy?: boolean;
  logger?: (event: ApiRequestLog) => void;
  /** The API's public address, for the servers list in /openapi.json. */
  publicApiUrl?: string;
  /** Per-route request figures for the dashboard; one per process. */
  requestMetrics?: RequestMetrics;
  /** Defaults to reading LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL from
   * the environment; pass null explicitly (e.g. in tests) to force the
   * "voice not configured" path regardless of the real environment. */
  liveKitCredentials?: LiveKitCredentials | null;
  liveKitRoomAdmin?: Partial<Pick<LiveKitRoomAdmin, 'revokeRideParticipant' | 'revokeProximityParticipant'>> | null;
  accountDeletionStore?: Pick<AccountDeletionStore, 'deleteRider'>;
  billingStore?: Pick<BillingStore, 'status' | 'verifyPurchase' | 'refresh'>;
  rateLimitStore?: Pick<RateLimitStore, 'consume'>;
  directionsProvider?: DirectionsProvider;
  directionsCache?: Pick<DirectionsCache, 'get' | 'set'>;
  placesProvider?: (request: PlaceSearchRequest) => Promise<PlaceSummary[]>;
  placesAlongRouteProvider?: (request: PlaceAlongRouteRequest) => Promise<PlaceAlongRoute[]>;
  placeSuggestionsProvider?: (request: PlaceAutocompleteRequest) => Promise<PlaceSuggestion[]>;
  placeDetailsProvider?: (placeId: string, sessionToken: string) => Promise<PlaceSummary>;
  socialRateLimitStore?: Pick<SocialRateLimitStore, 'consume'>;
  socialActivityStore?: Pick<SocialActivityStore, 'touch' | 'getFriendActivity'>;
  socialEventStore?: Pick<SocialEventStore, 'waitForEvents'> & Partial<Pick<SocialEventStore, 'close'>>;
  /** Test override; production reads SOCIAL_PILOT_RIDER_IDS server-side only. */
  socialPilotRiderIds?: readonly string[];
  /** Explicit open Social testing beta; still requires a valid Rider Comms session. */
  socialOpenBetaEnabled?: boolean;
  socialPostStore?: SocialPostStore;
  /** Defaults to SOCIAL_MEDIA_S3_* from the environment; null disables uploads. */
  socialMedia?: SocialMediaService | null;
  /** Defaults to SOCIAL_POSTING_ENABLED=true; posting also needs media storage. */
  socialPostingEnabled?: boolean;
  readinessCheck?: () => Promise<void>;
  pushStore?: PushStore;
  /** Tests pass a recorder; by default notifications are really sent. */
  pushNotifier?: Pick<PushNotifier, 'notify'>;
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
  adminStatsStore?: Pick<AdminStatsStore, 'overview' | 'searchRiders' | 'riderSummary' | 'increment' | 'recordMilestone'>;
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
  /** The route with IDs replaced, for grouping (see requestMetrics.ts). */
  route: string;
  /** The signed-in rider, once the request was authenticated. */
  riderId?: string;
  /** Why a 4xx/5xx was returned, when the handler said (see sendJson). */
  error?: string;
}

/** Requests slower than this are logged as warnings. */
export const SLOW_REQUEST_MS = 2_000;

export function requestLogLevel(event: Pick<ApiRequestLog, 'status' | 'durationMs'>): 'info' | 'warn' | 'error' {
  if (event.status >= 500) return 'error';
  return event.durationMs > SLOW_REQUEST_MS ? 'warn' : 'info';
}

async function authRider(req: http.IncomingMessage, res: http.ServerResponse, auth: AuthStore): Promise<string | undefined> {
  const riderId = await auth.riderForToken(bearerToken(req));
  if (!riderId) sendJson(res, 401, { error: 'unauthorized' });
  return riderId;
}
async function requireVerifiedEmail(
  res: http.ServerResponse,
  authStore: AuthStore,
  actorId: string,
  pathname: string,
): Promise<boolean> {
  const identity = await authStore.getIdentity(actorId);
  if (!identity) return true;
  if (!identity.emailVerified) {
    sendJson(res, 403, { error: 'email_verification_required' });
    return false;
  }
  // Reporting stays open to everyone; everything else on this list posts
  // content or joins voice, which needs agreement to the current Terms.
  if (!identity.termsAccepted && pathname !== '/reports') {
    sendJson(res, 403, { error: 'terms_acceptance_required' });
    return false;
  }
  return true;
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
  const adminStatsStore = options.adminStatsStore ?? new AdminStatsStore();
  const hazardStore = options.hazardStore ?? new HazardStore();
  const scenicRouteStore = options.scenicRouteStore ?? new ScenicRouteStore();
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const liveKitCredentials = 'liveKitCredentials' in options ? options.liveKitCredentials : getLiveKitCredentialsFromEnv();
  const liveKitRoomAdmin = 'liveKitRoomAdmin' in options
    ? options.liveKitRoomAdmin
    : liveKitCredentials ? createLiveKitRoomAdmin(liveKitCredentials) : null;
  const accountDeletionStore = options.accountDeletionStore ?? new AccountDeletionStore();
  const billingStore = options.billingStore ?? new BillingStore(storeVerifiersFromEnv(), profileStore);
  const rateLimitStore = options.rateLimitStore ?? new RateLimitStore();
  const socialRateLimitStore = options.socialRateLimitStore ?? new SocialRateLimitStore();
  const socialActivityStore = options.socialActivityStore ?? new SocialActivityStore();
  const socialEventStore = options.socialEventStore ?? new SocialEventStore();
  // Fail closed: a missing/malformed allowlist must not unlock the Social beta.
  // Ordinary Rider Comms routes are unchanged, including /social/events.
  const socialPilotRiderIds = parseSocialPilotRiderIds(
    options.socialPilotRiderIds?.join(',') ?? process.env.SOCIAL_PILOT_RIDER_IDS,
  );
  const socialOpenBetaEnabled = options.socialOpenBetaEnabled ??
    isSocialOpenBetaEnabled(process.env.SOCIAL_OPEN_BETA_ENABLED);
  const socialPostStore = options.socialPostStore ?? new SocialPostStore();
  const socialMedia = options.socialMedia === undefined ? socialMediaServiceFromEnv() : options.socialMedia;
  // Posting has its own switch, separate from the beta and from storage being set up.
  // Posting also needs the unsafe-content check (socialMediaScanner.ts).
  const socialPostingEnabled = socialMedia !== null && Boolean(socialMedia.scan) &&
    (options.socialPostingEnabled ?? isSocialPostingEnabled(process.env.SOCIAL_POSTING_ENABLED));
  const pushStore = options.pushStore ?? new PushStore();
  const pushNotifier = options.pushNotifier ?? new PushNotifier({
    store: pushStore,
    getProfile: (riderId) => profileStore.getOrCreate(riderId),
    expoAccessToken: process.env.EXPO_ACCESS_TOKEN?.trim() || undefined,
  });
  const readinessCheck = options.readinessCheck ?? checkDatabaseReady;
  const requestMetrics = options.requestMetrics ?? new RequestMetrics();
  const directionsCache = options.directionsCache ?? new DirectionsCache();
  const directionsProvider = wrapDirectionsProviderWithCache(
    options.directionsProvider ?? ((origin, destination, avoid) => fetchDrivingRoute(origin, destination, { avoid })),
    directionsCache,
  );
  const placesProvider = options.placesProvider ?? ((request: PlaceSearchRequest) => fetchGooglePlaces(request));
  const placesAlongRouteProvider = options.placesAlongRouteProvider ?? ((request: PlaceAlongRouteRequest) => fetchGooglePlacesAlongRoute(request));
  const placeSuggestionsProvider = options.placeSuggestionsProvider ?? ((request: PlaceAutocompleteRequest) => fetchGooglePlaceSuggestions(request));
  const placeDetailsProvider = options.placeDetailsProvider ?? ((placeId: string, sessionToken: string) => fetchGooglePlaceDetails(placeId, sessionToken));
  const revokeRideVoiceParticipants = async (rideId: string, riderIds: Iterable<string>): Promise<void> => {
    const revokeRideParticipant = liveKitRoomAdmin?.revokeRideParticipant;
    if (!revokeRideParticipant) return;
    const uniqueRiderIds = [...new Set(riderIds)];
    const results = await Promise.allSettled(
      uniqueRiderIds.map((riderId) => revokeRideParticipant(rideId, riderId)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        log('error', 'ride_voice_revocation_failed', {
          rideId,
          riderId: uniqueRiderIds[index],
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
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
        log('error', 'proximity_voice_revocation_failed', {
          riderA,
          riderB,
          riderId: riderIds[index],
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
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
    rideStore, pushStore, pushNotifier, presenceStore, profileStore, friendStore, messageStore, hideoutStore, authStore,
    moderationStore, adminStatsStore, hazardStore, scenicRouteStore, billingStore, accountDeletionStore, rateLimitStore,
    socialRateLimitStore, socialActivityStore, socialEventStore, readinessCheck, directionsProvider,
    placesProvider, placesAlongRouteProvider, placeSuggestionsProvider, placeDetailsProvider, liveKitCredentials, revokeRideVoiceParticipants, revokeProximityVoiceParticipants,
    visibleRideLocationsFor, socialPostStore, socialMedia, socialPostingEnabled, requestMetrics,
  };
  const app = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const id = requestId(req, REQUEST_ID_PATTERN);
    let actorIdForLog: string | undefined;
    const address = clientAddress(req, options.trustProxy === true);
    applyResponsePolicy(res, id);
    res.once('finish', () => {
      try {
        const error = responseErrorCode(res);
        const method = req.method ?? 'UNKNOWN';
        const path = apiPath(new URL(req.url ?? '/', 'http://localhost').pathname);
        const durationMs = Date.now() - startedAt;
        requestMetrics.record(method, path, res.statusCode, durationMs);
        options.logger?.({
          requestId: id, method, path, route: routeKey(method, path), status: res.statusCode, durationMs, clientAddress: address,
          ...(actorIdForLog ? { riderId: actorIdForLog } : {}), ...(error ? { error } : {}),
        });
      } catch (error) {
        log('error', 'request_logger_failed', errorFields(error));
      }
    });
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Every route also answers under /v1, so clients can pin the version.
      url.pathname = apiPath(url.pathname);
      if (!applyCors(req, res, allowedOrigins)) return sendJson(res, 403, { error: 'origin_not_allowed' });
      if (req.method === 'OPTIONS') return sendEmpty(res, 204);
      if (req.method === 'GET' && url.pathname === '/openapi.json') return sendJson(res, 200, openApiDocument(options.publicApiUrl ?? process.env.PUBLIC_API_URL));
      if ((await handlePublicRoutes({ ...deps, req, res, url, address })) !== NOT_HANDLED) return;
      if ((await handleBillingNotificationRoutes({ ...deps, req, res, url, address })) !== NOT_HANDLED) return;
      if ((await handleSocialMediaRoute({ ...deps, req, res, url, address })) !== NOT_HANDLED) return;
      const actorId = await authRider(req, res, authStore);
      if (!actorId) return;
      actorIdForLog = actorId;
      const ctx: RouteContext = { ...deps, req, res, url, address, actorId, s: url.pathname.split('/').filter(Boolean) };
      await socialActivityStore.touch(actorId);
      if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'api'))) return;
      if (isReservedSocialAppPath(url.pathname)) {
        if (!socialOpenBetaEnabled && !socialPilotRiderIds.has(actorId))
          return sendJson(res, 403, { error: 'social_beta_not_enabled' });
        if (req.method === 'GET' && url.pathname === '/social/bootstrap') {
          return sendJson(res, 200, {
            entitlement: socialOpenBetaEnabled ? 'beta' : 'pilot',
            policyVersion: socialOpenBetaEnabled ? 'social-open-beta-v1' : 'social-pilot-v1',
            capabilities: socialCapabilities(socialPostingEnabled),
          });
        }
      }
      if ((await handleAccountRoutes(ctx)) !== NOT_HANDLED) return;
      // Before the verified-email gate: any signed-in rider can get notifications.
      if ((await handlePushRoutes(ctx)) !== NOT_HANDLED) return;
      // Before the verified-email gate: a purchase must always be recorded.
      if ((await handleBillingRoutes(ctx)) !== NOT_HANDLED) return;
      if (requiresVerifiedEmail(req.method, url.pathname) && !(await requireVerifiedEmail(res, authStore, actorId, url.pathname))) return;
      if ((await handleLiveRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleSafetyRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleProfileRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleRideRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleRiderRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleSocialRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleSocialPostRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleNavigationRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleHazardRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleSocialModerationRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleModerationRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleAdminRoutes(ctx)) !== NOT_HANDLED) return;
      if ((await handleScenicRouteRoutes(ctx)) !== NOT_HANDLED) return;
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof RequestError) return sendJson(res, error.status, { error: error.message });
      if (error instanceof URIError) return sendJson(res, 400, { error: 'invalid URL encoding' });
      const failedPath = new URL(req.url ?? '/', 'http://localhost').pathname;
      const failureMessage = error instanceof Error ? error.message : String(error);
      log('error', 'request_failed', {
        requestId: id,
        method: req.method,
        path: failedPath,
        riderId: actorIdForLog,
        message: failureMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      reportOperationalError('request_failed', `${req.method} ${failedPath} (request ${id}): ${failureMessage}`);
      return sendJson(res, 500, { error: 'internal_error' });
    }
  });
  app.once('close', () => {
    if (!options.requestMetrics) requestMetrics.stop();
    void socialEventStore.close?.().catch((error) => log('error', 'social_event_listener_close_failed', errorFields(error)));
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
  const productionAdminStatsStore = new AdminStatsStore();
  const productionModerationStore = new ModerationStore();
  const productionSocialPostStore = new SocialPostStore();
  const productionSocialMedia = socialMediaServiceFromEnv();
  configureErrorAlerts(new ErrorAlerter({
    recipients: () => productionAuthStore.listAlertRecipients(),
    send: (to, subject, text) => sendOperationalEmail(to, subject, text),
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? 'production',
  }));
  const productionBillingStore = new BillingStore(storeVerifiersFromEnv());
  log('info', 'billing_configured', { purchasesEnabled: productionBillingStore.purchasesEnabled });
  const logInfo = (event: string, fields: object) => log('info', event, { ...fields });

  // Each job runs once now and then on its interval. A failure in a cleanup
  // that must succeed before serving aborts startup; later failures are logged.
  const cleanAuthRecords = async () => logInfo('auth_records_cleaned', await productionAuthStore.cleanupExpiredRecords());
  const cleanRateLimits = async () => logInfo('rate_limit_events_cleaned', { deleted: await productionRateLimitStore.cleanupExpired() });
  const cleanSocialRates = async () => logInfo('social_rate_events_cleaned', { deleted: await productionSocialRateLimitStore.cleanupExpired() });
  const cleanSocialState = async () => {
    const [activity, events] = await Promise.all([productionSocialActivityStore.cleanupExpired(), productionSocialEventStore.cleanupExpired()]);
    logInfo('social_state_cleaned', { activity, events });
  };
  const sweepRetention = async () => logInfo('retention_sweep_completed', await productionRetentionStore.sweep());
  // Renewals and cancellations, whether or not store notifications arrive.
  const sweepBilling = async () => {
    const counts = await productionBillingStore.sweep();
    if (counts.checked > 0) logInfo('billing_sweep_completed', counts);
  };
  logInfo('social_media_configured', { enabled: productionSocialMedia !== null });
  // Rider Social: delete stored files queued by deleted posts and accounts,
  // and uploads that were never posted.
  const sweepSocialMedia = async () => {
    if (!productionSocialMedia) return;
    const orphans = await productionSocialPostStore.sweepUnattachedMedia();
    const deletes = await processSocialMediaDeletes(getPool(), productionSocialMedia.storage, 25);
    if (orphans || deletes.succeeded || deletes.deferred) logInfo('social_media_swept', { orphans, ...deletes });
  };
  // Daily active-rider snapshot for the staff dashboard (aggregate count only).
  const recordActiveRiders = () => productionAdminStatsStore.recordActiveRiders();
  const liftSuspensions = async () => {
    const lifted = await productionModerationStore.liftExpiredSuspensions();
    for (const riderId of lifted) productionAuthStore.forgetRider(riderId);
    if (lifted.length) logInfo('suspensions_lifted', { count: lifted.length });
  };
  for (const job of [cleanAuthRecords, cleanRateLimits, cleanSocialRates, cleanSocialState, sweepRetention]) await job();
  void runMaintenance('billing_sweep_failed', sweepBilling);
  void runMaintenance('active_riders_snapshot_failed', recordActiveRiders);

  const app = createApp({
    authStore: productionAuthStore,
    billingStore: productionBillingStore,
    moderationStore: productionModerationStore,
    allowedOrigins,
    trustProxy: process.env.TRUST_PROXY === 'true',
    logger: (event) => log(requestLogLevel(event), 'http_request', { ...event }),
    rateLimitStore: productionRateLimitStore,
    socialRateLimitStore: productionSocialRateLimitStore,
    socialActivityStore: productionSocialActivityStore,
    socialEventStore: productionSocialEventStore,
    socialPostStore: productionSocialPostStore,
    socialMedia: productionSocialMedia,
  });
  // Long enough for a Rider Social video upload on a phone connection; the
  // headers still have to arrive within headersTimeout.
  app.requestTimeout = 300_000;
  app.headersTimeout = 10_000;
  app.keepAliveTimeout = 5_000;
  app.maxRequestsPerSocket = 1_000;
  // The web app and the privacy page the stores link to. The first check
  // waits one interval, so a deploy restart never alerts.
  const publicAppUrl = new URL(process.env.PUBLIC_APP_URL ?? DEFAULT_PUBLIC_APP_URL);
  const siteMonitor = new SiteMonitor({
    urls: [publicAppUrl.href, new URL('privacy.html', publicAppUrl).href],
    report: (summary) => reportOperationalError('web_app_down', summary),
    log: ({ level, event, ...fields }) => log(level === 'warn' ? 'warn' : 'info', String(event), fields),
  });
  const timers = [
    scheduleMaintenance(AUTH_CLEANUP_INTERVAL_MS, 'auth_record_cleanup_failed', onceAcrossReplicas('auth_record_cleanup', AUTH_CLEANUP_INTERVAL_MS, cleanAuthRecords)),
    scheduleMaintenance(RATE_LIMIT_CLEANUP_INTERVAL_MS, 'rate_limit_cleanup_failed', onceAcrossReplicas('rate_limit_cleanup', RATE_LIMIT_CLEANUP_INTERVAL_MS, cleanRateLimits)),
    scheduleMaintenance(SOCIAL_RATE_CLEANUP_INTERVAL_MS, 'social_rate_cleanup_failed', onceAcrossReplicas('social_rate_cleanup', SOCIAL_RATE_CLEANUP_INTERVAL_MS, cleanSocialRates)),
    scheduleMaintenance(SOCIAL_STATE_CLEANUP_INTERVAL_MS, 'social_state_cleanup_failed', onceAcrossReplicas('social_state_cleanup', SOCIAL_STATE_CLEANUP_INTERVAL_MS, cleanSocialState)),
    scheduleMaintenance(RETENTION_SWEEP_INTERVAL_MS, 'retention_sweep_failed', onceAcrossReplicas('retention_sweep', RETENTION_SWEEP_INTERVAL_MS, sweepRetention)),
    scheduleMaintenance(BILLING_SWEEP_INTERVAL_MS, 'billing_sweep_failed', onceAcrossReplicas('billing_sweep', BILLING_SWEEP_INTERVAL_MS, sweepBilling)),
    scheduleMaintenance(RETENTION_SWEEP_INTERVAL_MS, 'active_riders_snapshot_failed', onceAcrossReplicas('active_riders_snapshot', RETENTION_SWEEP_INTERVAL_MS, recordActiveRiders)),
    scheduleMaintenance(SITE_CHECK_INTERVAL_MS, 'site_check_failed', onceAcrossReplicas('site_check', SITE_CHECK_INTERVAL_MS, () => siteMonitor.check())),
    scheduleMaintenance(STAFF_ALERT_INTERVAL_MS, 'staff_alerts_failed', onceAcrossReplicas('staff_alerts', STAFF_ALERT_INTERVAL_MS, () => runStaffAlerts())),
    scheduleMaintenance(SUSPENSION_EXPIRY_INTERVAL_MS, 'suspension_expiry_failed', onceAcrossReplicas('suspension_expiry', SUSPENSION_EXPIRY_INTERVAL_MS, liftSuspensions)),
    scheduleMaintenance(SOCIAL_MEDIA_SWEEP_INTERVAL_MS, 'social_media_sweep_failed', onceAcrossReplicas('social_media_sweep', SOCIAL_MEDIA_SWEEP_INTERVAL_MS, sweepSocialMedia)),
  ];

  const shutdown = createShutdown({
    server: app,
    timers,
    beforeClose: () => {
      void flushErrorAlerts();
      void productionSocialEventStore.close().catch((error) => log('error', 'social_event_listener_shutdown_failed', { message: errorMessage(error) }));
    },
    closeResources: async () => {
      await productionSocialEventStore.close();
      await closeDatabase();
    },
    exit: (code) => process.exit(code),
    setExitCode: (code) => { process.exitCode = code; },
  });
  installCrashHandlers(process, { report: reportOperationalError, flush: flushErrorAlerts, exit: (code) => process.exit(code) });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  app.listen(port, host, () => logInfo('server_started', { host, port, allowedOrigins }));
}

if (isMainModule) {
  void startProductionServer().catch(async (error) => {
    log('error', 'startup_failed', { message: errorMessage(error) });
    process.exitCode = 1;
    try { await closeDatabase(); } catch { /* startup failure is already logged */ }
  });
}
