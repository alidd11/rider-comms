import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { auditChargingHoursAgainstOfficialReference, CHARGING_HOURS_REFERENCES } from '../src/officialChargingHoursReference.ts';
import type { ChargingSchemeId, ChargingRule } from '../src/chargingRules.ts';

const keys: ChargingSchemeId[] = [
  'london_congestion', 'london_ulez', 'london_lez',
  'blackwall_silvertown', 'dart_charge', 'uk_caz', 'oxford_zez',
];
const ruleFor = (schemeId: ChargingSchemeId): Pick<ChargingRule, 'schemeId' | 'unit' | 'weeklyWindows'> => ({
  schemeId, unit: CHARGING_HOURS_REFERENCES[schemeId].expectedUnit,
  weeklyWindows: CHARGING_HOURS_REFERENCES[schemeId].normalWeek,
});
const audit = (rule: ReturnType<typeof ruleFor> | null, date = '2026-11-21') =>
  auditChargingHoursAgainstOfficialReference(rule, date);

describe('offline official-hours comparisons are never legal charge authorisation', () => {
  it('covers all seven distinct schemes and official operator references', () => {
    assert.deepEqual(Object.keys(CHARGING_HOURS_REFERENCES).sort(), [...keys].sort());
    for (const schemeId of keys) {
      const ref = CHARGING_HOURS_REFERENCES[schemeId];
      assert.equal(ref.schemeId, schemeId);
      assert.equal(ref.reviewedAt, '2026-11-21');
      assert.match(ref.sourceUrl, /^https:\/\//);
      assert.ok(Object.isFrozen(ref));
      assert.ok(Object.isFrozen(ref.normalWeek));
      assert.equal(ref.normalWeek.length, 7);
      assert.ok(ref.normalWeek.every(w => Object.isFrozen(w)));
      assert.equal(audit(ruleFor(schemeId)).status, 'matches_reference');
      assert.equal(audit(ruleFor(schemeId)).requiresAuthorityReview, true);
    }
  });
  it('checks varied hours without assuming all charging schemes are 24 hours', () => {
    const congestion = CHARGING_HOURS_REFERENCES.london_congestion;
    assert.deepEqual(congestion.normalWeek.find(w => w.dayOfWeek === 0),
      { dayOfWeek: 0, startMinute: 720, endMinute: 1080 });
    assert.deepEqual(congestion.normalWeek.find(w => w.dayOfWeek === 1),
      { dayOfWeek: 1, startMinute: 420, endMinute: 1080 });
    assert.deepEqual(CHARGING_HOURS_REFERENCES.dart_charge.normalWeek[0],
      { dayOfWeek: 0, startMinute: 360, endMinute: 1320 });
    assert.deepEqual(CHARGING_HOURS_REFERENCES.oxford_zez.normalWeek[0],
      { dayOfWeek: 0, startMinute: 420, endMinute: 1140 });
    assert.match(CHARGING_HOURS_REFERENCES.oxford_zez.caveat, /two- and three-wheelers/);
    assert.match(CHARGING_HOURS_REFERENCES.dart_charge.caveat, /motorcycles and mopeds are free/);
    assert.match(CHARGING_HOURS_REFERENCES.blackwall_silvertown.caveat, /Motorcycles are not automatically free/);
  });
  it('reports missing, empty or contradictory schedule days without marking a charge-free route', () => {
    const original = ruleFor('london_congestion');
    const cases = [
      { ...original, weeklyWindows: original.weeklyWindows.slice(1) },
      { ...original, weeklyWindows: [] },
      { ...original, unit: 'per_crossing' as const },
      { ...original, weeklyWindows: [{ dayOfWeek: 1, startMinute: 0, endMinute: 1440 }, ...original.weeklyWindows.slice(1)] },
      { ...original, weeklyWindows: [null as unknown as ChargingRule['weeklyWindows'][number], ...original.weeklyWindows.slice(1)] },
    ];
    for (const candidate of cases) {
      const result = audit(candidate);
      assert.equal(result.status, 'differs_from_reference');
      assert.equal(result.requiresAuthorityReview, true);
      assert.ok(result.sourceUrl?.startsWith('https://'));
    }
  });
  it('fails closed on unknown schemes and stale, malformed or future reference periods', () => {
    assert.equal(audit(null).status, 'review_required');
    assert.equal(audit({ schemeId: 'fake' as ChargingSchemeId, unit: 'daily', weeklyWindows: [] }).status, 'review_required');
    assert.equal(audit(ruleFor('uk_caz'), '2026-11-20').status, 'review_required');
    assert.equal(audit(ruleFor('uk_caz'), '2026-12-22').status, 'review_required');
    assert.equal(audit(ruleFor('uk_caz'), '2026-02-30').status, 'review_required');
    assert.equal(audit(ruleFor('uk_caz'), 'invalid').status, 'review_required');
    assert.equal(audit(ruleFor('uk_caz'), '2026-12-21').status, 'matches_reference');
    assert.equal(audit({ ...ruleFor('uk_caz'), weeklyWindows: null as unknown as ChargingRule['weeklyWindows'] }).status,
      'differs_from_reference');
  });
  it('never contains fee estimates, verified exemptions or a full-route coverage claim', () => {
    for (const ref of Object.values(CHARGING_HOURS_REFERENCES)) {
      assert.equal('pricePence' in ref, false);
      assert.equal('verifiedVehicle' in ref, false);
      assert.equal('routeCoverageComplete' in ref, false);
    }
  });
});
