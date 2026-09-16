import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { SlidingWindowRateLimiter, TIER_RADIUS_MILES, validateScenicRouteInput, bucketId, getBucketCoord } from '@rider-comms/shared';
import type { Difficulty, HazardType, RoadType, Rider, VehicleCategory } from '@rider-comms/shared';
import { getLiveKitCredentialsFromEnv, mintVoiceToken, rideRoomName, channelRoomName } from './liveKitToken.ts';
import type { LiveKitCredentials } from './liveKitToken.ts';
import { AuthStore } from './authStore.ts';
import { RideStore } from './rideStore.ts';
import { PresenceStore } from './presenceStore.ts';
import { ProfileStore } from './profileStore.ts';
import { FriendStore } from './friendStore.ts';
import { MessageStore } from './messageStore.ts';
import { HideoutStore } from './hideoutStore.ts';
import { ModerationStore, REPORT_REASONS } from './moderationStore.ts';
import type { ReportReason } from './moderationStore.ts';
import { HazardStore } from './hazardStore.ts';
import { ScenicRouteStore } from './scenicRouteStore.ts';

const HAZARD_TYPES = ['police', 'accident', 'hazard', 'road_closure', 'camera'] as const;
const VEHICLE_CATEGORIES = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'] as const;
const ROAD_TYPES = ['rural', 'mountain', 'coastal', 'urban', 'mixed'] as const;
const DIFFICULTIES = ['easy', 'moderate', 'challenging'] as const;

const MAX_BODY_BYTES = 32 * 1024;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export interface ApiServerOptions {
  allowedOrigins?: readonly string[];
  trustProxy?: boolean;
  logger?: (event: ApiRequestLog) => void;
  /** Defaults to reading LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL from
   * the environment; pass null explicitly (e.g. in tests) to force the
   * "voice not configured" path regardless of the real environment. */
  liveKitCredentials?: LiveKitCredentials | null;
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
function rideBody(ride: { id: string; createdBy: string; createdAt: number; memberIds: Set<string> }) { return { rideId: ride.id, createdBy: ride.createdBy, createdAt: ride.createdAt, memberIds: [...ride.memberIds] }; }
async function publicProfile(profileStore: ProfileStore, friendStore: FriendStore, actorId: string, targetId: string) {
  const profile = await profileStore.getOrCreate(targetId);
  const isFriend = actorId === targetId ? false : await friendStore.isFriendOf(actorId, targetId);
  const canSee = (visibility: 'public' | 'friends' | 'private') => visibility === 'public' || (visibility === 'friends' && isFriend) || actorId === targetId;
  return { riderId: profile.riderId, displayName: profile.displayName, handle: profile.handle, avatarId: profile.avatarId, instagramUsername: canSee(profile.instagramVisibility) ? profile.instagramUsername : '', tiktokUsername: canSee(profile.tiktokVisibility) ? profile.tiktokUsername : '' };
}

export function createApp(rideStore = new RideStore(), presenceStore = new PresenceStore(), profileStore = new ProfileStore(), friendStore = new FriendStore(profileStore), messageStore = new MessageStore(), hideoutStore = new HideoutStore(), authStore = new AuthStore(), moderationStore = new ModerationStore(), hazardStore = new HazardStore(), scenicRouteStore = new ScenicRouteStore(), options: ApiServerOptions = {}): http.Server {
  const guestLimiter = new SlidingWindowRateLimiter(20, 60_000);
  const apiLimiter = new SlidingWindowRateLimiter(300, 60_000);
  const hazardCreateLimiter = new SlidingWindowRateLimiter(10, 10 * 60_000);
  // Resending a verification email is an authenticated rider spamming
  // themselves (or, if their account is compromised, someone else) with
  // outbound Resend sends — keep it well below Resend's own limits and
  // far below apiLimiter's general 300/min so it can't become a way to
  // rack up email-sending cost/abuse.
  const resendVerificationLimiter = new SlidingWindowRateLimiter(3, 10 * 60_000);
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const liveKitCredentials = 'liveKitCredentials' in options ? options.liveKitCredentials : getLiveKitCredentialsFromEnv();
  return http.createServer(async (req, res) => {
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
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/ready')) return sendJson(res, 200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/config') {
        return sendJson(res, 200, { googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '' });
      }
      if (req.method === 'POST' && url.pathname === '/auth/guest') {
        if (!guestLimiter.tryConsume(address)) return sendJson(res, 429, { error: 'rate_limited' });
        const session = authStore.createGuest(); await profileStore.getOrCreate(session.riderId); return sendJson(res, 201, session);
      }
      if (req.method === 'POST' && url.pathname === '/auth/signup') {
        if (!guestLimiter.tryConsume(address)) return sendJson(res, 429, { error: 'rate_limited' });
        const body = await readJsonBody(req);
        const result = await authStore.signUp(body.username, body.email, body.password);
        if ('error' in result) return sendJson(res, result.error === 'username_taken' || result.error === 'email_taken' ? 409 : 400, { error: result.error });
        await profileStore.getOrCreate(result.riderId);
        return sendJson(res, 201, result);
      }
      if (req.method === 'POST' && url.pathname === '/auth/login') {
        if (!guestLimiter.tryConsume(address)) return sendJson(res, 429, { error: 'rate_limited' });
        const body = await readJsonBody(req);
        const result = await authStore.logIn(body.username, body.password);
        if ('error' in result) return sendJson(res, 401, { error: result.error });
        await profileStore.getOrCreate(result.riderId);
        return sendJson(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/auth/verify-email') {
        if (!guestLimiter.tryConsume(address)) return sendJson(res, 429, { error: 'rate_limited' });
        const body = await readJsonBody(req);
        const result = await authStore.verifyEmail(body.token);
        if ('error' in result) return sendJson(res, result.error === 'invalid_token' ? 400 : 410, { error: result.error });
        return sendJson(res, 200, result);
      }
      const actorId = await authRider(req, res, authStore); if (!actorId) return;
      if (!apiLimiter.tryConsume(actorId)) return sendJson(res, 429, { error: 'rate_limited' });
      if (req.method === 'GET' && url.pathname === '/auth/me') return sendJson(res, 200, { riderId: actorId });
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        await authStore.revokeToken(bearerToken(req));
        return sendEmpty(res, 204);
      }
      if (req.method === 'POST' && url.pathname === '/auth/resend-verification') {
        if (!resendVerificationLimiter.tryConsume(actorId)) { res.setHeader('Retry-After', '600'); return sendJson(res, 429, { error: 'rate_limited' }); }
        const result = await authStore.resendVerification(actorId);
        if ('error' in result) return sendJson(res, result.error === 'not_found' ? 404 : 409, { error: result.error });
        return sendJson(res, 200, result);
      }
      if (req.method === 'DELETE' && url.pathname === '/auth/me') {
        await presenceStore.removeRider(actorId);
        await rideStore.deleteRider(actorId);
        await friendStore.deleteRider(actorId);
        await messageStore.deleteRider(actorId);
        await hideoutStore.deleteRider(actorId);
        await profileStore.delete(actorId);
        await moderationStore.deleteRider(actorId);
        await hazardStore.deleteRider(actorId);
        await scenicRouteStore.deleteRider(actorId);
        await authStore.deleteRider(actorId);
        return sendJson(res, 200, {});
      }
      if (req.method === 'POST' && url.pathname === '/rides') { const { ride, codeRecord } = await rideStore.createRide(actorId); return sendJson(res, 201, { ...rideBody(ride), code: codeRecord.code, expiresAt: codeRecord.expiresAt }); }
      if (req.method === 'POST' && url.pathname === '/rides/join') {
        const body = await readJsonBody(req);
        if (typeof body.code !== 'string' || !/^[A-Z2-9]{6}$/i.test(body.code)) return sendJson(res, 400, { error: 'a valid 6-character code is required' });
        const result = await rideStore.joinRide(body.code, actorId, address);
        if (!result.ok) {
          if (result.reason === 'rate_limited') res.setHeader('Retry-After', '60');
          const status = result.reason === 'rate_limited' ? 429 : result.reason === 'ride_full' ? 409 : 404;
          return sendJson(res, status, { error: result.reason });
        }
        return sendJson(res, 200, { rideId: result.rideId });
      }
      if (req.method === 'POST' && url.pathname === '/presence') {
        const body = await readJsonBody(req); if (!isCoordinate(body.lat, body.lon)) return sendJson(res, 400, { error: 'valid lat and lon are required' });
        const profile = await profileStore.getOrCreate(actorId); if (!profile.shareLocation) { await presenceStore.removeRider(actorId); return sendJson(res, 403, { error: 'location_sharing_disabled' }); }
        const rider: Rider = { id: actorId, location: { lat: body.lat as number, lon: body.lon as number }, radiusMiles: TIER_RADIUS_MILES[profile.zoneTier], updatedAt: Date.now() };
        const { transitions, zonePairs } = await presenceStore.updatePresence(rider);
        return sendJson(res, 200, { inZoneWith: presenceStore.ridersInZoneWith(actorId, zonePairs), transitions: transitions.filter((t) => t.a === actorId || t.b === actorId), radiusMiles: rider.radiusMiles });
      }
      if (req.method === 'DELETE' && url.pathname === '/presence') { await presenceStore.removeRider(actorId); return sendJson(res, 200, {}); }
      if (req.method === 'POST' && url.pathname === '/voice/token') {
        if (!liveKitCredentials) return sendJson(res, 503, { error: 'voice_not_configured' });
        const body = await readJsonBody(req);
        if (body.target === 'ride') {
          if (typeof body.rideId !== 'string') return sendJson(res, 400, { error: 'rideId is required' });
          const result = await rideStore.getRideForMember(body.rideId, actorId);
          if (!result.ok) return sendJson(res, result.reason === 'not_found' ? 404 : 403, { error: result.reason });
          const voiceToken = await mintVoiceToken(liveKitCredentials, actorId, rideRoomName(result.ride.id));
          return sendJson(res, 200, voiceToken);
        }
        if (body.target === 'channel') {
          // The room is derived from the rider's OWN last-known presence
          // location, never a client-supplied bucket — otherwise anyone
          // could request a token for an arbitrary public channel room
          // regardless of where they actually are.
          const rider = await presenceStore.getRider(actorId);
          if (!rider) return sendJson(res, 403, { error: 'location_sharing_disabled' });
          const voiceToken = await mintVoiceToken(liveKitCredentials, actorId, channelRoomName(bucketId(getBucketCoord(rider.location))));
          return sendJson(res, 200, voiceToken);
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
        await moderationStore.block(actorId, body.riderId);
        await friendStore.removeFriend(actorId, body.riderId);
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
        await moderationStore.report(actorId, body.riderId, body.reason as ReportReason, details);
        return sendJson(res, 201, { received: true });
      }
      if (req.method === 'GET' && s[0] === 'profiles' && s[1] && s.length === 2) {
        const targetId = decodeURIComponent(s[1]);
        if (!(await authStore.hasRider(targetId))) return sendJson(res, 404, { error: 'rider_not_found' });
        if (await moderationStore.isBlockedBetween(actorId, targetId)) return sendJson(res, 403, { error: 'blocked' });
        return sendJson(res, 200, await publicProfile(profileStore, friendStore, actorId, targetId));
      }
      if (s[0] === 'rides' && s[1]) {
        const id = decodeURIComponent(s[1]);
        if (req.method === 'GET' && s.length === 2) { const r = await rideStore.getRideForMember(id, actorId); return r.ok ? sendJson(res, 200, rideBody(r.ride)) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason }); }
        if (req.method === 'POST' && s[2] === 'leave') { const r = await rideStore.leaveRide(id, actorId); return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason }); }
        if (req.method === 'DELETE' && s.length === 2) { const r = await rideStore.endRide(id, actorId); return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason }); }
        if (req.method === 'DELETE' && s[2] === 'members' && s[3]) { const r = await rideStore.removeMember(id, actorId, decodeURIComponent(s[3])); return r.ok ? sendJson(res, 200, rideBody(r.ride)) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason }); }
        if (req.method === 'POST' && s[2] === 'location') {
          const body = await readJsonBody(req); if (!isCoordinate(body.lat, body.lon)) return sendJson(res, 400, { error: 'valid lat and lon are required' });
          const r = await rideStore.updateMemberLocation(id, actorId, body.lat as number, body.lon as number);
          return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason });
        }
        if (req.method === 'GET' && s[2] === 'locations') {
          const r = await rideStore.getMemberLocations(id, actorId);
          return r.ok ? sendJson(res, 200, { locations: r.locations }) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason });
        }
      }
      if (s[0] === 'riders' && s[2]) {
        if (decodeURIComponent(s[1]) !== actorId) return sendJson(res, 403, { error: 'forbidden' });
        if (s[2] === 'profile') {
          if (req.method === 'GET') return sendJson(res, 200, await profileStore.getOrCreate(actorId));
          if (req.method === 'PUT') { const body = await readJsonBody(req); if ('zoneTier' in body) return sendJson(res, 403, { error: 'zone_tier_managed_by_billing' }); const r = await profileStore.update(actorId, body); if (r.ok && body.shareLocation === false) await presenceStore.removeRider(actorId); return r.ok ? sendJson(res, 200, r.profile) : sendJson(res, 400, { error: r.error }); }
        }
        if (req.method === 'GET' && s[2] === 'friend-requests') return sendJson(res, 200, await friendStore.getRequestsFor(actorId));
        if (req.method === 'GET' && s[2] === 'friends' && s.length === 3) return sendJson(res, 200, { friends: await friendStore.getFriends(actorId) });
        if (req.method === 'DELETE' && s[2] === 'friends' && s[3]) { await friendStore.removeFriend(actorId, decodeURIComponent(s[3])); return sendJson(res, 200, {}); }
        if (req.method === 'GET' && s[2] === 'hideouts') return sendJson(res, 200, { hideouts: await hideoutStore.getForRider(actorId) });
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
        const r = await friendStore.createRequest(actorId, target); return r.ok ? sendJson(res, 201, r.request) : sendJson(res, 409, { error: r.error });
      }
      if (req.method === 'POST' && s[0] === 'friends' && s[1] === 'requests' && s[2] && s[3]) {
        const request = await friendStore.getRequest(decodeURIComponent(s[2])); if (!request || request.toRiderId !== actorId) return sendJson(res, 404, { error: 'not_found' });
        if (await moderationStore.isBlockedBetween(request.fromRiderId, request.toRiderId)) return sendJson(res, 403, { error: 'blocked' });
        if (s[3] === 'accept') { const r = await friendStore.accept(request.id); return r.ok ? sendJson(res, 200, { friend: r.friend }) : sendJson(res, 404, { error: r.error }); }
        if (s[3] === 'decline') { const r = await friendStore.decline(request.id); return r.ok ? sendJson(res, 200, {}) : sendJson(res, 404, { error: r.error }); }
      }
      if (req.method === 'POST' && url.pathname === '/messages') {
        const body = await readJsonBody(req); if (typeof body.toRiderId !== 'string' || typeof body.text !== 'string') return sendJson(res, 400, { error: 'toRiderId and text are required' }); const text = body.text.trim();
        if (!text || text.length > 1000) return sendJson(res, 400, { error: !text ? 'text must not be empty' : 'text must be at most 1000 characters' }); if (await moderationStore.isBlockedBetween(actorId, body.toRiderId)) return sendJson(res, 403, { error: 'blocked' }); if (!(await friendStore.isFriendOf(actorId, body.toRiderId))) return sendJson(res, 403, { error: 'not_friends' }); return sendJson(res, 201, await messageStore.create(actorId, body.toRiderId, text));
      }
      if (req.method === 'GET' && url.pathname === '/messages') { const other = url.searchParams.get('withRiderId'); if (!other) return sendJson(res, 400, { error: 'withRiderId is required' }); if (await moderationStore.isBlockedBetween(actorId, other)) return sendJson(res, 403, { error: 'blocked' }); const n = Number(url.searchParams.get('limit') ?? 100); return sendJson(res, 200, { messages: await messageStore.getThread(actorId, other, Number.isInteger(n) ? Math.min(Math.max(n, 1), 100) : 100) }); }
      if (req.method === 'POST' && url.pathname === '/hideouts') {
        const body = await readJsonBody(req), ids = body.participantIds; if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100 || !isCoordinate(body.lat, body.lon) || !Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) return sendJson(res, 400, { error: 'valid name, lat, lon, and participantIds are required' });
        const participants = [...new Set(ids as string[])].filter((id) => id !== actorId);
        for (const id of participants) { if (!(await friendStore.isFriendOf(actorId, id))) return sendJson(res, 403, { error: 'participants_must_be_friends' }); }
        return sendJson(res, 201, await hideoutStore.create({ name: body.name.trim(), lat: body.lat as number, lon: body.lon as number, createdBy: actorId, participantIds: participants }));
      }
      if (req.method === 'DELETE' && s[0] === 'hideouts' && s[1]) { const r = await hideoutStore.delete(decodeURIComponent(s[1]), actorId); return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.error === 'forbidden' ? 403 : 404, { error: r.error }); }
      if (req.method === 'POST' && url.pathname === '/hazards') {
        if (!hazardCreateLimiter.tryConsume(actorId)) { res.setHeader('Retry-After', '60'); return sendJson(res, 429, { error: 'rate_limited' }); }
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
      // TODO(curation-policy): once the product team defines a real curation/
      // moderation workflow for scenic routes, gate creation behind it. For
      // now any authenticated rider can create one, matching the access
      // level ride creation already uses elsewhere in this file.
      if (req.method === 'POST' && url.pathname === '/scenic-routes') {
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
}
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be an integer from 1 to 65535');
  const host = process.env.HOST?.trim() || '0.0.0.0';
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  const app = createApp(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
    allowedOrigins,
    trustProxy: process.env.TRUST_PROXY === 'true',
    logger: (event) => console.log(JSON.stringify({ level: 'info', event: 'http_request', ...event })),
  });
  app.requestTimeout = 15_000;
  app.headersTimeout = 10_000;
  app.keepAliveTimeout = 5_000;
  app.maxRequestsPerSocket = 1_000;

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
    const forceExit = setTimeout(() => {
      console.error(JSON.stringify({ level: 'error', event: 'shutdown_timeout', signal }));
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    app.close((error) => {
      clearTimeout(forceExit);
      if (error) {
        console.error(JSON.stringify({ level: 'error', event: 'shutdown_failed', message: error.message }));
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  app.listen(port, host, () => console.log(JSON.stringify({ level: 'info', event: 'server_started', host, port, allowedOrigins })));
}
