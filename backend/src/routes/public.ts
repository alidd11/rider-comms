import { reportOperationalError } from '../errorAlerts.ts';
import { consumeRateLimit, rateLimitSubject, readJsonBody, sendJson } from '../serverHttp.ts';
import { parseClientErrorReport } from '../clientErrors.ts';
import { countFilterRejection, NOT_HANDLED } from './context.ts';
import type { PublicRouteContext } from './context.ts';

export async function handlePublicRoutes(ctx: PublicRouteContext): Promise<unknown> {
  const { req, res, url, address, profileStore, authStore, rateLimitStore, socialActivityStore, readinessCheck, adminStatsStore } = ctx;
  // Uptime monitors often probe with HEAD; Node drops the body for HEAD.
  const isProbe = req.method === 'GET' || req.method === 'HEAD';
  if (isProbe && url.pathname === '/health') return sendJson(res, 200, { ok: true });
  if (isProbe && url.pathname === '/ready') {
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
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'signup_ip'))) return;
    const body = await readJsonBody(req);
    // App Store guideline 1.2: no account without agreeing to the Terms and
    // Community Guidelines; the version agreed to is stored with it.
    if (body.acceptTerms !== true) return sendJson(res, 400, { error: 'terms_not_accepted' });
    const result = await authStore.signUp(body.username, body.email, body.password, body.deviceName);
    if ('error' in result && result.error === 'objectionable_username') countFilterRejection(adminStatsStore);
    if ('error' in result) return sendJson(res, result.error === 'username_taken' || result.error === 'email_taken' ? 409 : 400, { error: result.error });
    await profileStore.getOrCreate(result.riderId);
    await socialActivityStore.touch(result.riderId);
    return sendJson(res, 201, result);
  }
  if (req.method === 'POST' && url.pathname === '/auth/login') {
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'auth'))) return;
    const body = await readJsonBody(req);
    if (typeof body.username === 'string' && body.username.trim()) {
      if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('account', body.username.trim().toLowerCase()), 'auth_account'))) return;
    }
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
  if (req.method === 'POST' && url.pathname === '/client-errors') {
    // Unauthenticated on purpose: crashes can happen before sign-in.
    if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'client_error'))) return;
    const report = parseClientErrorReport(await readJsonBody(req));
    if (!report) return sendJson(res, 400, { error: 'platform and message are required' });
    console.error(JSON.stringify({ level: report.fatal ? 'fatal' : 'error', event: 'client_error', ...report }));
    reportOperationalError('client_error', `${report.platform}${report.fatal ? ' (fatal)' : ''}${report.appVersion ? ` v${report.appVersion}` : ''}: ${report.message}`);
    return sendJson(res, 202, { received: true });
  }
  return NOT_HANDLED;
}
