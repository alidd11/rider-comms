import type { ZoneTier } from '@rider-comms/shared';
import { TIER_RADIUS_MILES } from '@rider-comms/shared';

// Plans set the Nearby range. Every rider is on Free unless staff assign a
// wider range; nothing is sold in the app. Prices and purchase flows belong
// here only once App Store in-app purchase is connected (guideline 3.1.1).
export interface PlanInfo {
  name: string;
  blurb: string;
  features: string[];
}

export const PLAN_INFO: Record<ZoneTier, PlanInfo> = {
  free: {
    name: 'Free',
    blurb: 'Good for a stoplight-to-stoplight ride with riders close by.',
    features: [`${TIER_RADIUS_MILES.free} mi Nearby range`, 'Group rides with a host code', 'Voice chat while riding'],
  },
  premium: {
    name: 'Premium',
    blurb: 'A wider range for group rides that spread out on the highway.',
    features: [`${TIER_RADIUS_MILES.premium} mi Nearby range`, 'Group rides with a host code', 'Voice chat while riding'],
  },
  premium_plus: {
    name: 'Premium+',
    blurb: 'The widest range, for a convoy that has stretched way out.',
    features: [`${TIER_RADIUS_MILES.premium_plus} mi Nearby range`, 'Group rides with a host code', 'Voice chat while riding'],
  },
};

export function isPaidTier(tier: ZoneTier): boolean {
  return tier !== 'free';
}
