import { createHash, timingSafeEqual } from 'node:crypto';
import { decodeJwsPayload, StoreVerificationError } from '../storeBilling.ts';
import { consumeRateLimit, rateLimitSubject, readJsonBody, sendJson } from '../serverHttp.ts';
import { NOT_HANDLED } from './context.ts';
import type { PublicRouteContext, RouteContext } from './context.ts';

function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function logNotificationFailure(platform: string, error: unknown): void {
  console.error(JSON.stringify({ level: 'error', event: 'billing_notification_failed', platform, message: error instanceof Error ? error.message : String(error) }));
}

/**
 * Store notifications (no rider session). Neither payload is trusted: each
 * only names a subscription, which is then re-read from the store with the
 * server's own credentials.
 */
export async function handleBillingNotificationRoutes(ctx: PublicRouteContext): Promise<unknown> {
  const { req, res, url, address, billingStore, rateLimitStore } = ctx;
  if (req.method !== 'POST' || !url.pathname.startsWith('/billing/') || !url.pathname.endsWith('/notifications')) return NOT_HANDLED;
  // Each notification costs a store lookup, so they're limited per address.
  if (!(await consumeRateLimit(res, rateLimitStore, rateLimitSubject('ip', address), 'api'))) return;

  // App Store Server Notifications V2.
  if (url.pathname === '/billing/apple/notifications') {
    const body = await readJsonBody(req);
    if (typeof body.signedPayload !== 'string') return sendJson(res, 400, { error: 'signedPayload is required' });
    let originalId: string | undefined;
    try {
      const payload = decodeJwsPayload(body.signedPayload) as { data?: { signedTransactionInfo?: unknown } };
      const info = payload.data?.signedTransactionInfo;
      if (typeof info === 'string') originalId = String(decodeJwsPayload(info).originalTransactionId ?? '') || undefined;
    } catch {
      return sendJson(res, 400, { error: 'malformed notification' });
    }
    if (originalId && /^\d{1,32}$/.test(originalId)) {
      try {
        await billingStore.refresh('apple', originalId);
      } catch (error) {
        logNotificationFailure('apple', error);
        // Apple retries a notification that isn't answered with 200.
        return sendJson(res, 503, { error: 'retry' });
      }
    }
    return sendJson(res, 200, {});
  }

  // Google Play Real-time developer notifications, pushed by Pub/Sub to
  // .../billing/google/notifications?token=<GOOGLE_RTDN_TOKEN>.
  if (url.pathname === '/billing/google/notifications') {
    const expected = process.env.GOOGLE_RTDN_TOKEN?.trim();
    const given = url.searchParams.get('token') ?? '';
    if (!expected || !sameSecret(given, expected)) return sendJson(res, 403, { error: 'forbidden' });
    const body = await readJsonBody(req) as { message?: { data?: unknown } };
    let purchaseToken: string | undefined;
    if (typeof body.message?.data === 'string') {
      try {
        const data = JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8')) as { subscriptionNotification?: { purchaseToken?: unknown } };
        const token = data.subscriptionNotification?.purchaseToken;
        if (typeof token === 'string') purchaseToken = token;
      } catch {
        // Test notifications and other kinds carry no subscription; acknowledge them.
      }
    }
    if (purchaseToken) {
      try {
        await billingStore.refresh('google', purchaseToken);
      } catch (error) {
        logNotificationFailure('google', error);
        return sendJson(res, 503, { error: 'retry' });
      }
    }
    // Pub/Sub treats any 2xx as delivered.
    return sendJson(res, 200, {});
  }
  return NOT_HANDLED;
}

/** The signed-in rider's plan, and verifying a purchase the app made. */
export async function handleBillingRoutes(ctx: RouteContext): Promise<unknown> {
  const { req, res, url, actorId, billingStore } = ctx;
  if (url.pathname === '/billing' && req.method === 'GET') {
    return sendJson(res, 200, await billingStore.status(actorId));
  }
  if (url.pathname === '/billing/verify' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const platform = body.platform;
    if (platform !== 'apple' && platform !== 'google') return sendJson(res, 400, { error: 'platform must be apple or google' });
    const id = platform === 'apple' ? body.transactionId : body.purchaseToken;
    if (typeof id !== 'string' || id.length === 0) {
      return sendJson(res, 400, { error: platform === 'apple' ? 'transactionId is required' : 'purchaseToken is required' });
    }
    const productId = typeof body.productId === 'string' ? body.productId : undefined;
    try {
      return sendJson(res, 200, await billingStore.verifyPurchase(actorId, platform, id, productId));
    } catch (error) {
      if (error instanceof StoreVerificationError) return sendJson(res, error.status, { error: error.code });
      throw error;
    }
  }
  return NOT_HANDLED;
}
