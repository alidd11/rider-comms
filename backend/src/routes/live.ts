import { RIDE_VOICE_TOKEN_TTL_SECONDS, mintVoiceToken, proximityRoomName, rideRoomName } from '../liveKitToken.ts';
import { PresenceStore, StaleLocationFixError } from '../presenceStore.ts';
import { consumeRateLimit, isCoordinate, rateLimitSubject, readJsonBody, sendJson } from '../serverHttp.ts';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';
import type { Rider } from '@rider-comms/shared';
import { MAX_PRESENCE_ACCURACY_METERS, MAX_PRESENCE_FIX_AGE_MS, MAX_PRESENCE_FUTURE_SKEW_MS, NOT_HANDLED, PROXIMITY_VOICE_AUTHORIZATION_LEASE_MS, PROXIMITY_VOICE_REFRESH_MS, PROXIMITY_VOICE_TOKEN_TTL_SECONDS, rideBody } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleLiveRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, address, actorId, rideStore, presenceStore, profileStore, moderationStore, rateLimitStore, liveKitCredentials } = ctx;
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
  return NOT_HANDLED;
}
