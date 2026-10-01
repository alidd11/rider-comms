import { InvalidMessageCursorError } from '../messageStore.ts';
import { consumeRateLimit, consumeSocialWrite, isCoordinate, rateLimitSubject, readJsonBody, sendJson } from '../serverHttp.ts';
import { InvalidSocialEventCursorError, MAX_SOCIAL_EVENT_WAIT_MS } from '../socialEventStore.ts';
import { NOT_HANDLED } from './context.ts';
import type { RouteContext } from './context.ts';

/** Hideout invite list size: a private ride group's maximum. */
export const MAX_HIDEOUT_PARTICIPANTS = 20;

export async function handleSocialRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, profileStore, friendStore, messageStore, hideoutStore, authStore, moderationStore, socialRateLimitStore, socialActivityStore, socialEventStore, rateLimitStore } = ctx;
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
    // Each participant costs a friendship lookup, so the list is capped at a
    // ride group's size rather than whatever fits in the request body.
    const body = await readJsonBody(req), ids = body.participantIds; if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100 || !isCoordinate(body.lat, body.lon) || !Array.isArray(ids) || ids.length === 0 || ids.length > MAX_HIDEOUT_PARTICIPANTS || !ids.every((id) => typeof id === 'string')) return sendJson(res, 400, { error: `valid name, lat, lon, and 1 to ${MAX_HIDEOUT_PARTICIPANTS} participantIds are required` });
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'hideout_create'))) return;
    const participants = [...new Set(ids as string[])].filter((id) => id !== actorId);
    for (const id of participants) { if (!(await friendStore.isFriendOf(actorId, id))) return sendJson(res, 403, { error: 'participants_must_be_friends' }); }
    return sendJson(res, 201, await hideoutStore.create({ name: body.name.trim(), lat: body.lat as number, lon: body.lon as number, createdBy: actorId, participantIds: participants }));
  }
  if (req.method === 'DELETE' && s[0] === 'hideouts' && s[1]) { const r = await hideoutStore.delete(decodeURIComponent(s[1]), actorId); return r.ok ? sendJson(res, 200, {}) : sendJson(res, r.error === 'forbidden' ? 403 : 404, { error: r.error }); }
  return NOT_HANDLED;
}
