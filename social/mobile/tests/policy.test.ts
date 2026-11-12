import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEligibility, ukPlanningPolicy } from '../src/policy.ts';

const eligibleAdult = {
  country: 'GB',
  verifiedAgeFloor: 18 as const,
  verificationCurrent: true,
  accountInGoodStanding: true,
  securityChecksPassed: true,
};

test('unknown and unverified ages cannot bypass the social age gate', () => {
  assert.equal(checkEligibility({ ...eligibleAdult, verifiedAgeFloor: 0 }, 'social-access', ukPlanningPolicy), 'age-restricted');
  assert.equal(checkEligibility({ ...eligibleAdult, verificationCurrent: false }, 'social-access', ukPlanningPolicy), 'age-check-required');
});

test('UK 16–17 users can enter social but cannot livestream, gift, or earn under proposed product rules', () => {
  const teen = { ...eligibleAdult, verifiedAgeFloor: 16 as const };
  assert.equal(checkEligibility(teen, 'social-access', ukPlanningPolicy), 'allowed');
  for (const feature of ['create-livestream', 'receive-creator-payouts', 'send-virtual-gifts'] as const) {
    assert.equal(checkEligibility(teen, feature, ukPlanningPolicy), 'age-restricted');
  }
});

test('an adult must pass current checks, and out-of-market registration stays unavailable', () => {
  assert.equal(checkEligibility(eligibleAdult, 'create-livestream', ukPlanningPolicy), 'allowed');
  assert.equal(checkEligibility({ ...eligibleAdult, accountInGoodStanding: false }, 'create-livestream', ukPlanningPolicy), 'account-restricted');
  assert.equal(checkEligibility({ ...eligibleAdult, securityChecksPassed: false }, 'create-livestream', ukPlanningPolicy), 'account-restricted');
  assert.equal(checkEligibility({ ...eligibleAdult, country: 'US' }, 'social-access', ukPlanningPolicy), 'region-unavailable');
});

test('minimum ages are policy inputs, not hardcoded checks across screens', () => {
  assert.equal(checkEligibility({ ...eligibleAdult, verifiedAgeFloor: 16 }, 'create-livestream', {
    ...ukPlanningPolicy, minimumLivestreamAge: 16
  }), 'allowed');
});
