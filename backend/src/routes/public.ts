import { consumeRateLimit, rateLimitSubject, readJsonBody, sendJson } from '../serverHttp.ts';
import { NOT_HANDLED } from './context.ts';
import type { PublicRouteContext } from './context.ts';

export async function handlePublicRoutes(ctx: PublicRouteContext): Promise<unknown> {
  const { req, res, url, address, profileStore, authStore, rateLimitStore, socialActivityStore, readinessCheck } = ctx;
  if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/ready') {
    try {
      await readinessCheck();
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'readiness_failed', message: error instanceof Error ? error.message : String(error) }));
      return sendJson(res, 503, { ok: false, error: 'not_ready' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/config') {
    return sendJson(res, 200, { googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '' });
  }
  if (req.method === 'POST' && url.pathname === '/auth/signup') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'auth'))) return;
    const body = await readJsonBody(req);
    const result = await authStore.signUp(body.username, body.email, body.password, body.deviceName);
    if ('error' in result) return sendJson(res, result.error === 'username_taken' || result.error === 'email_taken' ? 409 : 400, { error: result.error });
    await profileStore.getOrCreate(result.riderId);
    await socialActivityStore.touch(result.riderId);
    return sendJson(res, 201, result);
  }
  if (req.method === 'POST' && url.pathname === '/auth/login') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'auth'))) return;
    const body = await readJsonBody(req);
    const result = await authStore.logIn(body.username, body.password, body.deviceName);
    if ('error' in result) return sendJson(res, result.error === 'account_suspended' ? 403 : 401, { error: result.error });
    await profileStore.getOrCreate(result.riderId);
    await socialActivityStore.touch(result.riderId);
    return sendJson(res, 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/auth/verify-email') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'auth'))) return;
    const body = await readJsonBody(req);
    const result = await authStore.verifyEmail(body.token);
    if ('error' in result) return sendJson(res, result.error === 'invalid_token' ? 400 : 410, { error: result.error });
    return sendJson(res, 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/auth/password-reset/request') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'password_reset_request'))) return;
    const body = await readJsonBody(req);
    await authStore.requestPasswordReset(body.email);
    return sendJson(res, 202, { accepted: true });
  }
  if (req.method === 'POST' && url.pathname === '/auth/password-reset/confirm') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'auth'))) return;
    const body = await readJsonBody(req);
    const result = await authStore.resetPassword(body.token, body.password);
    if ('error' in result) return sendJson(res, result.error === 'expired_token' ? 410 : 400, { error: result.error });
    return sendJson(res, 200, result);
  }
  return NOT_HANDLED;
}
