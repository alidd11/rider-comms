import { createPrivateKey, createSign, sign as cryptoSign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { tierForProductId } from '@rider-comms/shared';
import type { BillingPlatform, PaidZoneTier } from '@rider-comms/shared';

/**
 * Asks Apple and Google for the current state of a subscription. Purchases
 * are never trusted from the device: the app sends only an identifier, and
 * the server reads the subscription from the store over an authenticated
 * TLS connection.
 */

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** The store's answer, reduced to what decides a tier. */
export interface StoreSubscriptionState {
  platform: BillingPlatform;
  /** Stable ID of the subscription: Apple's originalTransactionId or the
   * Google purchase token. */
  originalId: string;
  productId: string;
  tier: PaidZoneTier;
  expiresAt: number;
  active: boolean;
  willRenew: boolean;
  /** Apple's appAccountToken or Google's obfuscatedExternalAccountId, when set. */
  accountToken: string | null;
  environment: 'production' | 'sandbox';
}

export class StoreVerificationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export interface StoreVerifier {
  readonly platform: BillingPlatform;
  /** Apple: any transaction ID in the subscription. Google: the purchase
   * token (with its product ID). */
  verify(id: string, productId?: string): Promise<StoreSubscriptionState>;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Payload of a JWS the server fetched from Apple itself (so already trusted). */
export function decodeJwsPayload(jws: string): Record<string, unknown> {
  const part = jws.split('.')[1];
  if (!part) throw new StoreVerificationError('malformed_store_response', 502);
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    if (!value || typeof value !== 'object') throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new StoreVerificationError('malformed_store_response', 502);
  }
}

function pemKey(raw: string): KeyObject {
  return createPrivateKey(raw.replace(/\\n/g, '\n').trim());
}

// ─── Apple ──────────────────────────────────────────────────────────────

export interface AppleCredentials {
  keyId: string;
  issuerId: string;
  privateKey: string;
  bundleId: string;
}

const APPLE_PRODUCTION = 'https://api.storekit.itunes.apple.com';
const APPLE_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';
// App Store Server API subscription status values.
const APPLE_STATUS_ACTIVE = 1;
const APPLE_STATUS_GRACE_PERIOD = 4;

export class AppleStoreVerifier implements StoreVerifier {
  readonly platform = 'apple' as const;
  private readonly credentials: AppleCredentials;
  private readonly key: KeyObject;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(credentials: AppleCredentials, fetchImpl: FetchLike = fetch as unknown as FetchLike, now: () => number = Date.now) {
    this.credentials = credentials;
    this.key = pemKey(credentials.privateKey);
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  private token(): string {
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: this.credentials.keyId, typ: 'JWT' }));
    const issuedAt = Math.floor(this.now() / 1000);
    const payload = base64url(JSON.stringify({
      iss: this.credentials.issuerId,
      iat: issuedAt,
      exp: issuedAt + 300,
      aud: 'appstoreconnect-v1',
      bid: this.credentials.bundleId,
    }));
    const signature = cryptoSign('sha256', Buffer.from(`${header}.${payload}`), { key: this.key, dsaEncoding: 'ieee-p1363' });
    return `${header}.${payload}.${base64url(signature)}`;
  }

  private async statuses(host: string, transactionId: string): Promise<unknown | null> {
    const response = await this.fetchImpl(`${host}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${this.token()}` },
    });
    if (response.status === 404) return null;
    if (response.status === 400) throw new StoreVerificationError('invalid_transaction');
    if (!response.ok) throw new StoreVerificationError('store_unavailable', 502);
    return response.json();
  }

  async verify(transactionId: string): Promise<StoreSubscriptionState> {
    if (!/^\d{1,32}$/.test(transactionId)) throw new StoreVerificationError('invalid_transaction');
    // App Review and TestFlight buy in the sandbox with release builds, so a
    // transaction the production API doesn't know is looked up there too.
    let environment: StoreSubscriptionState['environment'] = 'production';
    let body = await this.statuses(APPLE_PRODUCTION, transactionId);
    if (body === null) {
      environment = 'sandbox';
      body = await this.statuses(APPLE_SANDBOX, transactionId);
    }
    if (body === null) throw new StoreVerificationError('transaction_not_found', 404);
    const { bundleId, data } = body as { bundleId?: unknown; data?: unknown };
    if (bundleId !== this.credentials.bundleId || !Array.isArray(data)) throw new StoreVerificationError('invalid_transaction');

    // One entry per subscription group; this app has one group. Within it,
    // the latest transaction says which product (tier) is current.
    const candidates: StoreSubscriptionState[] = [];
    for (const group of data as Array<{ lastTransactions?: unknown }>) {
      if (!Array.isArray(group.lastTransactions)) continue;
      for (const entry of group.lastTransactions as Array<{ status?: unknown; signedTransactionInfo?: unknown; signedRenewalInfo?: unknown }>) {
        if (typeof entry.signedTransactionInfo !== 'string') continue;
        const transaction = decodeJwsPayload(entry.signedTransactionInfo);
        const renewal = typeof entry.signedRenewalInfo === 'string' ? decodeJwsPayload(entry.signedRenewalInfo) : {};
        const productId = String(transaction.productId ?? '');
        const tier = tierForProductId(productId);
        if (!tier || transaction.bundleId !== this.credentials.bundleId) continue;
        const graceEnds = Number(renewal.gracePeriodExpiresDate ?? 0);
        const expiresAt = Math.max(Number(transaction.expiresDate ?? 0), entry.status === APPLE_STATUS_GRACE_PERIOD ? graceEnds : 0);
        const revoked = transaction.revocationDate !== undefined && transaction.revocationDate !== null;
        const statusActive = entry.status === APPLE_STATUS_ACTIVE || entry.status === APPLE_STATUS_GRACE_PERIOD;
        // The tier follows the product the rider will renew into only once
        // it takes effect; until then the current transaction's product holds.
        candidates.push({
          platform: 'apple',
          originalId: String(transaction.originalTransactionId ?? ''),
          productId,
          tier,
          expiresAt,
          active: statusActive && !revoked && expiresAt > this.now(),
          willRenew: renewal.autoRenewStatus === 1,
          accountToken: typeof transaction.appAccountToken === 'string' ? transaction.appAccountToken.toLowerCase() : null,
          environment,
        });
      }
    }
    const best = candidates.find((candidate) => candidate.active) ?? candidates[0];
    if (!best || !best.originalId) throw new StoreVerificationError('transaction_not_found', 404);
    return best;
  }
}

// ─── Google Play ────────────────────────────────────────────────────────

export interface GoogleCredentials {
  clientEmail: string;
  privateKey: string;
  packageName: string;
}

export function parseGoogleServiceAccount(raw: string, packageName: string): GoogleCredentials {
  const json = JSON.parse(raw) as { client_email?: unknown; private_key?: unknown };
  if (typeof json.client_email !== 'string' || typeof json.private_key !== 'string') {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must be a service account key with client_email and private_key');
  }
  return { clientEmail: json.client_email, privateKey: json.private_key, packageName };
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
// Still entitled: renewing, in a payment grace period, or cancelled but
// paid up to the end of the period.
const GOOGLE_ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

export class GooglePlayVerifier implements StoreVerifier {
  readonly platform = 'google' as const;
  private readonly credentials: GoogleCredentials;
  private readonly key: KeyObject;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(credentials: GoogleCredentials, fetchImpl: FetchLike = fetch as unknown as FetchLike, now: () => number = Date.now) {
    this.credentials = credentials;
    this.key = pemKey(credentials.privateKey);
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > this.now() + 60_000) return this.accessToken.value;
    const issuedAt = Math.floor(this.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
      iss: this.credentials.clientEmail,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: GOOGLE_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${base64url(signer.sign(this.key))}`;
    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    if (!response.ok) throw new StoreVerificationError('store_unavailable', 502);
    const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string') throw new StoreVerificationError('store_unavailable', 502);
    this.accessToken = { value: body.access_token, expiresAt: this.now() + Number(body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  async verify(purchaseToken: string, productId?: string): Promise<StoreSubscriptionState> {
    if (!/^[A-Za-z0-9._:-]{10,4096}$/.test(purchaseToken)) throw new StoreVerificationError('invalid_transaction');
    const base = `${GOOGLE_API}/${encodeURIComponent(this.credentials.packageName)}`;
    const authorization = `Bearer ${await this.token()}`;
    const response = await this.fetchImpl(`${base}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, {
      headers: { Authorization: authorization },
    });
    if (response.status === 404 || response.status === 410) throw new StoreVerificationError('transaction_not_found', 404);
    if (response.status === 400) throw new StoreVerificationError('invalid_transaction');
    if (!response.ok) throw new StoreVerificationError('store_unavailable', 502);
    const body = await response.json() as {
      subscriptionState?: unknown;
      acknowledgementState?: unknown;
      testPurchase?: unknown;
      lineItems?: Array<{ productId?: unknown; expiryTime?: unknown; autoRenewingPlan?: { autoRenewEnabled?: unknown } }>;
      externalAccountIdentifiers?: { obfuscatedExternalAccountId?: unknown };
    };
    const items = (body.lineItems ?? [])
      .map((item) => ({
        productId: String(item.productId ?? ''),
        tier: tierForProductId(String(item.productId ?? '')),
        expiresAt: Date.parse(String(item.expiryTime ?? '')) || 0,
        willRenew: item.autoRenewingPlan?.autoRenewEnabled === true,
      }))
      .filter((item): item is typeof item & { tier: PaidZoneTier } => item.tier !== null)
      .sort((a, b) => b.expiresAt - a.expiresAt);
    const item = items.find((candidate) => !productId || candidate.productId === productId) ?? items[0];
    if (!item) throw new StoreVerificationError('invalid_transaction');
    const state = String(body.subscriptionState ?? '');
    const active = GOOGLE_ENTITLED_STATES.has(state) && item.expiresAt > this.now();

    // Google refunds a purchase that isn't acknowledged within three days.
    // The app acknowledges too (finishTransaction); either is enough.
    if (active && body.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      const ack = await this.fetchImpl(
        `${base}/purchases/subscriptions/${encodeURIComponent(item.productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
        { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: '{}' },
      );
      // Acknowledged already (by the app) is fine; anything else is retried
      // on the next verify or sweep.
      if (!ack.ok && ack.status !== 400) {
        console.error(JSON.stringify({ level: 'error', event: 'google_acknowledge_failed', status: ack.status }));
      }
    }

    const accountToken = body.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    return {
      platform: 'google',
      originalId: purchaseToken,
      productId: item.productId,
      tier: item.tier,
      expiresAt: item.expiresAt,
      active,
      willRenew: item.willRenew,
      accountToken: typeof accountToken === 'string' ? accountToken.toLowerCase() : null,
      environment: body.testPurchase ? 'sandbox' : 'production',
    };
  }
}

/** Verifiers for whichever stores have credentials in the environment. */
export function storeVerifiersFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<BillingPlatform, StoreVerifier>> {
  const verifiers: Partial<Record<BillingPlatform, StoreVerifier>> = {};
  const keyId = env.APPLE_IAP_KEY_ID?.trim();
  const issuerId = env.APPLE_IAP_ISSUER_ID?.trim();
  const applePrivateKey = env.APPLE_IAP_PRIVATE_KEY?.trim();
  if (keyId && issuerId && applePrivateKey) {
    verifiers.apple = new AppleStoreVerifier({
      keyId,
      issuerId,
      privateKey: applePrivateKey,
      bundleId: env.APPLE_BUNDLE_ID?.trim() || 'com.ridercomms.app',
    });
  }
  const serviceAccount = env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccount) {
    verifiers.google = new GooglePlayVerifier(parseGoogleServiceAccount(serviceAccount, env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || 'com.ridercomms.app'));
  }
  return verifiers;
}
