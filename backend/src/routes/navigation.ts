import { DirectionsProviderError, routeAvoidance } from '../directionsProvider.ts';
import { PlacesProviderError, normalizePlaceId, normalizePlaceQuery, normalizePlaceTypes, normalizeSessionToken } from '../placesProvider.ts';
import type { PlaceSearchRequest } from '../placesProvider.ts';
import { consumeRateLimit, rateLimitSubject, readJsonBody, routeCoordinate, sendJson } from '../serverHttp.ts';
import { NOT_HANDLED } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleNavigationRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, rateLimitStore, directionsProvider, placesProvider, placeSuggestionsProvider, placeDetailsProvider } = ctx;
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
  // Search as you type: suggestions in a session, then details for the pick.
  if (req.method === 'POST' && url.pathname === '/places/autocomplete') {
    const body = await readJsonBody(req);
    const near = routeCoordinate(body.near);
    const input = normalizePlaceQuery(body.input);
    const sessionToken = normalizeSessionToken(body.sessionToken);
    if (!near || !input || !sessionToken) {
      return sendJson(res, 400, { error: 'valid near coordinate, a 2-200 character input and a session token are required' });
    }
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'place_suggestions'))) return;
    try {
      return sendJson(res, 200, { suggestions: await placeSuggestionsProvider({ input, near, sessionToken }) });
    } catch (error) {
      return placesError(res, error);
    }
  }
  if (req.method === 'POST' && url.pathname === '/places/details') {
    const body = await readJsonBody(req);
    const placeId = normalizePlaceId(body.placeId);
    const sessionToken = normalizeSessionToken(body.sessionToken);
    if (!placeId || !sessionToken) return sendJson(res, 400, { error: 'a place id and session token are required' });
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'places'))) return;
    try {
      return sendJson(res, 200, { place: await placeDetailsProvider(placeId, sessionToken) });
    } catch (error) {
      return placesError(res, error);
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
      return placesError(res, error);
    }
  }
  return NOT_HANDLED;
}

function placesError(res: RouteContext['res'], error: unknown): unknown {
  if (!(error instanceof PlacesProviderError)) throw error;
  if (error.code === 'places_invalid_request') return sendJson(res, 400, { error: error.code });
  if (error.code === 'places_rate_limited') return sendJson(res, 429, { error: error.code });
  if (error.code === 'places_timeout') return sendJson(res, 504, { error: error.code });
  if (error.code === 'places_not_configured') return sendJson(res, 503, { error: error.code });
  return sendJson(res, 502, { error: error.code });
}
