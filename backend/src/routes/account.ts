import { bearerToken, consumeRateLimit, rateLimitSubject, readJsonBody, sendEmpty, sendJson } from '../serverHttp.ts';
import { exportRiderData } from '../accountExport.ts';
import { TERMS_VERSION } from '../authStore.ts';
import { NOT_HANDLED, STAFF_REAUTH_WINDOW_MS, ejectFromVoice, refuseWithoutRecentReauth, voiceMembershipsOf } from './context.ts';
import type { RouteContext } from './context.ts';

export async function handleAccountRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, authStore, accountDeletionStore, rateLimitStore } = ctx;
  if (req.method === 'GET' && url.pathname === '/auth/me') {
    const identity = await authStore.getIdentity(actorId);
    return sendJson(res, 200, {
      riderId: actorId,
      username: identity?.username ?? null,
      emailVerified: identity?.emailVerified ?? false,
      termsAccepted: identity?.termsAccepted ?? true,
      termsVersion: TERMS_VERSION,
    });
  }
  if (req.method === 'POST' && url.pathname === '/auth/accept-terms') {
    const body = await readJsonBody(req);
    const result = await authStore.acceptTerms(actorId, body.version);
    return 'error' in result ? sendJson(res, 409, { error: result.error, termsVersion: TERMS_VERSION }) : sendJson(res, 200, result);
  }
  if (req.method === 'GET' && url.pathname === '/auth/sessions') {
    return sendJson(res, 200, { sessions: await authStore.listSessions(actorId, bearerToken(req)) });
  }
  const sessionMatch = url.pathname.match(/^\/auth\/sessions\/([^/]+)$/);
  if (req.method === 'DELETE' && sessionMatch) {
    const removed = await authStore.revokeSession(actorId, decodeURIComponent(sessionMatch[1]));
    return removed ? sendEmpty(res, 204) : sendJson(res, 404, { error: 'session_not_found' });
  }
  if (req.method === 'POST' && url.pathname === '/auth/logout') {
    await authStore.revokeToken(bearerToken(req));
    return sendEmpty(res, 204);
  }
  // Staff re-enter their password before sensitive changes (STAFF_REAUTH_WINDOW_MS).
  if (req.method === 'POST' && url.pathname === '/auth/reauthenticate') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'auth'))) return;
    const body = await readJsonBody(req);
    const confirmed = await authStore.reauthenticate(actorId, bearerToken(req), body.password);
    return confirmed
      ? sendJson(res, 200, { reauthenticated: true, validForMs: STAFF_REAUTH_WINDOW_MS })
      : sendJson(res, 401, { error: 'invalid_credentials' });
  }
  // Disabled by default until password-confirming PWA and native clients ship.
  const requiresStepUp = async () => process.env.ACCOUNT_SENSITIVE_REAUTH_ENFORCED === 'true' && await refuseWithoutRecentReauth(ctx);
  // Download my data: everything held about this rider, as one JSON file.
  if (req.method === 'GET' && url.pathname === '/auth/export') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'auth'))) return;
    if (await requiresStepUp()) return;
    const data = await exportRiderData(actorId);
    if (!data) return sendJson(res, 404, { error: 'not_found' });
    res.setHeader('Content-Disposition', `attachment; filename="rider-comms-data-${new Date().toISOString().slice(0, 10)}.json"`);
    return sendJson(res, 200, data);
  }
  if (req.method === 'GET' && url.pathname === '/auth/security-events') {
    return sendJson(res, 200, { events: await authStore.listSecurityEvents({ riderId: actorId, limit: 50 }) });
  }
  if (req.method === 'POST' && url.pathname === '/auth/resend-verification') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('rider', actorId), 'verification_resend'))) return;
    const result = await authStore.resendVerification(actorId);
    if ('error' in result) return sendJson(res, result.error === 'not_found' ? 404 : 409, { error: result.error });
    return sendJson(res, 200, result);
  }
  if (req.method === 'DELETE' && url.pathname === '/auth/me') {
    if (await requiresStepUp()) return;
    // Read the voice rooms first: deletion removes the rows that say where
    // the rider is connected.
    const memberships = await voiceMembershipsOf(ctx, actorId);
    await accountDeletionStore.deleteRider(actorId);
    // A deleted account must not stay audible in rides or Nearby pairs.
    await ejectFromVoice(ctx, actorId, memberships);
    // Do not revoke the in-process token until the database transaction
    // commits. If deletion fails, the rider can retry instead of being
    // logged out while their durable account and data still exist.
    authStore.forgetRider(actorId);
    return sendJson(res, 200, {});
  }
  return NOT_HANDLED;
}
