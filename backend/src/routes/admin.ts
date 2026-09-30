import { MAX_RIDER_SEARCH_RESULTS } from '../adminStatsStore.ts';
import { sendJson } from '../serverHttp.ts';
import { NOT_HANDLED } from './context.ts';
import type { RouteContext } from './context.ts';

/** Staff business dashboard. Admin status is re-read from Postgres on every request. */
export async function handleAdminRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, authStore, adminStatsStore } = ctx;
  if (s[0] !== 'admin') return NOT_HANDLED;
  if (!(await authStore.isAdmin(actorId))) return sendJson(res, 403, { error: 'admin_required' });
  if (req.method === 'GET' && url.pathname === '/admin/overview') {
    return sendJson(res, 200, await adminStatsStore.overview());
  }
  if (req.method === 'GET' && url.pathname === '/admin/riders') {
    const query = url.searchParams.get('q') ?? '';
    if (query.length > 100) return sendJson(res, 400, { error: 'q must be at most 100 characters' });
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam === null ? 20 : Number(limitParam);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RIDER_SEARCH_RESULTS) {
      return sendJson(res, 400, { error: `limit must be an integer from 1 to ${MAX_RIDER_SEARCH_RESULTS}` });
    }
    return sendJson(res, 200, { riders: await adminStatsStore.searchRiders(query, limit) });
  }
  return sendJson(res, 404, { error: 'not_found' });
}
