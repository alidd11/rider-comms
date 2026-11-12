import { isExpoPushToken } from '../expoPush.ts';
import { sessionTokenHash } from '../authStore.ts';
import { bearerToken, readJsonBody, sendJson } from '../serverHttp.ts';
import { isAllowedPushEndpoint } from '../webPush.ts';
import { NOT_HANDLED } from './context.ts';
import type { RouteContext } from './context.ts';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Registering this device for notifications.
 *   GET    /push/web-key        the VAPID public key a browser subscribes with
 *   PUT    /push/subscriptions  { kind: 'web', endpoint, keys: { p256dh, auth } }
 *                               { kind: 'expo', token }
 *   DELETE /push/subscriptions  { address }  (the endpoint or token)
 */
export async function handlePushRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, pushStore } = ctx;
  if (req.method === 'GET' && url.pathname === '/push/web-key') {
    return sendJson(res, 200, { publicKey: (await pushStore.getVapidKeys()).publicKey });
  }
  if (url.pathname !== '/push/subscriptions') return NOT_HANDLED;
  if (req.method === 'PUT') {
    const body = await readJsonBody(req);
    const session = sessionTokenHash(bearerToken(req));
    if (body.kind === 'web') {
      const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
      const keys = (body.keys && typeof body.keys === 'object' ? body.keys : {}) as Record<string, unknown>;
      const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
      const auth = typeof keys.auth === 'string' ? keys.auth : '';
      if (endpoint.length > 1000 || !isAllowedPushEndpoint(endpoint)) return sendJson(res, 400, { error: 'unsupported_push_service' });
      if (!BASE64URL.test(p256dh) || Buffer.from(p256dh, 'base64url').length !== 65 || !BASE64URL.test(auth) || Buffer.from(auth, 'base64url').length !== 16) {
        return sendJson(res, 400, { error: 'invalid_subscription_keys' });
      }
      if (!await pushStore.upsert({ riderId: actorId, kind: 'web', address: endpoint, p256dh, auth, sessionTokenHash: session })) {
        return sendJson(res, 409, { error: 'push_address_in_use' });
      }
      return sendJson(res, 200, {});
    }
    if (body.kind === 'expo') {
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      if (token.length > 200 || !isExpoPushToken(token)) return sendJson(res, 400, { error: 'invalid_push_token' });
      if (!await pushStore.upsert({ riderId: actorId, kind: 'expo', address: token, p256dh: null, auth: null, sessionTokenHash: session })) {
        return sendJson(res, 409, { error: 'push_address_in_use' });
      }
      return sendJson(res, 200, {});
    }
    return sendJson(res, 400, { error: 'kind must be web or expo' });
  }
  if (req.method === 'DELETE') {
    const body = await readJsonBody(req);
    const address = typeof body.address === 'string' ? body.address : '';
    if (!address || address.length > 1000) return sendJson(res, 400, { error: 'address is required' });
    await pushStore.remove(actorId, address);
    return sendJson(res, 200, {});
  }
  return NOT_HANDLED;
}
