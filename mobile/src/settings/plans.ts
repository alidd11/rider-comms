import type { BillingStatus, PaidZoneTier, ZoneTier } from '@rider-comms/shared';
import { SUBSCRIPTION_FALLBACK_PRICES, SUBSCRIPTION_PRODUCT_IDS, TIER_RADIUS_MILES, compareTiers } from '@rider-comms/shared';

// Plans set the Nearby range. Paid plans are monthly App Store / Google
// Play subscriptions (guideline 3.1.1); the server grants a tier only after
// verifying the purchase with the store.
export interface PlanInfo {
  name: string;
  blurb: string;
  features: string[];
}

export const PLAN_ORDER: ZoneTier[] = ['free', 'premium', 'premium_plus'];

export const PLAN_INFO: Record<ZoneTier, PlanInfo> = {
  free: {
    name: 'Free',
    blurb: 'Good for a stoplight-to-stoplight ride with riders close by.',
    features: [`${TIER_RADIUS_MILES.free} mi Nearby range`, 'Group rides at any distance with a host code', 'Voice chat, navigation and road alerts'],
  },
  premium: {
    name: 'Premium',
    blurb: 'A wider range for group rides that spread out on the highway.',
    features: [`${TIER_RADIUS_MILES.premium} mi Nearby range`, 'Everything in Free'],
  },
  premium_plus: {
    name: 'Premium+',
    blurb: 'The widest range, for a convoy that has stretched way out.',
    features: [`${TIER_RADIUS_MILES.premium_plus} mi Nearby range`, 'Everything in Free'],
  },
};

export function isPaidTier(tier: ZoneTier): tier is PaidZoneTier {
  return tier !== 'free';
}

export type PlanAction = 'current' | 'subscribe' | 'upgrade' | 'downgrade' | 'manage';

export interface PlanOption {
  tier: ZoneTier;
  info: PlanInfo;
  /** "$4.99 / month", or "Free". */
  priceLabel: string;
  action: PlanAction;
}

/**
 * What each plan row shows. `prices` are the store's localised prices by
 * product ID; until they load, the US prices stand in. Moving down to Free
 * is done by cancelling in the store, so it's "manage".
 */
export function planOptions(currentTier: ZoneTier, prices: Record<string, string>): PlanOption[] {
  return PLAN_ORDER.map((tier) => {
    const priceLabel = isPaidTier(tier)
      ? `${prices[SUBSCRIPTION_PRODUCT_IDS[tier]] ?? SUBSCRIPTION_FALLBACK_PRICES[tier]} / month`
      : 'Free';
    let action: PlanAction;
    if (tier === currentTier) action = 'current';
    else if (tier === 'free') action = 'manage';
    else if (currentTier === 'free') action = 'subscribe';
    else action = compareTiers(tier, currentTier) > 0 ? 'upgrade' : 'downgrade';
    return { tier, info: PLAN_INFO[tier], priceLabel, action };
  });
}

/** "Renews 7 Nov 2026" / "Ends 7 Nov 2026" for the current paid plan. */
export function renewalLabel(status: Pick<BillingStatus, 'tier' | 'expiresAt' | 'subscriptions'>, locale?: string): string | null {
  if (!isPaidTier(status.tier) || status.expiresAt === null) return null;
  const date = new Date(status.expiresAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const renews = status.subscriptions.some((subscription) => subscription.active && subscription.tier === status.tier && subscription.willRenew);
  return renews ? `Renews ${date}` : `Ends ${date}`;
}
