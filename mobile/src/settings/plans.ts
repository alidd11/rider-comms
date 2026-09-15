import type { ZoneTier } from '@rider-comms/shared';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';

export interface PlanInfo {
  name: string;
  priceLabel: string;
  billingNote: string;
  blurb: string;
  features: string[];
}

export const PLAN_INFO: Record<ZoneTier, PlanInfo> = {
  free: {
    name: 'Free',
    priceLabel: 'Free',
    billingNote: 'No card required',
    blurb: 'The default — good for a stoplight-to-stoplight ride.',
    features: [`${TIER_RADIUS_MILES.free} mi zone radius`, 'Group rides with a host code', 'Voice chat while riding'],
  },
  premium: {
    name: 'Premium',
    priceLabel: '$4.99',
    billingNote: 'per month, billed monthly',
    blurb: 'Wider net for group rides that spread out on the highway.',
    features: [`${TIER_RADIUS_MILES.premium} mi zone radius`, 'Everything in Free', 'Priority support'],
  },
  premium_plus: {
    name: 'Premium+',
    priceLabel: '$9.99',
    billingNote: 'per month, billed monthly',
    blurb: 'Widest range — for a convoy that has stretched way out.',
    features: [`${TIER_RADIUS_MILES.premium_plus} mi zone radius`, 'Everything in Premium', 'Early access to new features'],
  },
};

export const PLAN_ORDER: ZoneTier[] = ['free', 'premium', 'premium_plus'];

export function isPaidTier(tier: ZoneTier): boolean {
  return tier !== 'free';
}
