import { consumeRateLimit, isCoordinate, rateLimitSubject, readJsonBody, sendJson } from '../serverHttp.ts';
import type { HazardType } from '@rider-comms/shared';
import { HAZARD_TYPES, NOT_HANDLED } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleHazardRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, s, hazardStore, rateLimitStore } = ctx;
  if (req.method === 'POST' && url.pathname === '/hazards') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'hazard_create'))) return;
    const body = await readJsonBody(req);
    if (typeof body.type !== 'string' || !HAZARD_TYPES.includes(body.type as HazardType)) return sendJson(res, 400, { error: 'valid type is required' });
    if (!isCoordinate(body.lat, body.lon)) return sendJson(res, 400, { error: 'valid lat and lon are required' });
    return sendJson(res, 201, await hazardStore.create(body.type as HazardType, body.lat as number, body.lon as number, actorId));
  }
  if (req.method === 'GET' && url.pathname === '/hazards/nearby') {
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!isCoordinate(lat, lon)) return sendJson(res, 400, { error: 'valid lat and lon are required' });
    // The reporter's rider ID is kept server-side (it authorises DELETE) and is
    // never published, so a hazard's location can't be tied to a rider.
    const hazards = (await hazardStore.nearby(lat, lon, Date.now())).map(({ reportedBy: _reportedBy, ...hazard }) => hazard);
    return sendJson(res, 200, { hazards });
  }
  if (req.method === 'POST' && s[0] === 'hazards' && s[1] && s.length === 3 && (s[2] === 'confirm' || s[2] === 'deny')) {
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
  return NOT_HANDLED;
}
