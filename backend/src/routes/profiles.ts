import { readJsonBody, sendJson } from '../serverHttp.ts';
import { MAX_PROFILE_BATCH_SIZE, NOT_HANDLED, publicProfile } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleProfileRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, profileStore, friendStore, authStore, moderationStore } = ctx;
  if (req.method === 'GET' && s[0] === 'profiles' && s[1] && s.length === 2) {
    const targetId = decodeURIComponent(s[1]);
    if (!(await authStore.hasRider(targetId))) return sendJson(res, 404, { error: 'rider_not_found' });
    if (await moderationStore.isBlockedBetween(actorId, targetId)) return sendJson(res, 403, { error: 'blocked' });
    return sendJson(res, 200, await publicProfile(profileStore, friendStore, actorId, targetId));
  }
  if (req.method === 'POST' && url.pathname === '/profiles/batch') {
    const body = await readJsonBody(req);
    const ids = body.riderIds;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string') || ids.length === 0 || ids.length > MAX_PROFILE_BATCH_SIZE) {
      return sendJson(res, 400, { error: `riderIds must be an array of 1 to ${MAX_PROFILE_BATCH_SIZE} strings` });
    }
    const uniqueIds = [...new Set(ids as string[])].filter((id) => id !== actorId);
    const profiles: Record<string, Awaited<ReturnType<typeof publicProfile>>> = {};
    await Promise.all(uniqueIds.map(async (targetId) => {
      if (!(await authStore.hasRider(targetId))) return;
      if (await moderationStore.isBlockedBetween(actorId, targetId)) return;
      profiles[targetId] = await publicProfile(profileStore, friendStore, actorId, targetId);
    }));
    return sendJson(res, 200, { profiles });
  }
  return NOT_HANDLED;
}
