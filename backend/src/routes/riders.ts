import { InvalidFriendCursorError } from '../friendStore.ts';
import { OBJECTIONABLE_CONTENT } from '../profileStore.ts';
import { readJsonBody, sendJson } from '../serverHttp.ts';
import { countFilterRejection, NOT_HANDLED } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleRiderRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, presenceStore, profileStore, friendStore, hideoutStore, moderationStore, adminStatsStore } = ctx;
  if (s[0] === 'riders' && s[2]) {
    if (decodeURIComponent(s[1]) !== actorId) return sendJson(res, 403, { error: 'forbidden' });
    if (s[2] === 'profile') {
      if (req.method === 'GET') return sendJson(res, 200, await profileStore.getOrCreate(actorId));
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        // Paid ranges can only be granted by verified store billing.
        if ('zoneTier' in body && body.zoneTier !== 'free') return sendJson(res, 403, { error: 'zone_tier_managed_by_billing' });
        const r = await profileStore.update(actorId, body);
        if (!r.ok) {
          if (r.error === OBJECTIONABLE_CONTENT) countFilterRejection(adminStatsStore);
          return sendJson(res, 400, { error: r.error });
        }
        // Turning sharing off takes the rider off the Nearby map straight away.
        if (body.shareLocation === false) await presenceStore.removeRider(actorId);
        return sendJson(res, 200, r.profile);
      }
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
    if (req.method === 'DELETE' && s[2] === 'friends' && s[3]) {
      await friendStore.removeFriend(actorId, decodeURIComponent(s[3]));
      return sendJson(res, 200, {});
    }
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
  return NOT_HANDLED;
}
