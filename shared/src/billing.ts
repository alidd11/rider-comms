import type { ZoneTier } from './types.ts';

/**
 * Paid plans are auto-renewing monthly subscriptions sold through the App
 * Store and Google Play. The product IDs are the same on both stores; the
 * backend verifies every purchase with the store before granting a tier.
 */
export type PaidZoneTier = Exclude<ZoneTier, 'free'>;

export const SUBSCRIPTION_PRODUCT_IDS: Record<PaidZoneTier, string> = {
  premium: 'premium_monthly',
  premium_plus: 'premium_plus_monthly',
};

/** Fallback prices, shown only until the store returns the local price. */
export const SUBSCRIPTION_FALLBACK_PRICES: Record<PaidZoneTier, string> = {
  premium: '$4.99',
  premium_plus: '$9.99',
};

const TIER_RANK: Record<ZoneTier, number> = { free: 0, premium: 1, premium_plus: 2 };

export function tierForProductId(productId: string): PaidZoneTier | null {
  if (productId === SUBSCRIPTION_PRODUCT_IDS.premium) return 'premium';
  if (productId === SUBSCRIPTION_PRODUCT_IDS.premium_plus) return 'premium_plus';
  return null;
}

export function higherTier(a: ZoneTier, b: ZoneTier): ZoneTier {
  return TIER_RANK[b] > TIER_RANK[a] ? b : a;
}

export function compareTiers(a: ZoneTier, b: ZoneTier): number {
  return TIER_RANK[a] - TIER_RANK[b];
}

export type BillingPlatform = 'apple' | 'google';

export interface BillingSubscription {
  platform: BillingPlatform;
  productId: string;
  tier: PaidZoneTier;
  expiresAt: number;
  active: boolean;
  willRenew: boolean;
}

/** GET /billing and POST /billing/verify response. */
export interface BillingStatus {
  tier: ZoneTier;
  /** When the current paid tier lapses unless renewed; null on Free. */
  expiresAt: number | null;
  /** Passed to the store at purchase so each purchase is tied to this
   * account: Apple's appAccountToken (a UUID) and Google's
   * obfuscatedAccountId. */
  appAccountToken: string;
  subscriptions: BillingSubscription[];
  /** False when the server has no store credentials configured. */
  purchasesEnabled: boolean;
}
