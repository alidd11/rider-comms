import { readJsonBody, sendJson } from '../serverHttp.ts';
import { validateScenicRouteInput } from '@rider-comms/shared';
import type { Difficulty, RoadType, VehicleCategory } from '@rider-comms/shared';
import { DIFFICULTIES, NOT_HANDLED, ROAD_TYPES, VEHICLE_CATEGORIES } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleScenicRouteRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, authStore, scenicRouteStore } = ctx;
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
  return NOT_HANDLED;
}
