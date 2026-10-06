import { DirectionsProviderError, routeAvoidance } from '../directionsProvider.ts';
import { PlacesProviderError, normalizePlaceQuery, normalizePlaceTypes } from '../placesProvider.ts';
import type { PlaceSearchRequest } from '../placesProvider.ts';
import { consumeRateLimit, rateLimitSubject, readJsonBody, routeCoordinate, sendJson } from '../serverHttp.ts';
import { NOT_HANDLED } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleNavigationRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, rateLimitStore, directionsProvider, placesProvider } = ctx;
  if (req.method === 'POST' && url.pathname === '/directions') {
    const body = await readJsonBody(req);
    const origin = routeCoordinate(body.origin);
    const destination = routeCoordinate(body.destination);
    if (!origin || !destination) {
      return sendJson(res, 400, { error: 'valid origin and destination coordinates are required' });
    }
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'directions'))) return;
    try {
      return sendJson(res, 200, await directionsProvider(origin, destination, routeAvoidance(body.avoid)));
    } catch (error) {
      if (!(error instanceof DirectionsProviderError)) throw error;
      if (error.code === 'directions_invalid_request') return sendJson(res, 400, { error: error.code });
      if (error.code === 'directions_no_route') return sendJson(res, 404, { error: error.code });
      if (error.code === 'directions_timeout') return sendJson(res, 504, { error: error.code });
      if (error.code === 'directions_not_configured') return sendJson(res, 503, { error: error.code });
      return sendJson(res, 502, { error: error.code });
    }
  }
  if (req.method === 'POST' && (url.pathname === '/places/search' || url.pathname === '/places/nearby')) {
    const body = await readJsonBody(req);
    const near = routeCoordinate(body.near);
    let request: PlaceSearchRequest | null = null;
    if (near && url.pathname === '/places/search') {
      const query = normalizePlaceQuery(body.query);
      if (query) request = { kind: 'text', query, near };
    } else if (near) {
      const includedTypes = normalizePlaceTypes(body.includedTypes);
      if (includedTypes) request = { kind: 'nearby', includedTypes, near };
    }
    if (!request) {
      return sendJson(res, 400, {
        error: url.pathname === '/places/search'
          ? 'valid near coordinate and a 2-200 character query are required'
          : 'valid near coordinate and 1-5 place types are required',
      });
    }
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'places'))) return;
    try {
      return sendJson(res, 200, { places: await placesProvider(request) });
    } catch (error) {
      if (!(error instanceof PlacesProviderError)) throw error;
      if (error.code === 'places_invalid_request') return sendJson(res, 400, { error: error.code });
      if (error.code === 'places_rate_limited') return sendJson(res, 429, { error: error.code });
      if (error.code === 'places_timeout') return sendJson(res, 504, { error: error.code });
      if (error.code === 'places_not_configured') return sendJson(res, 503, { error: error.code });
      return sendJson(res, 502, { error: error.code });
    }
  }
  return NOT_HANDLED;
}
