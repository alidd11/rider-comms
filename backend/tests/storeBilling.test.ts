import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import {
  AppleStoreVerifier,
  decodeJwsPayload,
  GooglePlayVerifier,
  parseGoogleServiceAccount,
  StoreVerificationError,
  storeVerifiersFromEnv,
} from '../src/storeBilling.ts';
import type { FetchLike } from '../src/storeBilling.ts';

const NOW = Date.UTC(2026, 9, 7, 12);
const DAY = 24 * 60 * 60 * 1000;

const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const applePrivateKey = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const googlePrivateKey = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function jws(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'ES256' })}.${part(payload)}.signature`;
}

interface Call { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }

function fakeFetch(handler: (call: Call) => { status: number; body?: unknown }): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      const { status, body } = handler(call);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body ?? null),
      };
    },
  };
}

const appleCredentials = { keyId: 'KEY123', issuerId: 'issuer-uuid', privateKey: applePrivateKey, bundleId: 'com.ridercomms.app' };

function appleStatus(transaction: Record<string, unknown>, status = 1, renewal: Record<string, unknown> = { autoRenewStatus: 1 }) {
  return {
    bundleId: 'com.ridercomms.app',
    data: [{
      subscriptionGroupIdentifier: '2100',
      lastTransactions: [{
        originalTransactionId: transaction.originalTransactionId,
        status,
        signedTransactionInfo: jws({ bundleId: 'com.ridercomms.app', ...transaction }),
        signedRenewalInfo: jws(renewal),
      }],
    }],
  };
}

describe('AppleStoreVerifier', () => {
  it('signs an App Store Server API token Apple accepts (ES256, raw signature)', async () => {
    const { fetch, calls } = fakeFetch(() => ({
      status: 200,
      body: appleStatus({ originalTransactionId: '1000', productId: 'premium_monthly', expiresDate: NOW + 20 * DAY, appAccountToken: 'ABC' }),
    }));
    await new AppleStoreVerifier(appleCredentials, fetch, () => NOW).verify('2000');
    const token = calls[0].init?.headers?.Authorization?.replace('Bearer ', '') ?? '';
    const [header, payload, signature] = token.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(claims.iss, 'issuer-uuid');
    assert.equal(claims.aud, 'appstoreconnect-v1');
    assert.equal(claims.bid, 'com.ridercomms.app');
    assert.ok(claims.exp - claims.iat <= 3600);
    assert.ok(cryptoVerify('sha256', Buffer.from(`${header}.${payload}`), { key: createPublicKey(applePrivateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
    assert.equal(calls[0].url, 'https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/2000');
  });

  it('reads an active subscription', async () => {
    const { fetch } = fakeFetch(() => ({
      status: 200,
      body: appleStatus({ originalTransactionId: '1000', productId: 'premium_plus_monthly', expiresDate: NOW + 20 * DAY, appAccountToken: 'AB-CD' }),
    }));
    const state = await new AppleStoreVerifier(appleCredentials, fetch, () => NOW).verify('2000');
    assert.deepEqual(state, {
      platform: 'apple',
      originalId: '1000',
      productId: 'premium_plus_monthly',
      tier: 'premium_plus',
      expiresAt: NOW + 20 * DAY,
      active: true,
      willRenew: true,
      accountToken: 'ab-cd',
      environment: 'production',
    });
  });

  it('falls back to the sandbox for App Review and TestFlight purchases', async () => {
    const { fetch, calls } = fakeFetch(({ url }) => url.includes('sandbox')
      ? { status: 200, body: appleStatus({ originalTransactionId: '1000', productId: 'premium_monthly', expiresDate: NOW + DAY }) }
      : { status: 404, body: { errorCode: 4040010 } });
    const state = await new AppleStoreVerifier(appleCredentials, fetch, () => NOW).verify('2000');
    assert.equal(state.environment, 'sandbox');
    assert.equal(calls.length, 2);
  });

  it('treats expired, revoked and billing-retry subscriptions as inactive and honours grace periods', async () => {
    const run = async (transaction: Record<string, unknown>, status: number, renewal?: Record<string, unknown>) => {
      const { fetch } = fakeFetch(() => ({ status: 200, body: appleStatus({ originalTransactionId: '1', productId: 'premium_monthly', ...transaction }, status, renewal) }));
      return new AppleStoreVerifier(appleCredentials, fetch, () => NOW).verify('1');
    };
    assert.equal((await run({ expiresDate: NOW - DAY }, 2)).active, false);
    assert.equal((await run({ expiresDate: NOW + DAY, revocationDate: NOW - 1 }, 5)).active, false);
    assert.equal((await run({ expiresDate: NOW + DAY }, 3)).active, false);
    const grace = await run({ expiresDate: NOW - DAY }, 4, { gracePeriodExpiresDate: NOW + 3 * DAY, autoRenewStatus: 1 });
    assert.equal(grace.active, true);
    assert.equal(grace.expiresAt, NOW + 3 * DAY);
  });

  it('rejects other apps, unknown products, bad IDs and missing transactions', async () => {
    const wrongBundle = fakeFetch(() => ({ status: 200, body: { ...appleStatus({ originalTransactionId: '1', productId: 'premium_monthly', expiresDate: NOW + DAY }), bundleId: 'com.other' } }));
    await assert.rejects(new AppleStoreVerifier(appleCredentials, wrongBundle.fetch, () => NOW).verify('1'), { message: 'invalid_transaction' });
    const unknownProduct = fakeFetch(() => ({ status: 200, body: appleStatus({ originalTransactionId: '1', productId: 'coins', expiresDate: NOW + DAY }) }));
    await assert.rejects(new AppleStoreVerifier(appleCredentials, unknownProduct.fetch, () => NOW).verify('1'), { message: 'transaction_not_found' });
    const missing = fakeFetch(() => ({ status: 404 }));
    await assert.rejects(new AppleStoreVerifier(appleCredentials, missing.fetch, () => NOW).verify('1'), (error: unknown) =>
      error instanceof StoreVerificationError && error.status === 404);
    await assert.rejects(new AppleStoreVerifier(appleCredentials, missing.fetch, () => NOW).verify('../etc'), { message: 'invalid_transaction' });
    assert.equal(missing.calls.length, 2, 'an invalid ID is never sent to Apple');
    const down = fakeFetch(() => ({ status: 500 }));
    await assert.rejects(new AppleStoreVerifier(appleCredentials, down.fetch, () => NOW).verify('1'), (error: unknown) =>
      error instanceof StoreVerificationError && error.status === 502);
    const bad = fakeFetch(() => ({ status: 400 }));
    await assert.rejects(new AppleStoreVerifier(appleCredentials, bad.fetch, () => NOW).verify('1'), { message: 'invalid_transaction' });
  });
});

describe('GooglePlayVerifier', () => {
  const credentials = { clientEmail: 'billing@project.iam.gserviceaccount.com', privateKey: googlePrivateKey, packageName: 'com.ridercomms.app' };

  function google(subscription: Record<string, unknown>, extra: (call: Call) => { status: number; body?: unknown } | null = () => null) {
    return fakeFetch((call) => {
      const special = extra(call);
      if (special) return special;
      if (call.url === 'https://oauth2.googleapis.com/token') return { status: 200, body: { access_token: 'access-1', expires_in: 3600 } };
      if (call.url.endsWith(':acknowledge')) return { status: 200, body: {} };
      return { status: 200, body: subscription };
    });
  }

  it('exchanges a signed service-account assertion for an access token and caches it', async () => {
    const { fetch, calls } = google({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      lineItems: [{ productId: 'premium_monthly', expiryTime: new Date(NOW + 10 * DAY).toISOString(), autoRenewingPlan: { autoRenewEnabled: true } }],
    });
    const verifier = new GooglePlayVerifier(credentials, fetch, () => NOW);
    await verifier.verify('purchase-token-123');
    await verifier.verify('purchase-token-123');
    const tokenCalls = calls.filter((call) => call.url === 'https://oauth2.googleapis.com/token');
    assert.equal(tokenCalls.length, 1);
    const assertion = new URLSearchParams(tokenCalls[0].init?.body).get('assertion') ?? '';
    const [header, claims, signature] = assertion.split('.');
    const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString());
    assert.equal(decoded.iss, credentials.clientEmail);
    assert.equal(decoded.scope, 'https://www.googleapis.com/auth/androidpublisher');
    assert.ok(cryptoVerify('RSA-SHA256', Buffer.from(`${header}.${claims}`), createPublicKey(googlePrivateKey), Buffer.from(signature, 'base64url')));
    const lookup = calls.find((call) => call.url.includes('subscriptionsv2'));
    assert.equal(lookup?.url, 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.ridercomms.app/purchases/subscriptionsv2/tokens/purchase-token-123');
    assert.equal(lookup?.init?.headers?.Authorization, 'Bearer access-1');
  });

  it('reads the subscription and acknowledges a new purchase', async () => {
    const { fetch, calls } = google({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
      externalAccountIdentifiers: { obfuscatedExternalAccountId: 'ABC-123' },
      lineItems: [{ productId: 'premium_plus_monthly', expiryTime: new Date(NOW + 30 * DAY).toISOString(), autoRenewingPlan: { autoRenewEnabled: true } }],
    });
    const state = await new GooglePlayVerifier(credentials, fetch, () => NOW).verify('purchase-token-123', 'premium_plus_monthly');
    assert.deepEqual(state, {
      platform: 'google',
      originalId: 'purchase-token-123',
      productId: 'premium_plus_monthly',
      tier: 'premium_plus',
      expiresAt: NOW + 30 * DAY,
      active: true,
      willRenew: true,
      accountToken: 'abc-123',
      environment: 'production',
    });
    assert.ok(calls.some((call) => call.url.endsWith('/purchases/subscriptions/premium_plus_monthly/tokens/purchase-token-123:acknowledge') && call.init?.method === 'POST'));
  });

  it('keeps a cancelled subscription until its period ends, and drops expired ones', async () => {
    const run = async (subscriptionState: string, expiry: number) => {
      const { fetch } = google({ subscriptionState, testPurchase: {}, lineItems: [{ productId: 'premium_monthly', expiryTime: new Date(expiry).toISOString() }] });
      return new GooglePlayVerifier(credentials, fetch, () => NOW).verify('purchase-token-123');
    };
    const cancelled = await run('SUBSCRIPTION_STATE_CANCELED', NOW + DAY);
    assert.equal(cancelled.active, true);
    assert.equal(cancelled.willRenew, false);
    assert.equal(cancelled.environment, 'sandbox');
    assert.equal((await run('SUBSCRIPTION_STATE_CANCELED', NOW - 1)).active, false);
    assert.equal((await run('SUBSCRIPTION_STATE_EXPIRED', NOW - DAY)).active, false);
    assert.equal((await run('SUBSCRIPTION_STATE_ON_HOLD', NOW + DAY)).active, false);
    assert.equal((await run('SUBSCRIPTION_STATE_IN_GRACE_PERIOD', NOW + DAY)).active, true);
  });

  it('rejects unknown products, bad tokens and store errors', async () => {
    const unknown = google({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [{ productId: 'coins', expiryTime: new Date(NOW + DAY).toISOString() }] });
    await assert.rejects(new GooglePlayVerifier(credentials, unknown.fetch, () => NOW).verify('purchase-token-123'), { message: 'invalid_transaction' });
    await assert.rejects(new GooglePlayVerifier(credentials, unknown.fetch, () => NOW).verify('bad token/'), { message: 'invalid_transaction' });
    const gone = google({}, (call) => call.url.includes('subscriptionsv2') ? { status: 410 } : null);
    await assert.rejects(new GooglePlayVerifier(credentials, gone.fetch, () => NOW).verify('purchase-token-123'), { message: 'transaction_not_found' });
    const badRequest = google({}, (call) => call.url.includes('subscriptionsv2') ? { status: 400 } : null);
    await assert.rejects(new GooglePlayVerifier(credentials, badRequest.fetch, () => NOW).verify('purchase-token-123'), { message: 'invalid_transaction' });
    const down = google({}, (call) => call.url.includes('subscriptionsv2') ? { status: 503 } : null);
    await assert.rejects(new GooglePlayVerifier(credentials, down.fetch, () => NOW).verify('purchase-token-123'), { message: 'store_unavailable' });
    const noAuth = google({}, (call) => call.url.includes('oauth2') ? { status: 401 } : null);
    await assert.rejects(new GooglePlayVerifier(credentials, noAuth.fetch, () => NOW).verify('purchase-token-123'), { message: 'store_unavailable' });
    const noToken = google({}, (call) => call.url.includes('oauth2') ? { status: 200, body: {} } : null);
    await assert.rejects(new GooglePlayVerifier(credentials, noToken.fetch, () => NOW).verify('purchase-token-123'), { message: 'store_unavailable' });
  });

  it('still returns the subscription when acknowledging fails (retried on the next check)', async () => {
    const { fetch } = google({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
      lineItems: [{ productId: 'premium_monthly', expiryTime: new Date(NOW + DAY).toISOString() }],
    }, (call) => call.url.endsWith(':acknowledge') ? { status: 500 } : null);
    const originalError = console.error;
    console.error = () => undefined;
    try {
      assert.equal((await new GooglePlayVerifier(credentials, fetch, () => NOW).verify('purchase-token-123')).active, true);
    } finally {
      console.error = originalError;
    }
  });
});

describe('store billing configuration', () => {
  it('decodes JWS payloads and rejects malformed ones', () => {
    assert.deepEqual(decodeJwsPayload(jws({ a: 1 })), { a: 1 });
    assert.throws(() => decodeJwsPayload('nope'), StoreVerificationError);
    assert.throws(() => decodeJwsPayload('a.bm90IGpzb24.c'), StoreVerificationError);
  });

  it('builds verifiers only for stores with credentials', () => {
    assert.deepEqual(Object.keys(storeVerifiersFromEnv({})), []);
    const both = storeVerifiersFromEnv({
      APPLE_IAP_KEY_ID: 'KEY',
      APPLE_IAP_ISSUER_ID: 'issuer',
      APPLE_IAP_PRIVATE_KEY: applePrivateKey.replace(/\n/g, '\\n'),
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b.c', private_key: googlePrivateKey }),
    });
    assert.deepEqual(Object.keys(both).sort(), ['apple', 'google']);
    assert.throws(() => parseGoogleServiceAccount('{}', 'com.ridercomms.app'), /client_email/);
  });
});
