/**
 * Demo/planning-only capability policy. Authoritative checks must be server-side
 * once authentication and jurisdiction-specific age assurance are integrated.
 * The UK's proposed thresholds are CONFIGURATION, not a statement of enacted law.
 */
export type AgeAssurance = { verifiedAgeFloor: 0 | 16 | 18; verificationCurrent: boolean };
export type Eligibility = AgeAssurance & {
  country: string;
  accountInGoodStanding: boolean;
  securityChecksPassed: boolean;
};

export type Capability = 'social-access' | 'create-livestream' | 'receive-creator-payouts' | 'send-virtual-gifts';
export type SocialAgePolicy = {
  enabledCountries: readonly string[];
  minimumSocialAge: 16 | 18;
  minimumLivestreamAge: 16 | 18;
  minimumEarningsAge: 16 | 18;
  minimumGiftingAge: 16 | 18;
};

export const ukPlanningPolicy: SocialAgePolicy = {
  enabledCountries: ['GB'],
  minimumSocialAge: 16,
  minimumLivestreamAge: 18,
  minimumEarningsAge: 18,
  minimumGiftingAge: 18
};

export type EligibilityDecision = 'allowed' | 'region-unavailable' | 'age-check-required' | 'age-restricted' | 'account-restricted';

export function checkEligibility(
  actor: Eligibility,
  capability: Capability,
  policy: SocialAgePolicy
): EligibilityDecision {
  if (!policy.enabledCountries.includes(actor.country)) return 'region-unavailable';
  if (!actor.verificationCurrent) return 'age-check-required';
  const minimumAge = capability === 'social-access' ? policy.minimumSocialAge
    : capability === 'create-livestream' ? policy.minimumLivestreamAge
    : capability === 'receive-creator-payouts' ? policy.minimumEarningsAge
    : policy.minimumGiftingAge;
  if (actor.verifiedAgeFloor < minimumAge) return 'age-restricted';
  if (!actor.accountInGoodStanding || !actor.securityChecksPassed) return 'account-restricted';
  return 'allowed';
}
