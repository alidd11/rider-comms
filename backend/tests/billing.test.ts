import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { appAccountTokenFor, BillingStore, RENEWAL_CHECK_WINDOW_MS } from '../src/billingStore.ts';
import { ProfileStore, effectiveZoneTier } from '../src/profileStore.ts';
import { StoreVerificationError } from '../src/storeBilling.ts';
import type { StoreSubscriptionState, StoreVerifier } from '../src/storeBilling.ts';
import type { BillingStatus } from '@rider-comms/shared';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const DAY = 24 * 60 * 60 * 1000;

/** Stands in for Apple or Google: answers from a table the test controls. */
class FakeVerifier implements StoreVerifier {
  readonly platform: 'apple' | 'google';
  readonly states = new Map<string, StoreSubscriptionState | Error>();
  readonly calls: string[] = [];
  constructor(platform: 'apple' | 'google') { this.platform = platform; }
  set(id: string, overrides: Partial<StoreSubscriptionState>): void {
    this.states.set(id, {
      platform: this.platform,
      originalId: id,
      productId: 'premium_monthly',
      tier: 'premium',
      expiresAt: Date.now() + 30 * DAY,
      active: true,
      willRenew: true,
      accountToken: null,
      environment: 'production',
      ...overrides,
    });
  }
  async verify(id: string): Promise<StoreSubscriptionState> {
    this.calls.push(id);
    const state = this.states.get(id);
    if (!state) throw new StoreVerificationError('transaction_not_found', 404);
    if (state instanceof Error) throw state;
    return state;
  }
}

describe('billing', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed billing tests' }, () => {
  let ctx: TestServer;
  const apple = new FakeVerifier('apple');
  const google = new FakeVerifier('google');
  const billingStore = new BillingStore({ apple, google }, new ProfileStore());

  before(async () => {
    await ensureMigrated();
    process.env.GOOGLE_RTDN_TOKEN = 'rtdn-secret';
    ctx = startTestServer({ billingStore });
    await ctx.ready;
  });
  beforeEach(async () => {
    await getPool().query('DELETE FROM store_subscriptions');
    await getPool().query('DELETE FROM rate_limit_events');
    await getPool().query("DELETE FROM rider_profiles WHERE rider_id LIKE 'billing-%'");
    await getPool().query("DELETE FROM rider_presence WHERE rider_id LIKE 'billing-%'");
    apple.states.clear();
    google.states.clear();
  });
  after(async () => {
    delete process.env.GOOGLE_RTDN_TOKEN;
    await ctx.close();
    await resetDbForTests();
  });

  async function status(riderId: string): Promise<BillingStatus> {
    const res = await authenticatedFetch(ctx, riderId, '/billing');
    assert.equal(res.status, 200);
    return res.json() as Promise<BillingStatus>;
  }

  async function profileTier(riderId: string): Promise<string> {
    const res = await authenticatedFetch(ctx, riderId, `/riders/${riderId}/profile`);
    return ((await res.json()) as { zoneTier: string }).zoneTier;
  }

  it('starts every rider on Free with a stable account token', async () => {
    const result = await status('billing-new');
    assert.equal(result.tier, 'free');
    assert.equal(result.expiresAt, null);
    assert.deepEqual(result.subscriptions, []);
    assert.equal(result.purchasesEnabled, true);
    assert.match(result.appAccountToken, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(result.appAccountToken, appAccountTokenFor('billing-new'));
    assert.notEqual(appAccountTokenFor('billing-new'), appAccountTokenFor('billing-other'));
  });

  it('grants the tier of a verified purchase and widens the Nearby range', async () => {
    const expiresAt = Date.now() + 30 * DAY;
    apple.set('1000', { expiresAt });
    const res = await postJson(ctx, 'billing-apple', '/billing/verify', { platform: 'apple', transactionId: '1000' });
    assert.equal(res.status, 200);
    const result = await res.json() as BillingStatus;
    assert.equal(result.tier, 'premium');
    assert.equal(result.expiresAt, expiresAt);
    assert.deepEqual(result.subscriptions.map((s) => [s.platform, s.productId, s.active]), [['apple', 'premium_monthly', true]]);
    assert.equal(await profileTier('billing-apple'), 'premium');
    await ctx.profileStore.update('billing-apple', { shareLocation: true });
    const presence = await postJson(ctx, 'billing-apple', '/presence', { lat: 51.5, lon: -0.1, accuracyMeters: 8, recordedAt: Date.now() });
    assert.equal((await presence.json() as { radiusMiles: number }).radiusMiles, 6);
  });

  it('uses the best active subscription across stores', async () => {
    apple.set('2000', {});
    google.set('google-token-1', { productId: 'premium_plus_monthly', tier: 'premium_plus' });
    await postJson(ctx, 'billing-both', '/billing/verify', { platform: 'apple', transactionId: '2000' });
    const res = await postJson(ctx, 'billing-both', '/billing/verify', { platform: 'google', purchaseToken: 'google-token-1', productId: 'premium_plus_monthly' });
    assert.equal(((await res.json()) as BillingStatus).tier, 'premium_plus');
    assert.equal(await profileTier('billing-both'), 'premium_plus');
  });

  it('keeps a subscription on the account that verified it first', async () => {
    apple.set('3000', {});
    assert.equal((await postJson(ctx, 'billing-owner', '/billing/verify', { platform: 'apple', transactionId: '3000' })).status, 200);
    const stolen = await postJson(ctx, 'billing-thief', '/billing/verify', { platform: 'apple', transactionId: '3000' });
    assert.equal(stolen.status, 409);
    assert.deepEqual(await stolen.json(), { error: 'subscription_linked_to_another_account' });
    assert.equal(await profileTier('billing-thief'), 'free');
    // Restoring on the same account is fine.
    assert.equal((await postJson(ctx, 'billing-owner', '/billing/verify', { platform: 'apple', transactionId: '3000' })).status, 200);
  });

  it('reads as Free once the paid period has ended, before any sweep', async () => {
    apple.set('4000', { expiresAt: Date.now() + 30 * DAY });
    await postJson(ctx, 'billing-lapse', '/billing/verify', { platform: 'apple', transactionId: '4000' });
    await getPool().query("UPDATE rider_profiles SET zone_tier_expires_at = $1 WHERE rider_id = 'billing-lapse'", [Date.now() - 1]);
    assert.equal(await profileTier('billing-lapse'), 'free');
    assert.equal(effectiveZoneTier('premium', null), 'free');
    assert.equal(effectiveZoneTier('nonsense', Date.now() + DAY), 'free');
    assert.equal(effectiveZoneTier('premium_plus', Date.now() + DAY), 'premium_plus');
  });

  it('rejects bad requests and reports store failures', async () => {
    assert.equal((await postJson(ctx, 'billing-bad', '/billing/verify', { platform: 'amazon' })).status, 400);
    assert.equal((await postJson(ctx, 'billing-bad', '/billing/verify', { platform: 'apple' })).status, 400);
    assert.equal((await postJson(ctx, 'billing-bad', '/billing/verify', { platform: 'google', transactionId: 'x' })).status, 400);
    const missing = await postJson(ctx, 'billing-bad', '/billing/verify', { platform: 'apple', transactionId: '9999' });
    assert.equal(missing.status, 404);
    apple.states.set('5000', new StoreVerificationError('store_unavailable', 502));
    assert.equal((await postJson(ctx, 'billing-bad', '/billing/verify', { platform: 'apple', transactionId: '5000' })).status, 502);
    assert.equal((await fetch(`${ctx.baseUrl()}/billing`)).status, 401);
  });

  it('answers 503 when the store has no credentials configured', async () => {
    const unconfigured = new BillingStore({}, new ProfileStore());
    assert.equal(unconfigured.purchasesEnabled, false);
    await assert.rejects(unconfigured.verifyPurchase('billing-x', 'apple', '1'), { message: 'billing_unavailable' });
    assert.deepEqual(await unconfigured.sweep(), { checked: 0, failed: 0 });
    await unconfigured.refresh('apple', '1');
  });

  it('never lets the app set its own tier', async () => {
    for (const zoneTier of ['premium_plus', 'free']) {
      const res = await authenticatedFetch(ctx, 'billing-hacker', '/riders/billing-hacker/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zoneTier }),
      });
      assert.equal(res.status, 403);
    }
    // An unrelated profile edit doesn't reset a paid tier either.
    apple.set('6000', {});
    await postJson(ctx, 'billing-edit', '/billing/verify', { platform: 'apple', transactionId: '6000' });
    const edit = await authenticatedFetch(ctx, 'billing-edit', '/riders/billing-edit/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unitSystem: 'km' }),
    });
    assert.equal(((await edit.json()) as { zoneTier: string }).zoneTier, 'premium');
  });

  it('re-checks a subscription when Apple sends a notification', async () => {
    apple.set('7000', {});
    await postJson(ctx, 'billing-refund', '/billing/verify', { platform: 'apple', transactionId: '7000' });
    apple.set('7000', { active: false, willRenew: false });
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signedTransactionInfo = `${part({})}.${part({ originalTransactionId: '7000' })}.sig`;
    const signedPayload = `${part({})}.${part({ notificationType: 'REFUND', data: { signedTransactionInfo } })}.sig`;
    const res = await fetch(`${ctx.baseUrl()}/billing/apple/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload }),
    });
    assert.equal(res.status, 200);
    assert.equal(await profileTier('billing-refund'), 'free');

    const malformed = await fetch(`${ctx.baseUrl()}/billing/apple/notifications`, { method: 'POST', body: JSON.stringify({ signedPayload: 'x.y.z' }) });
    assert.equal(malformed.status, 400);
    const missing = await fetch(`${ctx.baseUrl()}/billing/apple/notifications`, { method: 'POST', body: '{}' });
    assert.equal(missing.status, 400);
    // A subscription no account has verified is ignored.
    const unknownInfo = `${part({})}.${part({ originalTransactionId: '123456' })}.sig`;
    const unknown = await fetch(`${ctx.baseUrl()}/billing/apple/notifications`, {
      method: 'POST',
      body: JSON.stringify({ signedPayload: `${part({})}.${part({ data: { signedTransactionInfo: unknownInfo } })}.sig` }),
    });
    assert.equal(unknown.status, 200);
  });

  it('asks Apple to retry when the store is unreachable', async () => {
    apple.set('7500', {});
    await postJson(ctx, 'billing-retry', '/billing/verify', { platform: 'apple', transactionId: '7500' });
    apple.states.set('7500', new StoreVerificationError('store_unavailable', 502));
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signedTransactionInfo = `${part({})}.${part({ originalTransactionId: '7500' })}.sig`;
    const originalError = console.error;
    console.error = () => undefined;
    try {
      const res = await fetch(`${ctx.baseUrl()}/billing/apple/notifications`, {
        method: 'POST',
        body: JSON.stringify({ signedPayload: `${part({})}.${part({ data: { signedTransactionInfo } })}.sig` }),
      });
      assert.equal(res.status, 503);
    } finally {
      console.error = originalError;
    }
  });

  it('re-checks a subscription when Google Play sends a notification, with the shared secret only', async () => {
    google.set('google-token-2', {});
    await postJson(ctx, 'billing-google', '/billing/verify', { platform: 'google', purchaseToken: 'google-token-2' });
    google.set('google-token-2', { active: false });
    const data = Buffer.from(JSON.stringify({ subscriptionNotification: { purchaseToken: 'google-token-2', notificationType: 13 } })).toString('base64');
    const body = JSON.stringify({ message: { data } });
    assert.equal((await fetch(`${ctx.baseUrl()}/billing/google/notifications?token=wrong`, { method: 'POST', body })).status, 403);
    assert.equal(await profileTier('billing-google'), 'premium');
    assert.equal((await fetch(`${ctx.baseUrl()}/billing/google/notifications?token=rtdn-secret`, { method: 'POST', body })).status, 200);
    assert.equal(await profileTier('billing-google'), 'free');
    // Test notifications carry no subscription.
    const test = Buffer.from(JSON.stringify({ testNotification: {} })).toString('base64');
    assert.equal((await fetch(`${ctx.baseUrl()}/billing/google/notifications?token=rtdn-secret`, { method: 'POST', body: JSON.stringify({ message: { data: test } }) })).status, 200);
    assert.equal((await fetch(`${ctx.baseUrl()}/billing/google/notifications?token=rtdn-secret`, { method: 'POST', body: JSON.stringify({ message: { data: '!!!' } }) })).status, 200);
  });

  it('renews or drops subscriptions near their end in the sweep', async () => {
    let now = Date.now();
    const store = new BillingStore({ apple, google }, new ProfileStore(), () => now);
    apple.set('8000', { expiresAt: now + 10 * 60 * 1000 });
    google.set('google-token-3', { expiresAt: now + 10 * 60 * 1000 });
    await store.verifyPurchase('billing-renew', 'apple', '8000');
    await store.verifyPurchase('billing-cancel', 'google', 'google-token-3');

    apple.set('8000', { expiresAt: now + 30 * DAY });
    google.states.delete('google-token-3');
    apple.calls.length = 0;
    const result = await store.sweep();
    assert.deepEqual(result, { checked: 2, failed: 0 });
    assert.equal((await store.status('billing-renew')).tier, 'premium');
    assert.equal((await store.status('billing-cancel')).tier, 'free');

    // Far from renewal: not checked again.
    apple.calls.length = 0;
    now += RENEWAL_CHECK_WINDOW_MS;
    await store.sweep();
    assert.deepEqual(apple.calls, []);

    // A store outage is counted and retried later.
    apple.set('8100', { expiresAt: now + 60 * 1000 });
    await store.verifyPurchase('billing-outage', 'apple', '8100');
    apple.states.set('8100', new StoreVerificationError('store_unavailable', 502));
    const originalError = console.error;
    console.error = () => undefined;
    try {
      assert.deepEqual(await store.sweep(), { checked: 1, failed: 1 });
    } finally {
      console.error = originalError;
    }
  });
});
