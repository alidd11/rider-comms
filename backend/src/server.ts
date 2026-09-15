import http from 'node:http';
import { SlidingWindowRateLimiter, TIER_RADIUS_MILES } from '@rider-comms/shared';
import type { Rider } from '@rider-comms/shared';
import { AuthStore } from './authStore.ts';
import { RideStore } from './rideStore.ts';
import { PresenceStore } from './presenceStore.ts';
import { ProfileStore } from './profileStore.ts';
import { FriendStore } from './friendStore.ts';
import { MessageStore } from './messageStore.ts';
import { HideoutStore } from './hideoutStore.ts';
import { ModerationStore, REPORT_REASONS } from './moderationStore.ts';
import type { ReportReason } from './moderationStore.ts';

const MAX_BODY_BYTES = 32 * 1024;
class RequestError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(payload);
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
function authRider(req: http.IncomingMessage, res: http.ServerResponse, auth: AuthStore): string | undefined {
  const header = req.headers.authorization;
  const riderId = auth.riderForToken(header?.startsWith('Bearer ') ? header.slice(7).trim() : '');
  if (!riderId) sendJson(res, 401, { error: 'unauthorized' });
  return riderId;
}
function isCoordinate(lat: unknown, lon: unknown): boolean { return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 && typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180; }
function rideBody(ride: { id: string; createdBy: string; createdAt: number; memberIds: Set<string> }) { return { rideId: ride.id, createdBy: ride.createdBy, createdAt: ride.createdAt, memberIds: [...ride.memberIds] }; }
function publicProfile(profileStore: ProfileStore, friendStore: FriendStore, actorId: string, targetId: string) {
  const profile = profileStore.getOrCreate(targetId);
  const canSee = (visibility: 'public' | 'friends' | 'private') => visibility === 'public' || (visibility === 'friends' && friendStore.isFriendOf(actorId, targetId)) || actorId === targetId;
  return { riderId: profile.riderId, displayName: profile.displayName, handle: profile.handle, avatarId: profile.avatarId, instagramUsername: canSee(profile.instagramVisibility) ? profile.instagramUsername : '', tiktokUsername: canSee(profile.tiktokVisibility) ? profile.tiktokUsername : '' };
}

export function createApp(rideStore = new RideStore(), presenceStore = new PresenceStore(), profileStore = new ProfileStore(), friendStore = new FriendStore(profileStore), messageStore = new MessageStore(), hideoutStore = new HideoutStore(), authStore = new AuthStore(), moderationStore = new ModerationStore()): http.Server {
  const guestLimiter = new SlidingWindowRateLimiter(20, 60_000);
  const apiLimiter = new SlidingWindowRateLimiter(300, 60_000);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true });
      if (req.method === 'POST' && url.pathname === '/auth/guest') {
        if (!guestLimiter.tryConsume(req.socket.remoteAddress ?? 'unknown')) return sendJson(res, 429, { error: 'rate_limited' });
        const session = authStore.createGuest(); profileStore.getOrCreate(session.riderId); return sendJson(res, 201, session);
      }
      const actorId = authRider(req, res, authStore); if (!actorId) return;
      if (!apiLimiter.tryConsume(actorId)) return sendJson(res, 429, { error: 'rate_limited' });
      if (req.method === 'GET' && url.pathname === '/auth/me') return sendJson(res, 200, { riderId: actorId });
      if (req.method === 'DELETE' && url.pathname === '/auth/me') {
        presenceStore.removeRider(actorId);
        rideStore.deleteRider(actorId);
        friendStore.deleteRider(actorId);
        messageStore.deleteRider(actorId);
        hideoutStore.deleteRider(actorId);
        profileStore.delete(actorId);
        moderationStore.deleteRider(actorId);
        authStore.deleteRider(actorId);
        return sendJson(res, 200, {});
      }
      if (req.method === 'POST' && url.pathname === '/rides') { const { ride, codeRecord } = rideStore.createRide(actorId); return sendJson(res, 201, { ...rideBody(ride), code: codeRecord.code, expiresAt: codeRecord.expiresAt }); }
      if (req.method === 'POST' && url.pathname === '/rides/join') {
        const body = await readJsonBody(req);
        if (typeof body.code !== 'string' || !/^[A-Z2-9]{6}$/i.test(body.code)) return sendJson(res, 400, { error: 'a valid 6-character code is required' });
        const result = rideStore.joinRide(body.code, actorId, req.socket.remoteAddress ?? 'unknown');
        if (!result.ok) { if (result.reason === 'rate_limited') res.setHeader('Retry-After', '60'); return sendJson(res, result.reason === 'rate_limited' ? 429 : 404, { error: result.reason }); }
        return sendJson(res, 200, { rideId: result.rideId });
      }
      if (req.method === 'POST' && url.pathname === '/presence') {
        const body = await readJsonBody(req); if (!isCoordinate(body.lat, body.lon)) return sendJson(res, 400, { error: 'valid lat and lon are required' });
        const profile = profileStore.getOrCreate(actorId); if (!profile.shareLocation) { presenceStore.removeRider(actorId); return sendJson(res, 403, { error: 'location_sharing_disabled' }); }
        const rider: Rider = { id: actorId, location: { lat: body.lat as number, lon: body.lon as number }, radiusMiles: TIER_RADIUS_MILES[profile.zoneTier], updatedAt: Date.now() };
        const { transitions, zonePairs } = presenceStore.updatePresence(rider);
        return sendJson(res, 200, { inZoneWith: presenceStore.ridersInZoneWith(actorId, zonePairs), transitions: transitions.filter((t) => t.a === actorId || t.b === actorId), radiusMiles: rider.radiusMiles });
      }
      if (req.method === 'DELETE' && url.pathname === '/presence') { presenceStore.removeRider(actorId); return sendJson(res, 200, {}); }
      const s = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && url.pathname === '/blocks') {
        return sendJson(res, 200, { blockedRiderIds: moderationStore.getBlocked(actorId) });
      }
      if (req.method === 'POST' && url.pathname === '/blocks') {
        const body = await readJsonBody(req);
        if (typeof body.riderId !== 'string' || body.riderId === actorId) return sendJson(res, 400, { error: 'valid riderId is required' });
        if (!authStore.hasRider(body.riderId)) return sendJson(res, 404, { error: 'rider_not_found' });
        moderationStore.block(actorId, body.riderId);
        friendStore.removeFriend(actorId, body.riderId);
        return sendJson(res, 200, {});
      }
      if (req.method === 'DELETE' && s[0] === 'blocks' && s[1] && s.length === 2) {
        moderationStore.unblock(actorId, decodeURIComponent(s[1]));
        return sendJson(res, 200, {});
      }
      if (req.method === 'POST' && url.pathname === '/reports') {
        const body = await readJsonBody(req);
        if (typeof body.riderId !== 'string' || body.riderId === actorId || !authStore.hasRider(body.riderId)) return sendJson(res, 400, { error: 'valid riderId is required' });
        if (typeof body.reason !== 'string' || !REPORT_REASONS.includes(body.reason as ReportReason)) return sendJson(res, 400, { error: 'invalid report reason' });
        const details = typeof body.details === 'string' ? body.details.trim() : '';
        if (details.length > 1000) return sendJson(res, 400, { error: 'details must be at most 1000 characters' });
        moderationStore.report(actorId, body.riderId, body.reason as ReportReason, details);
        return sendJson(res, 201, { received: true });
      }
      if (req.method === 'GET' && s[0] === 'profiles' && s[1] && s.length === 2) {
        const targetId = decodeURIComponent(s[1]);
        if (!authStore.hasRider(targetId)) return sendJson(res, 404, { error: 'rider_not_found' });
        if (moderationStore.isBlockedBetween(actorId, targetId)) return sendJson(res, 403, { error: 'blocked' });
        return sendJson(res, 200, publicProfile(profileStore, friendStore, actorId, targetId));
      }
      if (s[0] === 'rides' && s[1]) {
        const id = decodeURIComponent(s[1]);
        if (req.method === 'GET' && s.length === 2) { const r = rideStore.getRideForMember(id, actorId); return r.ok ? sendJson(res, 200, rideBody(r.ride)) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason }); }
        if (req.method === 'POST' && s[2] === 'leave') { const r = rideStore.leaveRide(id, actorId); return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason }); }
        if (req.method === 'DELETE' && s.length === 2) { const r = rideStore.endRide(id, actorId); return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason }); }
        if (req.method === 'DELETE' && s[2] === 'members' && s[3]) { const r = rideStore.removeMember(id, actorId, decodeURIComponent(s[3])); return r.ok ? sendJson(res, 200, rideBody(r.ride)) : sendJson(res, r.reason === 'not_found' ? 404 : 403, { error: r.reason }); }
      }
      if (s[0] === 'riders' && s[2]) {
        if (decodeURIComponent(s[1]) !== actorId) return sendJson(res, 403, { error: 'forbidden' });
        if (s[2] === 'profile') {
          if (req.method === 'GET') return sendJson(res, 200, profileStore.getOrCreate(actorId));
          if (req.method === 'PUT') { const body = await readJsonBody(req); if ('zoneTier' in body) return sendJson(res, 403, { error: 'zone_tier_managed_by_billing' }); const r = profileStore.update(actorId, body); if (r.ok && body.shareLocation === false) presenceStore.removeRider(actorId); return r.ok ? sendJson(res, 200, r.profile) : sendJson(res, 400, { error: r.error }); }
        }
        if (req.method === 'GET' && s[2] === 'friend-requests') return sendJson(res, 200, friendStore.getRequestsFor(actorId));
        if (req.method === 'GET' && s[2] === 'friends' && s.length === 3) return sendJson(res, 200, { friends: friendStore.getFriends(actorId) });
        if (req.method === 'DELETE' && s[2] === 'friends' && s[3]) { friendStore.removeFriend(actorId, decodeURIComponent(s[3])); return sendJson(res, 200, {}); }
        if (req.method === 'GET' && s[2] === 'hideouts') return sendJson(res, 200, { hideouts: hideoutStore.getForRider(actorId) });
      }
      if (req.method === 'POST' && url.pathname === '/friends/requests') {
        const body = await readJsonBody(req); if (typeof body.toRiderId !== 'string' || !body.toRiderId.trim()) return sendJson(res, 400, { error: 'toRiderId is required' });
        if (actorId === body.toRiderId) return sendJson(res, 400, { error: 'cannot_friend_yourself' }); if (!authStore.hasRider(body.toRiderId)) return sendJson(res, 404, { error: 'rider_not_found' });
        if (moderationStore.isBlockedBetween(actorId, body.toRiderId)) return sendJson(res, 403, { error: 'blocked' });
        const r = friendStore.createRequest(actorId, body.toRiderId); return r.ok ? sendJson(res, 201, r.request) : sendJson(res, 409, { error: r.error });
      }
      if (req.method === 'POST' && s[0] === 'friends' && s[1] === 'requests' && s[2] && s[3]) {
        const request = friendStore.getRequest(decodeURIComponent(s[2])); if (!request || request.toRiderId !== actorId) return sendJson(res, 404, { error: 'not_found' });
        if (moderationStore.isBlockedBetween(request.fromRiderId, request.toRiderId)) return sendJson(res, 403, { error: 'blocked' });
        if (s[3] === 'accept') { const r = friendStore.accept(request.id); return r.ok ? sendJson(res, 200, { friend: r.friend }) : sendJson(res, 404, { error: r.error }); }
        if (s[3] === 'decline') { const r = friendStore.decline(request.id); return r.ok ? sendJson(res, 200, {}) : sendJson(res, 404, { error: r.error }); }
      }
      if (req.method === 'POST' && url.pathname === '/messages') {
        const body = await readJsonBody(req); if (typeof body.toRiderId !== 'string' || typeof body.text !== 'string') return sendJson(res, 400, { error: 'toRiderId and text are required' }); const text = body.text.trim();
        if (!text || text.length > 1000) return sendJson(res, 400, { error: !text ? 'text must not be empty' : 'text must be at most 1000 characters' }); if (moderationStore.isBlockedBetween(actorId, body.toRiderId)) return sendJson(res, 403, { error: 'blocked' }); if (!friendStore.isFriendOf(actorId, body.toRiderId)) return sendJson(res, 403, { error: 'not_friends' }); return sendJson(res, 201, messageStore.create(actorId, body.toRiderId, text));
      }
      if (req.method === 'GET' && url.pathname === '/messages') { const other = url.searchParams.get('withRiderId'); if (!other) return sendJson(res, 400, { error: 'withRiderId is required' }); if (moderationStore.isBlockedBetween(actorId, other)) return sendJson(res, 403, { error: 'blocked' }); const n = Number(url.searchParams.get('limit') ?? 100); return sendJson(res, 200, { messages: messageStore.getThread(actorId, other, Number.isInteger(n) ? Math.min(Math.max(n, 1), 100) : 100) }); }
      if (req.method === 'POST' && url.pathname === '/hideouts') {
        const body = await readJsonBody(req), ids = body.participantIds; if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100 || !isCoordinate(body.lat, body.lon) || !Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) return sendJson(res, 400, { error: 'valid name, lat, lon, and participantIds are required' });
        const participants = [...new Set(ids as string[])].filter((id) => id !== actorId); if (participants.some((id) => !friendStore.isFriendOf(actorId, id))) return sendJson(res, 403, { error: 'participants_must_be_friends' }); return sendJson(res, 201, hideoutStore.create({ name: body.name.trim(), lat: body.lat as number, lon: body.lon as number, createdBy: actorId, participantIds: participants }));
      }
      if (req.method === 'DELETE' && s[0] === 'hideouts' && s[1]) { const r = hideoutStore.delete(decodeURIComponent(s[1]), actorId); return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.error === 'forbidden' ? 403 : 404, { error: r.error }); }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) { if (error instanceof RequestError) return sendJson(res, error.status, { error: error.message }); if (error instanceof URIError) return sendJson(res, 400, { error: 'invalid URL encoding' }); console.error('request failed', error); return sendJson(res, 500, { error: 'internal_error' }); }
  });
}
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) { const port = Number(process.env.PORT ?? 4000); const app = createApp(); app.requestTimeout = 15_000; app.headersTimeout = 10_000; app.listen(port, () => console.log(`rider-comms backend listening on :${port}`)); }
