import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BillingStatus } from '@rider-comms/shared';
import { PLAN_INFO, isPaidTier, planOptions, renewalLabel } from '../src/settings/plans.ts';
import {
  linkedElsewhereMessage,
  PRODUCT_IDS,
  purchaseToReplace,
  restoreMessage,
  restorePurchases,
  verifyAndFinish,
  verifyRequestFor,
} from '../src/billing/subscriptionFlow.ts';
import type { BillingApi, StoreAdapter, StorePurchase, VerifyRequest } from '../src/billing/subscriptionFlow.ts';

const FREE: BillingStatus = { tier: 'free', expiresAt: null, appAccountToken: 'token', subscriptions: [], purchasesEnabled: true };
const PREMIUM: BillingStatus = {
  ...FREE,
  tier: 'premium',
  expiresAt: Date.UTC(2026, 10, 7),
  subscriptions: [{ platform: 'apple', productId: 'premium_monthly', tier: 'premium', expiresAt: Date.UTC(2026, 10, 7), active: true, willRenew: true }],
};

function purchase(overrides: Partial<StorePurchase> = {}): StorePurchase {
  return { platform: 'apple', productId: 'premium_monthly', transactionId: '1000', purchaseToken: null, raw: {}, ...overrides };
}

function fakeStore(purchases: StorePurchase[] = [], finishFails = false): StoreAdapter & { finished: StorePurchase[] } {
  const finished: StorePurchase[] = [];
  return {
    finished,
    platform: 'apple',
    connect: async () => true,
    disconnect: async () => undefined,
    loadProducts: async () => [],
    purchase: async () => undefined,
    availablePurchases: async () => purchases,
    finish: async (p) => {
      if (finishFails) throw new Error('already acknowledged');
      finished.push(p);
    },
    manageSubscriptions: async () => undefined,
    onPurchase: () => () => undefined,
    onError: () => () => undefined,
  };
}

function apiError(status: number, error: string): Error & { status: number; body: unknown } {
  return Object.assign(new Error(error), { status, body: { error } });
}

function fakeApi(answer: (request: VerifyRequest) => BillingStatus | Error): BillingApi & { requests: VerifyRequest[] } {
  const requests: VerifyRequest[] = [];
  return {
    requests,
    getBilling: async () => FREE,
    verifyPurchase: async (request) => {
      requests.push(request);
      const result = answer(request);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('plan options', () => {
  it('lists Free, Premium and Premium+ with store prices, falling back to US prices', () => {
    const options = planOptions('free', { premium_monthly: '£4.49' });
    assert.deepEqual(options.map((option) => [option.tier, option.priceLabel, option.action]), [
      ['free', 'Free', 'current'],
      ['premium', '£4.49 / month', 'subscribe'],
      ['premium_plus', '$9.99 / month', 'subscribe'],
    ]);
    assert.equal(options[1].info.features[0], '6 mi Nearby range');
    assert.equal(PLAN_INFO.premium_plus.features[0], '20 mi Nearby range');
  });

  it('offers upgrades, downgrades and cancelling back to Free from a paid plan', () => {
    assert.deepEqual(planOptions('premium', {}).map((option) => option.action), ['manage', 'current', 'upgrade']);
    assert.deepEqual(planOptions('premium_plus', {}).map((option) => option.action), ['manage', 'downgrade', 'current']);
    assert.equal(isPaidTier('free'), false);
    assert.equal(isPaidTier('premium_plus'), true);
  });

  it('says whether the current plan renews or ends', () => {
    assert.equal(renewalLabel(FREE), null);
    assert.match(renewalLabel(PREMIUM, 'en-GB') ?? '', /^Renews 7 Nov 2026$/);
    const cancelled = { ...PREMIUM, subscriptions: [{ ...PREMIUM.subscriptions[0], willRenew: false }] };
    assert.match(renewalLabel(cancelled, 'en-GB') ?? '', /^Ends /);
    assert.equal(renewalLabel({ ...PREMIUM, expiresAt: null }), null);
  });
});

describe('purchase verification', () => {
  it('sends Apple transaction IDs and Google purchase tokens', () => {
    assert.deepEqual(verifyRequestFor(purchase()), { platform: 'apple', transactionId: '1000' });
    assert.deepEqual(
      verifyRequestFor(purchase({ platform: 'google', transactionId: null, purchaseToken: 'tok', productId: 'premium_plus_monthly' })),
      { platform: 'google', purchaseToken: 'tok', productId: 'premium_plus_monthly' },
    );
    assert.equal(verifyRequestFor(purchase({ transactionId: null })), null);
    assert.deepEqual(PRODUCT_IDS, ['premium_monthly', 'premium_plus_monthly']);
  });

  it('finishes the transaction only after the server has verified it', async () => {
    const store = fakeStore();
    const api = fakeApi(() => PREMIUM);
    const outcome = await verifyAndFinish(store, api, purchase());
    assert.deepEqual(outcome, { kind: 'verified', status: PREMIUM });
    assert.equal(store.finished.length, 1);
  });

  it('leaves a purchase unfinished when the server can’t check it, so the store re-delivers it', async () => {
    const store = fakeStore();
    const offline = await verifyAndFinish(store, fakeApi(() => new Error('Network request failed')), purchase());
    assert.equal(offline.kind, 'failed');
    const unavailable = await verifyAndFinish(store, fakeApi(() => apiError(503, 'billing_unavailable')), purchase());
    assert.equal(unavailable.kind, 'failed');
    assert.match(unavailable.kind === 'failed' ? unavailable.message : '', /haven’t been charged/);
    assert.equal(store.finished.length, 0);
    assert.equal((await verifyAndFinish(store, fakeApi(() => PREMIUM), purchase({ transactionId: null }))).kind, 'failed');
  });

  it('finishes a purchase that belongs to another account and says so', async () => {
    const store = fakeStore();
    const outcome = await verifyAndFinish(store, fakeApi(() => apiError(409, 'subscription_linked_to_another_account')), purchase());
    assert.deepEqual(outcome, { kind: 'linked_elsewhere' });
    assert.equal(store.finished.length, 1);
    assert.match(linkedElsewhereMessage(), /another Rider Comms account/);
  });

  it('ignores other products and tolerates an already-finished transaction', async () => {
    const api = fakeApi(() => PREMIUM);
    assert.deepEqual(await verifyAndFinish(fakeStore(), api, purchase({ productId: 'coins' })), { kind: 'ignored' });
    assert.equal(api.requests.length, 0);
    assert.equal((await verifyAndFinish(fakeStore([], true), api, purchase())).kind, 'verified');
  });
});

describe('restore purchases', () => {
  it('re-links every subscription the store account owns', async () => {
    const store = fakeStore([purchase(), purchase({ productId: 'coins' })]);
    const api = fakeApi(() => PREMIUM);
    const result = await restorePurchases(store, api);
    assert.deepEqual(result, { status: PREMIUM, restored: 1, linkedElsewhere: 0, failed: 0 });
    assert.equal(api.requests.length, 1);
    assert.equal(restoreMessage(result), 'Your subscription is restored.');
  });

  it('explains when nothing was restored', async () => {
    const none = await restorePurchases(fakeStore(), fakeApi(() => PREMIUM));
    assert.deepEqual(none, { status: FREE, restored: 0, linkedElsewhere: 0, failed: 0 });
    assert.match(restoreMessage(none), /No subscription was found/);
    const elsewhere = await restorePurchases(fakeStore([purchase()]), fakeApi(() => apiError(409, 'subscription_linked_to_another_account')));
    assert.equal(elsewhere.linkedElsewhere, 1);
    assert.match(restoreMessage(elsewhere), /belongs to another Rider Comms account/);
    const failed = await restorePurchases(fakeStore([purchase()]), fakeApi(() => new Error('offline')));
    assert.equal(failed.failed, 1);
    assert.match(restoreMessage(failed), /couldn’t reach the store/);
  });
});

describe('changing plan on Google Play', () => {
  it('replaces the current Google subscription, and nothing on the App Store', () => {
    const current = purchase({ platform: 'google', transactionId: null, purchaseToken: 'old', productId: 'premium_monthly' });
    assert.equal(purchaseToReplace([current], 'premium_plus'), current);
    assert.equal(purchaseToReplace([current], 'premium'), null);
    assert.equal(purchaseToReplace([purchase()], 'premium_plus'), null);
    assert.equal(purchaseToReplace([], 'premium'), null);
  });
});
