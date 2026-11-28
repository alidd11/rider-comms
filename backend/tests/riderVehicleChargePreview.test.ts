import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRiderVehicleForCharging, previewRiderChargeExposure } from '../src/riderVehicleChargePreview.ts';
import type { ChargingRule } from '../src/chargingRules.ts';
import type { RouteChargePassage } from '../src/routeChargeSummary.ts';

const congestion: ChargingRule = {
  schemeId: 'london_congestion', unit: 'daily',
  sourceUrl: 'https://tfl.gov.uk/modes/driving/congestion-charge',
  checkedAt: '2026-11-21T00:00:00Z',
  effectiveFrom: '2026-01-01', effectiveThrough: '2026-12-31',
  exceptionsReviewedThrough: '2026-12-31',
  vehicleClasses: ['car', 'van'],
  weeklyWindows: [{ dayOfWeek: 1, startMinute: 420, endMinute: 1080 }],
  exceptions: [], waivingStatuses: ['exempt'],
};
const passage: RouteChargePassage = {
  eventId: 'crossing-a', schemeId: 'london_congestion',
  passageAt: '2026-11-23T10:00:00Z', roadEvidence: 'confirmed_crossing',
  rule: congestion,
};
describe('offline Rider Comms vehicle category to charge preview', () => {
  it('maps unambiguous coarse categories and withholds unresolved scooter classification', () => {
    assert.deepEqual([
      'motorcycle_large', 'motorcycle_small', 'scooter', 'car', 'van',
    ].map(selection => classifyRiderVehicleForCharging(selection)), [
      { selection: 'motorcycle_large', chargeClass: 'motorcycle', officialEligibilityVerified: false },
      { selection: 'motorcycle_small', chargeClass: 'motorcycle', officialEligibilityVerified: false },
      null,
      { selection: 'car', chargeClass: 'car', officialEligibilityVerified: false },
      { selection: 'van', chargeClass: 'van', officialEligibilityVerified: false },
    ]);
  });
  it('never accepts an invalid vehicle or a prototype property as a known type', () => {
    for (const invalid of [undefined, null, '', 'unknown', 'heavy', 'bicycle',
      '__proto__', 'constructor', 'scooter', 'moped', 0, {}, ['car']]) {
      assert.equal(classifyRiderVehicleForCharging(invalid), null);
      assert.deepEqual(previewRiderChargeExposure(invalid, [passage]), {
        status: 'unknown_vehicle', classification: null, summary: null,
        requiresOfficialVehicleCheck: true,
      });
    }
  });
  it('maps selections only to possible charge exposure, never a verified exemption', () => {
    const motorcycle = previewRiderChargeExposure('motorcycle_small', [passage]);
    assert.equal(motorcycle.status, 'advisory_only');
    if (motorcycle.status !== 'advisory_only') return;
    assert.equal(motorcycle.classification.officialEligibilityVerified, false);
    assert.equal(motorcycle.summary.possibleDailyChargeDays, 0);
    assert.equal(motorcycle.summary.routeCoverageComplete, false);
    assert.equal(motorcycle.summary.needsVerification, true);
    assert.equal(motorcycle.requiresOfficialVehicleCheck, true);
    const car = previewRiderChargeExposure('car', [passage]);
    assert.equal(car.status, 'advisory_only');
    if (car.status !== 'advisory_only') return;
    assert.equal(car.summary.possibleDailyChargeDays, 1);
    assert.equal(car.summary.routeCoverageComplete, false);
    assert.equal(car.requiresOfficialVehicleCheck, true);
  });
  it('does not infer any fee or emission status even with no observations', () => {
    const van = previewRiderChargeExposure('van', []);
    assert.equal(van.status, 'advisory_only');
    if (van.status !== 'advisory_only') return;
    assert.equal(van.summary.reason, 'no_evidence');
    assert.equal(van.summary.needsVerification, true);
    assert.equal(van.summary.possibleDailyChargeDays, 0);
    assert.equal('price' in van, false);
    assert.equal('compliant' in van.classification, false);
  });
  it('preserves road-specific and authority-specific rules for known vehicle classes', () => {
    const tunnel: ChargingRule = {
      ...congestion, schemeId: 'blackwall_silvertown', unit: 'per_crossing',
      vehicleClasses: ['motorcycle', 'car', 'van'],
    };
    const scooter = previewRiderChargeExposure('motorcycle_small', [
      { ...passage, schemeId: 'blackwall_silvertown', rule: tunnel },
    ]);
    assert.equal(scooter.status, 'advisory_only');
    if (scooter.status !== 'advisory_only') return;
    assert.equal(scooter.summary.possibleCrossingCharges, 1);
    assert.equal(scooter.summary.needsVerification, true);
  });
});
