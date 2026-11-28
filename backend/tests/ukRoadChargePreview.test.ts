import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { previewUKRoadCharges, type UKRoadChargePreviewInput } from '../src/ukRoadChargePreview.ts';
import type { ChargingRule } from '../src/chargingRules.ts';

const tunnelRule: ChargingRule = {
  schemeId: 'blackwall_silvertown', unit: 'per_crossing',
  sourceUrl: 'https://tfl.gov.uk/modes/driving/silvertown-blackwall-tunnels-charge',
  checkedAt: '2026-11-21T00:00:00Z', effectiveFrom: '2026-01-01',
  effectiveThrough: '2026-12-31', exceptionsReviewedThrough: '2026-12-31',
  vehicleClasses: ['car', 'van', 'motorcycle'],
  weeklyWindows: [{ dayOfWeek: 6, startMinute: 360, endMinute: 1320 }],
  exceptions: [], waivingStatuses: ['exempt'],
};
const sample: UKRoadChargePreviewInput = {
  riderVehicle: 'motorcycle_large',
  chargePassages: [{
    eventId: 'blackwall_crosser', schemeId: 'blackwall_silvertown',
    passageAt: '2026-11-21T12:00:00Z',
    roadEvidence: 'confirmed_crossing', rule: tunnelRule,
  }],
  m6Journeys: [{
    journeyId: 'm6_journey', direction: 'northbound', entry: 'T3', exit: 'T7',
    enteredAt: '2026-11-21T09:00:00Z', exitedAt: '2026-11-21T09:30:00Z',
    riderVehicle: 'motorcycle_large', observedZones: 3,
  }],
  possibleTollInfrastructureIds: ['m6_toll', 'blackwall_silvertown', 'humber_bridge'],
};
describe('draft UK route-level charging preview combines independent fee units', () => {
  it('counts independent motorway trips and crossings without conflating prices', () => {
    const out = previewUKRoadCharges(sample);
    assert.deepEqual(out, {
      status: 'advisory_only',
      possibleDailyChargeDays: 0,
      possibleCrossingCharges: 1,
      possibleM6TollJourneys: 1,
      infrastructureRequiringReview: ['m6_toll', 'blackwall_silvertown', 'humber_bridge'],
      unknownInfrastructureIds: [],
      needsOperatorReview: true,
      completeRouteCoverageVerified: false,
    });
    assert.equal('estimatedPence' in out, false);
    assert.equal('verifiedTollFree' in out, false);
  });
  it('never uses a motorcycle choice to declare all UK bridges and tunnels free', () => {
    const out = previewUKRoadCharges({
      ...sample, chargePassages: [], m6Journeys: [],
      possibleTollInfrastructureIds: ['humber_bridge', 'tyne_tunnels', 'tamar_bridge'],
    });
    assert.equal(out.possibleCrossingCharges + out.possibleM6TollJourneys, 0);
    assert.equal(out.infrastructureRequiringReview.length, 3);
    assert.equal(out.needsOperatorReview, true);
    assert.equal(out.completeRouteCoverageVerified, false);
  });
  it('marks infrastructure absent from the dated England-only reference as unknown', () => {
    const out = previewUKRoadCharges({
      ...sample, possibleTollInfrastructureIds: ['m6_toll', 'unknown_welsh_bridge'],
    });
    assert.deepEqual(out.infrastructureRequiringReview, ['m6_toll']);
    assert.deepEqual(out.unknownInfrastructureIds, ['unknown_welsh_bridge']);
    assert.equal(out.needsOperatorReview, true);
  });
  it('rejects bad arrays, duplicate hints and untrustworthy road labels', () => {
    const invalid = [
      { ...sample, chargePassages: null as unknown as UKRoadChargePreviewInput['chargePassages'] },
      { ...sample, m6Journeys: null as unknown as UKRoadChargePreviewInput['m6Journeys'] },
      { ...sample, m6Journeys: [{ ...sample.m6Journeys[0]!, riderVehicle: 'van' }] },
      { ...sample, m6Journeys: [null as unknown as UKRoadChargePreviewInput['m6Journeys'][number]] },
      { ...sample, possibleTollInfrastructureIds: null as unknown as string[] },
      { ...sample, possibleTollInfrastructureIds: ['m6_toll', 'm6_toll'] },
      { ...sample, possibleTollInfrastructureIds: ['../../toll'] },
      { ...sample, possibleTollInfrastructureIds: Array(129).fill('m6_toll') },
    ];
    for (const item of invalid) {
      const out = previewUKRoadCharges(item);
      assert.equal(out.status, 'invalid_input');
      assert.equal(out.needsOperatorReview, true);
      assert.equal(out.possibleCrossingCharges, 0);
    }
  });
  it('does not silently suppress duplicate or malformed crossing and motorway events', () => {
    const crossing = sample.chargePassages[0]!;
    const motorway = sample.m6Journeys[0]!;
    const invalid = [
      { ...sample, chargePassages: [crossing, crossing] },
      { ...sample, m6Journeys: [motorway, motorway] },
      { ...sample, m6Journeys: [{ ...motorway, entry: 'T2' as typeof motorway.entry }] },
      { ...sample, chargePassages: Array(257).fill(crossing) },
      { ...sample, m6Journeys: Array(65).fill(motorway) },
    ];
    for (const input of invalid) {
      const result = previewUKRoadCharges(input);
      assert.equal(result.status, 'invalid_input');
      assert.equal(result.possibleDailyChargeDays + result.possibleCrossingCharges
        + result.possibleM6TollJourneys, 0);
      assert.equal(result.needsOperatorReview, true);
    }
  });
  it('classifies an unknown vehicle before comparing it with motorway hints', () => {
    for (const riderVehicle of [null, 'motorbike_car', '__proto__', 'scooter', 'moped', {}]) {
      for (const m6Journeys of [sample.m6Journeys, []]) {
        const out = previewUKRoadCharges({ ...sample, riderVehicle, m6Journeys });
        assert.equal(out.status, 'unknown_vehicle');
        assert.equal(out.possibleM6TollJourneys, 0);
        assert.equal(out.completeRouteCoverageVerified, false);
        assert.equal(out.needsOperatorReview, true);
      }
    }
  });
  it('remains incomplete with absolutely no route observations', () => {
    const out = previewUKRoadCharges({
      ...sample, m6Journeys: [], chargePassages: [], possibleTollInfrastructureIds: [],
    });
    assert.equal(out.status, 'advisory_only');
    assert.equal(out.possibleDailyChargeDays, 0);
    assert.equal(out.possibleCrossingCharges, 0);
    assert.equal(out.possibleM6TollJourneys, 0);
    assert.equal(out.needsOperatorReview, true);
    assert.equal(out.completeRouteCoverageVerified, false);
  });
});
