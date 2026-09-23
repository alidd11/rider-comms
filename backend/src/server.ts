import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { TIER_RADIUS_MILES, validateScenicRouteInput } from '@rider-comms/shared';
import type { Difficulty, HazardType, RoadType, Rider, VehicleCategory } from '@rider-comms/shared';
import { createLiveKitRoomAdmin, getLiveKitCredentialsFromEnv, mintVoiceToken, proximityRoomName, RIDE_VOICE_TOKEN_TTL_SECONDS, rideRoomName } from './liveKitToken.ts';
import type { LiveKitCredentials, LiveKitRoomAdmin } from './liveKitToken.ts';
import { DirectionsProviderError, fetchGoogleDrivingRoute } from './directionsProvider.ts';
import type { DrivingRoute, RouteCoordinate } from './directionsProvider.ts';
import { AuthStore } from './authStore.ts';
import { RideStore } from './rideStore.ts';
import type { RideMemberLocation } from './rideStore.ts';
import { PresenceStore, StaleLocationFixError } from './presenceStore.ts';
import { ProfileStore } from './profileStore.ts';
import { FriendStore, InvalidFriendCursorError } from './friendStore.ts';
import { InvalidMessageCursorError, MessageStore } from './messageStore.ts';
import { HideoutStore } from './hideoutStore.ts';
import { ModerationStore, REPORT_REASONS } from './moderationStore.ts';
import type { ReportReason } from './moderationStore.ts';
import { HazardStore } from './hazardStore.ts';
import { ScenicRouteStore } from './scenicRouteStore.ts';
import { AccountDeletionStore } from './accountDeletionStore.ts';
import { SocialRateLimitStore } from './socialRateLimitStore.ts';
import type { SocialRateAction } from './socialRateLimitStore.ts';
import { RateLimitStore } from './rateLimitStore.ts';
import type { RateLimitAction } from './rateLimitStore.ts';
import { SocialActivityStore } from './socialActivityStore.ts';
import { InvalidSocialEventCursorError, MAX_SOCIAL_EVENT_WAIT_MS, SocialEventStore } from './socialEventStore.ts';
import { checkDatabaseReady, closeDatabase, ensureMigrated } from './db.ts';

const HAZARD_TYPES = ['police', 'accident', 'road_closure', 'camera', 'hidden_police', 'police_checkpoint'] as const;
const VEHICLE_CATEGORIES = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'] as const;
const ROAD_TYPES = ['rural', 'mountain', 'coastal', 'urban', 'mixed'] as const;
const DIFFICULTIES = ['easy', 'moderate', 'challenging'] as const;

const MAX_BODY_BYTES = 32 * 1024;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
const MAX_PRESENCE_ACCURACY_METERS = 100;
const MAX_PRESENCE_FIX_AGE_MS = 30_000;
const MAX_PRESENCE_FUTURE_SKEW_MS = 5_000;
const PROXIMITY_VOICE_TOKEN_TTL_SECONDS = 60;
const PROXIMITY_VOICE_REFRESH_MS = 20_000;
// LiveKit token expiry only gates joining; it does not eject an already
// connected participant. Treat public proximity authorization as a renewable
// client lease so a stale pair cannot remain connected indefinitely if the
// backend/presence path stops confirming that they are still allowed together.
const PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS = PROXIMITY_VOICE_TOKEN_TTL_SECONDS * 1000;
const AUTH_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const SOCIAL_RATE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const SOCIAL_STATE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

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
  socialRateLimitStore?: Pick<SocialRateLimitStore, 'consume'>;
  socialActivityStore?: Pick<SocialActivityStore, 'touch' | 'getFriendActivity'>;
  socialEventStore?: Pick<SocialEventStore, 'waitForEvents'> & Partial<Pick<SocialEventStore, 'close'>>;
  readinessCheck?: () => Promise<void>;
}

export interface ApiRequestLog {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  clientAddress: string;
}

class RequestError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

function requestId(req: http.IncomingMessage): string {
  const supplied = req.headers['x-request-id'];
  return typeof supplied === 'string' && REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

function clientAddress(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const candidate = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (candidate && isIP(candidate)) return candidate;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function applyResponsePolicy(res: http.ServerResponse, id: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Request-ID', id);
}

function applyCors(req: http.IncomingMessage, res: http.ServerResponse, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Request-ID');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean).map((value) => {
    const parsed = new URL(value);
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.origin !== value || (parsed.protocol !== 'https:' && !localHttp)) {
      throw new Error(`Invalid CORS origin: ${value}`);
    }
    return parsed.origin;
  }))];
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function sendEmpty(res: http.ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}
function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '', bytes = 0, tooLarge = false;
    req.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_BODY_BYTES) tooLarge = true; else data += chunk.toString('utf8'); });
    req.on('end', () => {
      if (tooLarge) return reject(new RequestError(413, 'request body is too large'));
      if (!data) return resolve({});
      try { const parsed: unknown = JSON.parse(data); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new RequestError(400, 'request body must be a JSON object'); resolve(parsed as Record<string, unknown>); }
      catch (error) { reject(error instanceof RequestError ? error : new RequestError(400, 'invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function bearerToken(req: http.IncomingMessage): string {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}
async function authRider(req: http.IncomingMessage, res: http.ServerResponse, auth: AuthStore): Promise<string | undefined> {
  const riderId = await auth.riderForToken(bearerToken(req));
  if (!riderId) sendJson(res, 401, { error: 'unauthorized' });
  return riderId;
}
function isCoordinate(lat: unknown, lon: unknown): boolean { return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 && typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180; }
function routeCoordinate(value: unknown): RouteCoordinate | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const candidate = value as { lat?: unknown; lon?: unknown };
  if (!isCoordinate(candidate.lat, candidate.lon)) return null;
  return { lat: candidate.lat as number, lon: candidate.lon as number };
}
function rideBody(ride: { id: string; createdBy: string; createdAt: number; memberIds: Set<string> }) { return { rideId: ride.id, createdBy: ride.createdBy, createdAt: ride.createdAt, memberIds: [...ride.memberIds] }; }
async function publicProfile(profileStore: ProfileStore, friendStore: FriendStore, actorId: string, targetId: string) {
  const profile = await profileStore.getOrCreate(targetId);
  const isFriend = actorId === targetId ? false : await friendStore.isFriendOf(actorId, targetId);
  const canSee = (visibility: 'public' | 'friends' | 'private') => visibility === 'public' || (visibility === 'friends' && isFriend) || actorId === targetId;
  return { riderId: profile.riderId, displayName: profile.displayName, handle: profile.handle, avatarId: profile.avatarId, instagramUsername: canSee(profile.instagramVisibility) ? profile.instagramUsername : '', tiktokUsername: canSee(profile.tiktokVisibility) ? profile.tiktokUsername : '' };
}

async function consumeSocialWrite(
  res: http.ServerResponse,
  store: Pick<SocialRateLimitStore, 'consume'>,
  actorId: string,
  action: SocialRateAction,
): Promise<boolean> {
  const result = await store.consume(actorId, action);
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  sendJson(res, 429, { error: 'rate_limited' });
  return false;
}

function rateLimitSubject(scope: 'ip' | 'rider', value: string): string {
  return createHash('sha256').update(`${scope}:${value}`).digest('hex');
}

async function consumeRateLimit(
  res: http.ServerResponse,
  store: Pick<RateLimitStore, 'consume'>,
  subjectKey: string,
  action: RateLimitAction,
): Promise<boolean> {
  const result = await store.consume(subjectKey, action);
  if (result.allowed) return true;
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  sendJson(res, 429, { error: 'rate_limited' });
  return false;
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

export function createApp(rideStore = new RideStore(), presenceStore = new PresenceStore(), profileStore = new ProfileStore(), friendStore = new FriendStore(profileStore), messageStore = new MessageStore(), hideoutStore = new HideoutStore(), authStore = new AuthStore(), moderationStore = new ModerationStore(), hazardStore = new HazardStore(), scenicRouteStore = new ScenicRouteStore(), options: ApiServerOptions = {}): http.Server {
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
  const directionsProvider = options.directionsProvider ?? ((origin: RouteCoordinate, destination: RouteCoordinate) => fetchGoogleDrivingRoute(origin, destination));
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
  const app = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const id = requestId(req);
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
      if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/ready') {
        try {
          await readinessCheck();
          return sendJson(res, 200, { ok: true });
        } catch (error) {
          console.error(JSON.stringify({ level: 'error', event: 'readiness_failed', message: error instanceof Error ? error.message : String(error) }));
          return sendJson(res, 503, { ok: false, error: 'not_ready' });
        }
      }
      if (req.method === 'GET' && url.pathname === '/config') {
        return sendJson(res, 200, { googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '' });
      }
      if (req.method === 'POST' && url.pathname === '/auth/signup') {
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'auth'))) return;
        const body = await readJsonBody(req);
        const result = await authStore.signUp(body.username, body.email, body.password, body.deviceName);
        if ('error' in result) return sendJson(res, result.error === 'username_taken' || result.error === 'email_taken' ? 409 : 400, { error: result.error });
        await profileStore.getOrCreate(result.riderId);
        await socialActivityStore.touch(result.riderId);
        return sendJson(res, 201, result);
      }
      if (req.method === 'POST' && url.pathname === '/auth/login') {
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'auth'))) return;
        const body = await readJsonBody(req);
        const result = await authStore.logIn(body.username, body.password, body.deviceName);
        if ('error' in result) return sendJson(res, 401, { error: result.error });
        await profileStore.getOrCreate(result.riderId);
        await socialActivityStore.touch(result.riderId);
        return sendJson(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/auth/verify-email') {
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'auth'))) return;
        const body = await readJsonBody(req);
        const result = await authStore.verifyEmail(body.token);
        if ('error' in result) return sendJson(res, result.error === 'invalid_token' ? 400 : 410, { error: result.error });
        return sendJson(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/auth/password-reset/request') {
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'password_reset_request'))) return;
        const body = await readJsonBody(req);
        await authStore.requestPasswordReset(body.email);
        return sendJson(res, 202, { accepted: true });
      }
      if (req.method === 'POST' && url.pathname === '/auth/password-reset/confirm') {
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'auth'))) return;
        const body = await readJsonBody(req);
        const result = await authStore.resetPassword(body.token, body.password);
        if ('error' in result) return sendJson(res, result.error === 'expired_token' ? 410 : 400, { error: result.error });
        return sendJson(res, 200, result);
      }
      const actorId = await authRider(req, res, authStore); if (!actorId) return;
      await socialActivityStore.touch(actorId);
      if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'api'))) return;
      if (req.method === 'GET' && url.pathname === '/auth/me') {
        const identity = await authStore.getIdentity(actorId);
        return sendJson(res, 200, { riderId: actorId, username: identity?.username ?? null, emailVerified: identity?.emailVerified ?? false });
      }
      if (req.method === 'GET' && url.pathname === '/auth/sessions') {
        return sendJson(res, 200, { sessions: await authStore.listSessions(actorId, bearerToken(req)) });
      }
      const sessionMatch = url.pathname.match(/^\/auth\/sessions\/([^/]+)$/);
      if (req.method === 'DELETE' && sessionMatch) {
        const removed = await authStore.revokeSession(actorId, decodeURIComponent(sessionMatch[1]));
        return removed ? sendEmpty(res, 204) : sendJson(res, 404, { error: 'session_not_found' });
      }
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        await authStore.revokeToken(bearerToken(req));
        return sendEmpty(res, 204);
      }
      if (req.method === 'POST' && url.pathname === '/auth/resend-verification') {
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'verification_resend'))) return;
        const result = await authStore.resendVerification(actorId);
        if ('error' in result) return sendJson(res, result.error === 'not_found' ? 404 : 409, { error: result.error });
        return sendJson(res, 200, result);
      }
      if (req.method === 'DELETE' && url.pathname === '/auth/me') {
        await accountDeletionStore.deleteRider(actorId);
        // Do not revoke the in-process token until the database transaction
        // commits. If deletion fails, the rider can retry instead of being
        // logged out while their durable account and data still exist.
        authStore.forgetRider(actorId);
        return sendJson(res, 200, {});
      }
      if (requiresVerifiedEmail(req.method, url.pathname) && !(await requireVerifiedEmail(res, authStore, actorId))) return;
      if (req.method === 'POST' && url.pathname === '/rides') { const { ride, codeRecord } = await rideStore.createRide(actorId); return sendJson(res, 201, { ...rideBody(ride), code: codeRecord.code, expiresAt: codeRecord.expiresAt }); }
      if (req.method === 'POST' && url.pathname === '/rides/join') {
        const body = await readJsonBody(req);
        if (typeof body.code !== 'string' || !/^[A-Z2-9]{6}$/i.test(body.code)) return sendJson(res, 400, { error: 'a valid 6-character code is required' });
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'ride_join_rider'))) return;
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'ride_join_ip'))) return;
        const result = await rideStore.joinRide(body.code, actorId);
        if (!result.ok) {
          const status = result.reason === 'ride_full' ? 409 : 404;
          return sendJson(res, status, { error: result.reason });
        }
        return sendJson(res, 200, { rideId: result.rideId });
      }
      if (req.method === 'POST' && url.pathname === '/presence') {
        const body = await readJsonBody(req);
        if (!isCoordinate(body.lat, body.lon)) return sendJson(res, 400, { error: 'valid lat and lon are required' });
        if (typeof body.accuracyMeters !== 'number' || !Number.isFinite(body.accuracyMeters) || body.accuracyMeters < 0 || body.accuracyMeters > MAX_PRESENCE_ACCURACY_METERS) {
          return sendJson(res, 400, { error: 'location accuracy must be between 0 and 100 metres' });
        }
        const now = Date.now();
        if (typeof body.recordedAt !== 'number' || !Number.isFinite(body.recordedAt) || body.recordedAt < now - MAX_PRESENCE_FIX_AGE_MS || body.recordedAt > now + MAX_PRESENCE_FUTURE_SKEW_MS) {
          return sendJson(res, 400, { error: 'location fix timestamp is stale or invalid' });
        }
        const profile = await profileStore.getOrCreate(actorId); if (!profile.shareLocation) { await presenceStore.removeRider(actorId); return sendJson(res, 403, { error: 'location_sharing_disabled' }); }
        const rider: Rider = { id: actorId, location: { lat: body.lat as number, lon: body.lon as number }, radiusMiles: TIER_RADIUS_MILES[profile.zoneTier], updatedAt: body.recordedAt };
        let presenceResult: Awaited<ReturnType<PresenceStore['updatePresence']>>;
        try {
          presenceResult = await presenceStore.updatePresence({ ...rider, accuracyMeters: body.accuracyMeters });
        } catch (error) {
          if (error instanceof StaleLocationFixError) return sendJson(res, 409, { error: 'out_of_order_location_fix' });
          throw error;
        }
        const inZonePeerIds = presenceStore.ridersInZoneWith(actorId, presenceResult.zonePairs);
        const actorTransitions = presenceResult.transitions.filter((transition) => transition.a === actorId || transition.b === actorId);
        const transitionPeerIds = actorTransitions.map((transition) => transition.a === actorId ? transition.b : transition.a);
        const allowedPeerIds = new Set(await moderationStore.filterAllowedPeerIds(actorId, [...inZonePeerIds, ...transitionPeerIds]));
        return sendJson(res, 200, {
          inZoneWith: inZonePeerIds.filter((peerId) => allowedPeerIds.has(peerId)),
          transitions: actorTransitions.filter((transition) => allowedPeerIds.has(transition.a === actorId ? transition.b : transition.a)),
          radiusMiles: rider.radiusMiles,
        });
      }
      if (req.method === 'DELETE' && url.pathname === '/presence') { await presenceStore.removeRider(actorId); return sendJson(res, 200, {}); }
      if (req.method === 'POST' && url.pathname === '/voice/token') {
        if (!liveKitCredentials) return sendJson(res, 503, { error: 'voice_not_configured' });
        const body = await readJsonBody(req);
        if (body.target === 'ride') {
          if (typeof body.rideId !== 'string') return sendJson(res, 400, { error: 'rideId is required' });
          const result = await rideStore.getRideForMember(body.rideId, actorId);
          if (!result.ok) return sendJson(res, result.reason === 'not_found' ? 404 : 403, { error: result.reason });
          const otherMemberIds = [...result.ride.memberIds].filter((riderId) => riderId !== actorId);
          if (await moderationStore.isBlockedByAny(actorId, otherMemberIds)) {
            return sendJson(res, 403, { error: 'blocked' });
          }
          const voiceToken = await mintVoiceToken(
            liveKitCredentials,
            actorId,
            rideRoomName(result.ride.id),
            RIDE_VOICE_TOKEN_TTL_SECONDS,
          );
          return sendJson(res, 200, voiceToken);
        }
        if (body.target === 'channel') {
          const peerIds = await presenceStore.getCurrentPeerIds(actorId);
          const authorisedPeerIds = await moderationStore.filterAllowedPeerIds(actorId, peerIds);
          const connections = await Promise.all(authorisedPeerIds.map(async (peerId) => ({
            peerId,
            ...(await mintVoiceToken(
              liveKitCredentials,
              actorId,
              proximityRoomName(actorId, peerId),
              PROXIMITY_VOICE_TOKEN_TTL_SECONDS
            )),
          })));
          return sendJson(res, 200, {
            connections,
            refreshAfterMs: PROXIMITY_VOICE_REFRESH_MS,
            authorizationLeaseMs: PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS,
          });
        }
        return sendJson(res, 400, { error: "target must be 'ride' or 'channel'" });
      }
      const s = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && url.pathname === '/blocks') {
        return sendJson(res, 200, { blockedRiderIds: await moderationStore.getBlocked(actorId) });
      }
      if (req.method === 'POST' && url.pathname === '/blocks') {
        const body = await readJsonBody(req);
        if (typeof body.riderId !== 'string' || body.riderId === actorId) return sendJson(res, 400, { error: 'valid riderId is required' });
        if (!(await authStore.hasRider(body.riderId))) return sendJson(res, 404, { error: 'rider_not_found' });
        const blockedRiderId = body.riderId;
        const sharedRideIds = await rideStore.getSharedRideIds(actorId, blockedRiderId);
        await moderationStore.block(actorId, blockedRiderId);
        // Blocking immediately closes any already-authorised public pair room
        // for both identities. Token refresh and the authorization lease still
        // fail closed independently if provider-side revocation is unavailable.
        await Promise.all([
          revokeProximityVoiceParticipants(actorId, blockedRiderId),
          ...sharedRideIds.map((rideId) => revokeRideVoiceParticipants(rideId, [blockedRiderId])),
        ]);
        return sendJson(res, 200, {});
      }
      if (req.method === 'DELETE' && s[0] === 'blocks' && s[1] && s.length === 2) {
        await moderationStore.unblock(actorId, decodeURIComponent(s[1]));
        return sendJson(res, 200, {});
      }
      if (req.method === 'POST' && url.pathname === '/reports') {
        const body = await readJsonBody(req);
        if (typeof body.riderId !== 'string' || body.riderId === actorId || !(await authStore.hasRider(body.riderId))) return sendJson(res, 400, { error: 'valid riderId is required' });
        if (typeof body.reason !== 'string' || !REPORT_REASONS.includes(body.reason as ReportReason)) return sendJson(res, 400, { error: 'invalid report reason' });
        const details = typeof body.details === 'string' ? body.details.trim() : '';
        if (details.length > 1000) return sendJson(res, 400, { error: 'details must be at most 1000 characters' });
        if (!(await consumeSocialWrite(res, socialRateLimitStore, actorId, 'safety_report'))) return;
        await moderationStore.report(actorId, body.riderId, body.reason as ReportReason, details);
        return sendJson(res, 201, { received: true });
      }
      if (req.method === 'GET' && s[0] === 'profiles' && s[1] && s.length === 2) {
        const targetId = decodeURIComponent(s[1]);
        if (!(await authStore.hasRider(targetId))) return sendJson(res, 404, { error: 'rider_not_found' });
        if (await moderationStore.isBlockedBetween(actorId, targetId)) return sendJson(res, 403, { error: 'blocked' });
        return sendJson(res, 200, await publicProfile(profileStore, friendStore, actorId, targetId));
      }
      if (req.method === 'GET' && url.pathname === '/rides/current') {
        const current = await rideStore.getCurrentRideForMember(actorId);
        return sendJson(res, 200, { ride: current ? {
          ...rideBody(current.ride), shareRideLocation: current.shareRideLocation, code: current.code,
        } : null });
      }
      if (s[0] === 'rides' && s[1]) {
        const id = decodeURIComponent(s[1]);
        if (req.method === 'GET' && s.length === 2) {
          const session = await rideStore.getMemberRideSession(id, actorId);
          return session ? sendJson(res, 200, { ...rideBody(session.ride), shareRideLocation: session.shareRideLocation, code: session.code }) : sendJson(res, 404, { error: 'not_found' });
        }
        if (req.method === 'POST' && s[2] === 'leave') {
          const r = await rideStore.leaveRide(id, actorId);
          if (r.ok) await revokeRideVoiceParticipants(id, [actorId]);
          return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason });
        }
        if (req.method === 'DELETE' && s.length === 2) {
          const r = await rideStore.endRide(id, actorId);
          if (r.ok) await revokeRideVoiceParticipants(id, r.ride.memberIds);
          return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason });
        }
        if (req.method === 'DELETE' && s[2] === 'members' && s[3]) {
          const memberId = decodeURIComponent(s[3]);
          const r = await rideStore.removeMember(id, actorId, memberId);
          if (r.ok) await revokeRideVoiceParticipants(id, [memberId]);
          return r.ok ? sendJson(res, 200, rideBody(r.ride)) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason });
        }
        if (req.method === 'PUT' && s[2] === 'location-sharing') {
          const body = await readJsonBody(req);
          if (typeof body.enabled !== 'boolean') return sendJson(res, 400, { error: 'enabled must be a boolean' });
          const r = await rideStore.setMemberLocationSharing(id, actorId, body.enabled);
          return r.ok ? sendJson(res, 200, { enabled: body.enabled }) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason });
        }
        if (req.method === 'POST' && s[2] === 'location') {
          const body = await readJsonBody(req); if (!isCoordinate(body.lat, body.lon)) return sendJson(res, 400, { error: 'valid lat and lon are required' });
          const r = await rideStore.updateMemberLocation(id, actorId, body.lat as number, body.lon as number);
          if (!r.ok) return sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason });
          return sendJson(res, 200, { locations: await visibleRideLocationsFor(actorId, r.locations) });
        }
        if (req.method === 'GET' && s[2] === 'locations') {
          const r = await rideStore.getMemberLocations(id, actorId);
          if (!r.ok) return sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason });
          // A private-ride membership is not permission to bypass an explicit
          // block. Preserve the actor's own shared fix, but never disclose a
          // blocked peer's precise coordinates in either direction.
          return sendJson(res, 200, { locations: await visibleRideLocationsFor(actorId, r.locations) });
        }
      }
      if (s[0] === 'riders' && s[2]) {
        if (decodeURIComponent(s[1]) !== actorId) return sendJson(res, 403, { error: 'forbidden' });
        if (s[2] === 'profile') {
          if (req.method === 'GET') return sendJson(res, 200, await profileStore.getOrCreate(actorId));
          if (req.method === 'PUT') { const body = await readJsonBody(req); if ('zoneTier' in body && body.zoneTier !== 'free') return sendJson(res, 403, { error: 'zone_tier_managed_by_billing' }); const r = await profileStore.update(actorId, body); if (r.ok && body.shareLocation === false) await presenceStore.removeRider(actorId); return r.ok ? sendJson(res, 200, r.profile) : sendJson(res, 400, { error: r.error }); }
        }
        if (req.method === 'GET' && (s[2] === 'friend-requests' || (s[2] === 'friends' && s.length === 3))) {
          const limit = Number(url.searchParams.get('limit') ?? 100);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100) return sendJson(res, 400, { error: 'limit must be an integer from 1 to 100' });
          try {
            const before = url.searchParams.get('before') ?? undefined;
            return sendJson(res, 200, s[2] === 'friend-requests'
              ? await friendStore.getRequestsFor(actorId, limit, before)
              : await friendStore.getFriendPage(actorId, limit, before));
          } catch (error) {
            if (error instanceof InvalidFriendCursorError) return sendJson(res, 400, { error: 'invalid_cursor' });
            throw error;
          }
        }
        if (req.method === 'DELETE' && s[2] === 'friends' && s[3]) { await friendStore.removeFriend(actorId, decodeURIComponent(s[3])); return sendJson(res, 200, {}); }
        if (req.method === 'GET' && s[2] === 'hideouts') {
          const hideouts = await hideoutStore.getForRider(actorId);
          const participantIds = hideouts.flatMap((hideout) => hideout.participantIds);
          const allowedParticipantIds = new Set(await moderationStore.filterAllowedPeerIds(actorId, participantIds));
          return sendJson(res, 200, {
            hideouts: hideouts.map((hideout) => ({
              ...hideout,
              participantIds: hideout.participantIds.filter((participantId) =>
                participantId === actorId || allowedParticipantIds.has(participantId)),
            })),
          });
        }
      }
      if (req.method === 'GET' && url.pathname === '/friends/activity') {
        return sendJson(res, 200, { activity: await socialActivityStore.getFriendActivity(actorId) });
      }
      if (req.method === 'GET' && url.pathname === '/social/events') {
        const limit = Number(url.searchParams.get('limit') ?? 100);
        const waitMs = Number(url.searchParams.get('waitMs') ?? MAX_SOCIAL_EVENT_WAIT_MS);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return sendJson(res, 400, { error: 'limit must be an integer from 1 to 100' });
        if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_SOCIAL_EVENT_WAIT_MS) return sendJson(res, 400, { error: `waitMs must be an integer from 0 to ${MAX_SOCIAL_EVENT_WAIT_MS}` });
        const controller = new AbortController();
        const abortOnDisconnect = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', abortOnDisconnect);
        try {
          const page = await socialEventStore.waitForEvents(actorId, url.searchParams.get('after') ?? undefined, limit, waitMs, controller.signal);
          if (!res.destroyed) return sendJson(res, 200, page);
          return;
        } catch (error) {
          if (error instanceof InvalidSocialEventCursorError) return sendJson(res, 400, { error: 'invalid_cursor' });
          throw error;
        } finally {
          res.removeListener('close', abortOnDisconnect);
        }
      }
      if (req.method === 'POST' && url.pathname === '/friends/requests') {
        const body = await readJsonBody(req); if (typeof body.toRiderId !== 'string' || !body.toRiderId.trim()) return sendJson(res, 400, { error: 'toRiderId is required' });
        // A rider's handle (e.g. "@ali_rides") is what they'd actually
        // share with someone — their riderId is an internal identifier
        // nobody reads out loud. Resolve it to a riderId first so
        // everything downstream (self-check, block check, the request
        // itself) works exactly as it already does for a raw riderId.
        const target = body.toRiderId.trim().startsWith('@')
          ? await profileStore.findRiderIdByHandle(body.toRiderId.trim())
          : body.toRiderId;
        if (!target) return sendJson(res, 404, { error: 'rider_not_found' });
        if (actorId === target) return sendJson(res, 400, { error: 'cannot_friend_yourself' }); if (!(await authStore.hasRider(target))) return sendJson(res, 404, { error: 'rider_not_found' });
        if (await moderationStore.isBlockedBetween(actorId, target)) return sendJson(res, 403, { error: 'blocked' });
        if (!(await consumeSocialWrite(res, socialRateLimitStore, actorId, 'friend_request'))) return;
        const r = await friendStore.createRequest(actorId, target);
        return r.ok
          ? sendJson(res, 201, r.request)
          : sendJson(res, r.error === 'blocked' ? 403 : 409, { error: r.error });
      }
      if (req.method === 'DELETE' && s[0] === 'friends' && s[1] === 'requests' && s[2] && s.length === 3) {
        const r = await friendStore.cancelRequest(decodeURIComponent(s[2]), actorId);
        return r.ok ? sendJson(res, 200, {}) : sendJson(res, 404, { error: r.error });
      }
      if (req.method === 'POST' && s[0] === 'friends' && s[1] === 'requests' && s[2] && s[3]) {
        const request = await friendStore.getRequest(decodeURIComponent(s[2])); if (!request || request.toRiderId !== actorId) return sendJson(res, 404, { error: 'not_found' });
        if (await moderationStore.isBlockedBetween(request.fromRiderId, request.toRiderId)) return sendJson(res, 403, { error: 'blocked' });
        if (s[3] === 'accept') { const r = await friendStore.accept(request.id); return r.ok ? sendJson(res, 200, { friend: r.friend }) : sendJson(res, 404, { error: r.error }); }
        if (s[3] === 'decline') { const r = await friendStore.decline(request.id); return r.ok ? sendJson(res, 200, {}) : sendJson(res, 404, { error: r.error }); }
      }
      if (req.method === 'GET' && url.pathname === '/conversations') {
        const n = Number(url.searchParams.get('limit') ?? 50);
        if (!Number.isInteger(n) || n < 1 || n > 100) return sendJson(res, 400, { error: 'limit must be an integer from 1 to 100' });
        try {
          return sendJson(res, 200, await messageStore.getConversationPage(actorId, n, url.searchParams.get('before') ?? undefined));
        } catch (error) {
          if (error instanceof InvalidMessageCursorError) return sendJson(res, 400, { error: 'invalid_cursor' });
          throw error;
        }
      }
      if (req.method === 'GET' && url.pathname === '/messages/unread-count') {
        return sendJson(res, 200, { unreadCount: await messageStore.getUnreadCount(actorId) });
      }
      if (req.method === 'POST' && url.pathname === '/messages/read') {
        const body = await readJsonBody(req);
        if (typeof body.withRiderId !== 'string' || !body.withRiderId.trim()) return sendJson(res, 400, { error: 'withRiderId is required' });
        const other = body.withRiderId.trim();
        if (await moderationStore.isBlockedBetween(actorId, other)) return sendJson(res, 403, { error: 'blocked' });
        if (!(await friendStore.isFriendOf(actorId, other))) return sendJson(res, 403, { error: 'not_friends' });
        return sendJson(res, 200, { readThroughSeq: await messageStore.markThreadRead(actorId, other) });
      }
      if (req.method === 'POST' && url.pathname === '/messages') {
        const body = await readJsonBody(req); if (typeof body.toRiderId !== 'string' || typeof body.text !== 'string') return sendJson(res, 400, { error: 'toRiderId and text are required' }); const text = body.text.trim();
        if (!text || text.length > 1000) return sendJson(res, 400, { error: !text ? 'text must not be empty' : 'text must be at most 1000 characters' });
        if (await moderationStore.isBlockedBetween(actorId, body.toRiderId)) return sendJson(res, 403, { error: 'blocked' });
        if (!(await friendStore.isFriendOf(actorId, body.toRiderId))) return sendJson(res, 403, { error: 'not_friends' });
        if (!(await consumeSocialWrite(res, socialRateLimitStore, actorId, 'direct_message'))) return;
        return sendJson(res, 201, await messageStore.create(actorId, body.toRiderId, text));
      }
      if (req.method === 'GET' && url.pathname === '/messages') {
        const other = url.searchParams.get('withRiderId');
        if (!other) return sendJson(res, 400, { error: 'withRiderId is required' });
        if (await moderationStore.isBlockedBetween(actorId, other)) return sendJson(res, 403, { error: 'blocked' });
        if (!(await friendStore.isFriendOf(actorId, other))) return sendJson(res, 403, { error: 'not_friends' });
        const n = Number(url.searchParams.get('limit') ?? 100);
        if (!Number.isInteger(n) || n < 1 || n > 100) return sendJson(res, 400, { error: 'limit must be an integer from 1 to 100' });
        try {
          return sendJson(res, 200, await messageStore.getThreadPage(actorId, other, n, url.searchParams.get('before') ?? undefined));
        } catch (error) {
          if (error instanceof InvalidMessageCursorError) return sendJson(res, 400, { error: 'invalid_cursor' });
          throw error;
        }
      }
      if (req.method === 'POST' && url.pathname === '/hideouts') {
        const body = await readJsonBody(req), ids = body.participantIds; if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100 || !isCoordinate(body.lat, body.lon) || !Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) return sendJson(res, 400, { error: 'valid name, lat, lon, and participantIds are required' });
        const participants = [...new Set(ids as string[])].filter((id) => id !== actorId);
        for (const id of participants) { if (!(await friendStore.isFriendOf(actorId, id))) return sendJson(res, 403, { error: 'participants_must_be_friends' }); }
        return sendJson(res, 201, await hideoutStore.create({ name: body.name.trim(), lat: body.lat as number, lon: body.lon as number, createdBy: actorId, participantIds: participants }));
      }
      if (req.method === 'DELETE' && s[0] === 'hideouts' && s[1]) { const r = await hideoutStore.delete(decodeURIComponent(s[1]), actorId); return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.error === 'forbidden' ? 403 : 404, { error: r.error }); }
      if (req.method === 'POST' && url.pathname === '/directions') {
        const body = await readJsonBody(req);
        const origin = routeCoordinate(body.origin);
        const destination = routeCoordinate(body.destination);
        if (!origin || !destination) {
          return sendJson(res, 400, { error: 'valid origin and destination coordinates are required' });
        }
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'directions'))) return;
        try {
          return sendJson(res, 200, await directionsProvider(origin, destination));
        } catch (error) {
          if (!(error instanceof DirectionsProviderError)) throw error;
          if (error.code === 'directions_invalid_request') return sendJson(res, 400, { error: error.code });
          if (error.code === 'directions_no_route') return sendJson(res, 404, { error: error.code });
          if (error.code === 'directions_timeout') return sendJson(res, 504, { error: error.code });
          if (error.code === 'directions_not_configured') return sendJson(res, 503, { error: error.code });
          return sendJson(res, 502, { error: error.code });
        }
      }
      if (req.method === 'POST' && url.pathname === '/hazards') {
        if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'hazard_create'))) return;
        const body = await readJsonBody(req);
        if (typeof body.type !== 'string' || !HAZARD_TYPES.includes(body.type as HazardType)) return sendJson(res, 400, { error: 'valid type is required' });
        if (!isCoordinate(body.lat, body.lon)) return sendJson(res, 400, { error: 'valid lat and lon are required' });
        return sendJson(res, 201, await hazardStore.create(body.type as HazardType, body.lat as number, body.lon as number, actorId));
      }
      if (req.method === 'GET' && url.pathname === '/hazards/nearby') {
        const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
        if (!isCoordinate(lat, lon)) return sendJson(res, 400, { error: 'valid lat and lon are required' });
        return sendJson(res, 200, { hazards: await hazardStore.nearby(lat, lon, Date.now()) });
      }
      if (s[0] === 'hazards' && s[1] && s.length === 3 && (s[2] === 'confirm' || s[2] === 'deny')) {
        const id = decodeURIComponent(s[1]);
        const r = s[2] === 'confirm' ? await hazardStore.confirm(id, actorId) : await hazardStore.deny(id, actorId);
        return r.ok ? sendJson(res, 200, {}) : sendJson(res, 404, { error: r.reason });
      }
      if (req.method === 'DELETE' && s[0] === 'hazards' && s[1] && s.length === 2) {
        const id = decodeURIComponent(s[1]);
        const report = await hazardStore.get(id);
        if (!report) return sendJson(res, 404, { error: 'not_found' });
        if (report.reportedBy !== actorId) return sendJson(res, 403, { error: 'forbidden' });
        await hazardStore.remove(id, actorId);
        return sendJson(res, 200, {});
      }
      if (req.method === 'POST' && url.pathname === '/scenic-routes') {
        // Backend scenic-route records are curated product content, not an
        // open UGC publishing surface. ADMIN_RIDER_IDS bootstraps this durable
        // entitlement into users.is_admin; authorization is always re-read
        // from Postgres here rather than trusted from a client claim.
        if (!(await authStore.isAdmin(actorId))) return sendJson(res, 403, { error: 'admin_required' });
        const body = await readJsonBody(req);
        const validated = validateScenicRouteInput(body);
        if (!validated.ok) return sendJson(res, 400, { error: validated.error });
        return sendJson(res, 201, await scenicRouteStore.create(validated.value, actorId));
      }
      if (req.method === 'GET' && url.pathname === '/scenic-routes') {
        const vehicleCategoryParam = url.searchParams.get('vehicleCategory');
        const roadTypeParam = url.searchParams.get('roadType');
        const maxDifficultyParam = url.searchParams.get('maxDifficulty');
        if (vehicleCategoryParam && !VEHICLE_CATEGORIES.includes(vehicleCategoryParam as VehicleCategory)) return sendJson(res, 400, { error: 'invalid vehicleCategory filter' });
        if (roadTypeParam && !ROAD_TYPES.includes(roadTypeParam as RoadType)) return sendJson(res, 400, { error: 'invalid roadType filter' });
        if (maxDifficultyParam && !DIFFICULTIES.includes(maxDifficultyParam as Difficulty)) return sendJson(res, 400, { error: 'invalid maxDifficulty filter' });
        return sendJson(res, 200, { routes: await scenicRouteStore.list({
          vehicleCategory: vehicleCategoryParam as VehicleCategory | undefined,
          roadType: roadTypeParam as RoadType | undefined,
          maxDifficulty: maxDifficultyParam as Difficulty | undefined,
        }) });
      }
      if (req.method === 'GET' && s[0] === 'scenic-routes' && s[1] && s.length === 2) {
        const route = await scenicRouteStore.get(decodeURIComponent(s[1]));
        return route ? sendJson(res, 200, route) : sendJson(res, 404, { error: 'not_found' });
      }
      if (req.method === 'DELETE' && s[0] === 'scenic-routes' && s[1] && s.length === 2) {
        const id = decodeURIComponent(s[1]);
        const route = await scenicRouteStore.get(id);
        if (!route) return sendJson(res, 404, { error: 'not_found' });
        if (route.createdBy !== actorId) return sendJson(res, 403, { error: 'forbidden' });
        await scenicRouteStore.remove(id, actorId);
        return sendJson(res, 200, {});
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) { if (error instanceof RequestError) return sendJson(res, error.status, { error: error.message }); if (error instanceof URIError) return sendJson(res, 400, { error: 'invalid URL encoding' }); console.error('request failed', error); return sendJson(res, 500, { error: 'internal_error' }); }
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
  const initialCleanup = await productionAuthStore.cleanupExpiredRecords();
  const initialRateCleanup = await productionRateLimitStore.cleanupExpired();
  const initialSocialRateCleanup = await productionSocialRateLimitStore.cleanupExpired();
  const initialSocialActivityCleanup = await productionSocialActivityStore.cleanupExpired();
  const initialSocialEventCleanup = await productionSocialEventStore.cleanupExpired();
  console.log(JSON.stringify({ level: 'info', event: 'auth_records_cleaned', ...initialCleanup }));
  console.log(JSON.stringify({ level: 'info', event: 'rate_limit_events_cleaned', deleted: initialRateCleanup }));
  console.log(JSON.stringify({ level: 'info', event: 'social_rate_events_cleaned', deleted: initialSocialRateCleanup }));
  console.log(JSON.stringify({ level: 'info', event: 'social_activity_cleaned', deleted: initialSocialActivityCleanup }));
  console.log(JSON.stringify({ level: 'info', event: 'social_events_cleaned', deleted: initialSocialEventCleanup }));
  const app = createApp(undefined, undefined, undefined, undefined, undefined, undefined, productionAuthStore, undefined, undefined, undefined, {
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

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    clearInterval(authCleanupTimer);
    clearInterval(rateLimitCleanupTimer);
    clearInterval(socialRateCleanupTimer);
    clearInterval(socialStateCleanupTimer);
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
