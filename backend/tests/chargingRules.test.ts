import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessChargeExposure, type ChargingRule, type ChargeAssessmentInput } from '../src/chargingRules.ts';

// Synthetic, verified-through samples for deterministic contract tests only.
// They are NOT production charge schedules or boundary sources.
const congestionRule: ChargingRule = {
  schemeId: 'london_congestion', unit: 'daily', sourceUrl: 'https://tfl.gov.uk/modes/driving/congestion-charge',
  checkedAt: '2026-01-01T00:00:00Z', effectiveFrom: '2026-01-01', effectiveThrough: '2026-12-31',
  exceptionsReviewedThrough: '2026-12-31', vehicleClasses: ['car', 'van'],
  weeklyWindows: [1, 2, 3, 4, 5].map(dayOfWeek => ({ dayOfWeek, startMinute: 420, endMinute: 1080 }))
    .concat([0, 6].map(dayOfWeek => ({ dayOfWeek, startMinute: 720, endMinute: 1080 }))),
  exceptions: [
    { date: '2026-05-04', periods: [{ startMinute: 720, endMinute: 1080 }] },
    { date: '2026-12-25', periods: [] },
  ],
  waivingStatuses: ['exempt'],
};
const input: ChargeAssessmentInput = {
  schemeId: 'london_congestion', passageAt: '2026-01-05T08:00:00Z',
  vehicleClass: 'car', roadEvidence: 'confirmed_crossing', rule: congestionRule,
};
const run = (updates: Partial<ChargeAssessmentInput> = {}) => assessChargeExposure({ ...input, ...updates });

describe('future road-charge assessment (never used by live routing)', () => {
  it('treats missing, invalid, unsourced or mismatched rule data as unknown', () => {
    assert.equal(run({ rule: undefined }).outcome, 'unknown');
    assert.equal(run({ passageAt: '2026-01-05T08:00:00' }).outcome, 'unknown');
    assert.equal(run({ passageAt: '2026-15-05T08:00:00Z' }).outcome, 'unknown');
    assert.equal(run({ passageAt: '2026-02-30T08:00:00Z' }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, sourceUrl: 'http://example.com' } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, zoneId: 'fake_city' } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, sourceUrl: 'https://' } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, checkedAt: 'broken' } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, effectiveFrom: '2026-02-30' } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, effectiveThrough: '2025-01-01' } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, exceptionsReviewedThrough: 'invalid' } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, schemeId: 'london_ulez' } }).outcome, 'unknown');
    assert.equal(run({ vehicleClass: 'wrong' as ChargeAssessmentInput['vehicleClass'] }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, unit: 'wrong' as ChargingRule['unit'] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, unit: 'per_crossing' } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, waivingStatuses: ['compliant'] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, vehicleClasses: ['wrong' as ChargingRule['vehicleClasses'][number]] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, waivingStatuses: ['paying' as ChargingRule['waivingStatuses'][number]] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, weeklyWindows: [{ dayOfWeek: 7, startMinute: 0, endMinute: 60 }] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, weeklyWindows: [null as unknown as ChargingRule['weeklyWindows'][number]] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, exceptions: [null as unknown as ChargingRule['exceptions'][number]] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, exceptions: [
      { date: '2026-01-05', periods: [null as unknown as ChargingRule['exceptions'][number]['periods'][number]] },
    ] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, weeklyWindows: [{ dayOfWeek: 1, startMinute: 300, endMinute: 200 }] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, exceptions: [{ date: '2026-02-30', periods: [] }] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, exceptions: [{ date: '2026-01-05', periods: [{ startMinute: -1, endMinute: 130 }] }] } }).outcome, 'unknown');
    assert.equal(run({ rule: { ...congestionRule, exceptions: [congestionRule.exceptions[0]!, congestionRule.exceptions[0]!] } }).outcome, 'unknown');
  });
  it('does not extrapolate regulations beyond the verified date range or holiday coverage', () => {
    assert.deepEqual(run({ passageAt: '2027-01-01T09:00:00Z' }), { schemeId: 'london_congestion', outcome: 'unknown', reason: 'outside_verified_period' });
    assert.equal(run({ passageAt: '2025-12-31T09:00:00Z' }).reason, 'outside_verified_period');
    assert.equal(run({ rule: { ...congestionRule, exceptionsReviewedThrough: '2026-01-04' } }).reason, 'outside_verified_period');
  });
  it('rejects uncertain polygon overlap; requires confirmed road-level route evidence', () => {
    assert.equal(run({ roadEvidence: 'unknown' }).reason, 'unverified_road_geometry');
    assert.equal(run({ roadEvidence: 'polygon_overlap' }).reason, 'unverified_road_geometry');
    assert.equal(run({ roadEvidence: 'confirmed_no_crossing' }).outcome, 'not_on_route');
  });
  it('distinguishes vehicle scope before potential charging', () => {
    assert.equal(run({ vehicleClass: 'motorcycle' }).outcome, 'vehicle_not_subject');
    assert.equal(run({ vehicleClass: 'van' }).outcome, 'possible_charge');
  });
  it('uses London-local time, including BST and weekend windows, with an exclusive closing minute', () => {
    assert.equal(run({ passageAt: '2026-01-05T06:59:00Z' }).outcome, 'outside_hours');
    assert.equal(run({ passageAt: '2026-01-05T07:00:00Z' }).outcome, 'possible_charge');
    assert.equal(run({ passageAt: '2026-01-05T18:00:00Z' }).outcome, 'outside_hours');
    assert.equal(run({ passageAt: '2026-07-06T05:59:00Z' }).outcome, 'outside_hours'); // 06:59 BST
    assert.equal(run({ passageAt: '2026-07-06T06:00:00Z' }).outcome, 'possible_charge'); // 07:00 BST
    assert.equal(run({ passageAt: '2026-01-04T11:59:00Z' }).outcome, 'outside_hours');
    assert.equal(run({ passageAt: '2026-01-04T12:00:00Z' }).outcome, 'possible_charge');
  });
  it('respects supplied authority-verified bank holiday and Christmas exceptions', () => {
    assert.equal(run({ passageAt: '2026-05-04T08:00:00+01:00' }).outcome, 'outside_hours');
    assert.equal(run({ passageAt: '2026-05-04T12:00:00+01:00' }).outcome, 'possible_charge');
    assert.equal(run({ passageAt: '2026-12-25T14:00:00Z' }).outcome, 'outside_hours');
  });
  it('accepts only current, same-vehicle, same-scheme operator-verified waivers', () => {
    const official = { schemeId: 'london_congestion' as const, vehicleClass: 'car' as const,
      status: 'exempt' as const, source: 'operator_verified' as const,
      checkedAt: '2026-01-01T12:00:00Z', validThrough: '2026-12-31' };
    assert.equal(run({ entitlement: official }).outcome, 'verified_exempt');
    assert.equal(run({ entitlement: { ...official, source: 'user_declared' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, status: 'discounted' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, status: 'registered' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, status: 'compliant' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, schemeId: 'london_ulez' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, vehicleClass: 'van' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, checkedAt: '2027-01-01T00:00:00Z' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, checkedAt: 'bad' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, validThrough: '2025-12-31' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, validThrough: 'bad' } }).outcome, 'possible_charge');
    assert.equal(run({ entitlement: { ...official, checkedAt: undefined } }).outcome, 'possible_charge');
  });
  it('cannot transfer a verified CAZ exemption between different local authorities', () => {
    const bradford = { ...congestionRule, schemeId: 'uk_caz' as const, zoneId: 'bradford_caz',
      waivingStatuses: ['exempt', 'compliant'] as const };
    const official = { schemeId: 'uk_caz' as const, zoneId: 'bradford_caz', vehicleClass: 'car' as const,
      status: 'exempt' as const, source: 'operator_verified' as const,
      checkedAt: '2026-01-01T00:00:00Z', validThrough: '2026-12-31' };
    assert.equal(run({ schemeId: 'uk_caz', rule: { ...bradford, zoneId: undefined } }).outcome, 'unknown');
    assert.equal(run({ schemeId: 'uk_caz', rule: { ...bradford, zoneId: 'Invalid City Name' } }).outcome, 'unknown');
    assert.equal(run({ schemeId: 'uk_caz', rule: bradford, entitlement: official }).outcome, 'verified_exempt');
    assert.equal(run({ schemeId: 'uk_caz', rule: bradford,
      entitlement: { ...official, zoneId: 'birmingham_caz' } }).outcome, 'possible_charge');
    assert.equal(run({ schemeId: 'uk_caz', rule: bradford,
      entitlement: { ...official, zoneId: undefined } }).outcome, 'possible_charge');
  });
  it('handles emission compliance separately from generic passes and preserves charge units', () => {
    const rule: ChargingRule = { ...congestionRule, schemeId: 'london_ulez', unit: 'daily', waivingStatuses: ['exempt', 'compliant'],
      weeklyWindows: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) };
    const result = run({ schemeId: 'london_ulez', rule, entitlement: {
      schemeId: 'london_ulez', vehicleClass: 'car', status: 'compliant', source: 'operator_verified',
      checkedAt: '2026-01-01T00:00:00Z', validThrough: '2026-11-30',
    } });
    assert.equal(result.outcome, 'verified_exempt');
    assert.equal(result.unit, 'daily');
    assert.equal(result.localDate, '2026-01-05');
    assert.equal(run({ schemeId: 'london_ulez', rule: { ...rule, unit: 'per_crossing' }, entitlement: undefined }).outcome, 'unknown');
    const tunnel: ChargingRule = {
      ...congestionRule, schemeId: 'blackwall_silvertown', unit: 'per_crossing',
      waivingStatuses: ['exempt'],
    };
    const crossing = run({ schemeId: 'blackwall_silvertown', rule: tunnel, entitlement: undefined });
    assert.equal(crossing.outcome, 'possible_charge');
    assert.equal(crossing.unit, 'per_crossing');
    assert.equal(run({ schemeId: 'blackwall_silvertown',
      rule: { ...tunnel, waivingStatuses: ['compliant'] } }).outcome, 'unknown');
  });
});
