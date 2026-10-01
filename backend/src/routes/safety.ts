import { REPORT_REASONS } from '../moderationStore.ts';
import type { ReportReason } from '../moderationStore.ts';
import { consumeSocialWrite, readJsonBody, sendJson } from '../serverHttp.ts';
import { NOT_HANDLED } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleSafetyRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, rideStore, authStore, moderationStore, socialRateLimitStore, revokeRideVoiceParticipants, revokeProximityVoiceParticipants } = ctx;
  if (req.method === 'GET' && url.pathname === '/blocks') {
    const blocked = await moderationStore.getBlockedSummaries(actorId);
    return sendJson(res, 200, { blockedRiderIds: blocked.map((rider) => rider.riderId), blocked });
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
  return NOT_HANDLED;
}
