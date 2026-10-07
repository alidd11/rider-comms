import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SUBSCRIPTION_FALLBACK_PRICES, SUBSCRIPTION_PRODUCT_IDS, compareTiers, higherTier, tierForProductId } from '../src/billing.ts';

describe('subscription plans', () => {
  it('maps store product IDs to tiers and nothing else', () => {
    assert.equal(tierForProductId(SUBSCRIPTION_PRODUCT_IDS.premium), 'premium');
    assert.equal(tierForProductId(SUBSCRIPTION_PRODUCT_IDS.premium_plus), 'premium_plus');
    assert.equal(tierForProductId('premium_yearly'), null);
    assert.deepEqual(SUBSCRIPTION_FALLBACK_PRICES, { premium: '$4.99', premium_plus: '$9.99' });
  });

  it('orders tiers Free < Premium < Premium+', () => {
    assert.equal(higherTier('free', 'premium'), 'premium');
    assert.equal(higherTier('premium_plus', 'premium'), 'premium_plus');
    assert.equal(higherTier('premium', 'premium'), 'premium');
    assert.ok(compareTiers('premium_plus', 'free') > 0);
    assert.ok(compareTiers('free', 'premium') < 0);
    assert.equal(compareTiers('premium', 'premium'), 0);
  });
});
