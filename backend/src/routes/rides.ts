import { isCoordinate, readJsonBody, sendJson } from '../serverHttp.ts';
import { NOT_HANDLED, rideBody } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleRideRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, rideStore, revokeRideVoiceParticipants, visibleRideLocationsFor } = ctx;
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
  return NOT_HANDLED;
}
