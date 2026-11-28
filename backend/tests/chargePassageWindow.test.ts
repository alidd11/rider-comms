import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessChargePassageWindow, MAX_CHARGE_PASSAGE_UNCERTAINTY_MINUTES,
  type ChargePassageWindowInput } from '../src/chargePassageWindow.ts';
import type { ChargingRule } from '../src/chargingRules.ts';

// Synthetic weekly schedules: NOT a published UK scheme or actual legal rule.
const rule: ChargingRule = {
  schemeId: 'london_congestion', unit: 'daily', sourceUrl: 'https://example.org/fictional-charge-fixture',
  checkedAt: '2026-11-22T12:00:00Z', effectiveFrom: '2026-01-01', effectiveThrough: '2026-12-31',
  exceptionsReviewedThrough: '2026-12-31', vehicleClasses: ['car'],
  weeklyWindows: Array.from({ length: 7 }, (_, dayOfWeek) =>
    ({ dayOfWeek, startMinute: 540, endMinute: 600 })),
  exceptions: [], waivingStatuses: ['exempt'],
};
const input: ChargePassageWindowInput = {
  schemeId: 'london_congestion', vehicleClass: 'car', roadEvidence: 'confirmed_crossing', rule,
  earliestPassageAt: '2026-11-23T09:10:00Z', predictedPassageAt: '2026-11-23T09:12:00Z',
  latestPassageAt: '2026-11-23T09:15:00Z',
};
const run = (change: Partial<ChargePassageWindowInput> = {}) =>
  assessChargePassageWindow({ ...input, ...change });
const allDayRule: ChargingRule = { ...rule,
  weeklyWindows: Array.from({ length: 7 }, (_, dayOfWeek) =>
    ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) };

describe('future-only individual charging-passage uncertainty window', () => {
  it('returns a consistent POSSIBLE charge but never a full-route clearance', () => {
    const result = run();
    assert.equal(result.status, 'consistent');
    assert.equal(result.reason, 'consistent_observed_rule');
    assert.equal(result.assessment?.outcome, 'possible_charge');
    assert.equal(result.assessment?.localDate, '2026-11-23');
    assert.equal(result.routeCoverageComplete, false);
    assert.equal(result.requiresIndependentRoadAndAuthorityReview, true);
    assert.equal(result.productionApproved, false);
  });
  it('detects opening and closing boundaries even a millisecond apart', () => {
    for (const [earliestPassageAt, predictedPassageAt, latestPassageAt] of [
      ['2026-11-23T08:59:59.999Z', '2026-11-23T09:00:00Z', '2026-11-23T09:00:00.001Z'],
      ['2026-11-23T09:59:59.999Z', '2026-11-23T10:00:00Z', '2026-11-23T10:00:00.001Z'],
    ]) {
      const result = run({ earliestPassageAt, predictedPassageAt, latestPassageAt });
      assert.equal(result.status, 'unknown');
      assert.equal(result.assessment, undefined);
    }
  });
  it('checks intervening minutes when both endpoints are outside hours', () => {
    const result = run({ earliestPassageAt: '2026-11-23T08:55:00Z',
      predictedPassageAt: '2026-11-23T08:56:00Z', latestPassageAt: '2026-11-23T10:05:00Z' });
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'unverified_or_conflicting_exposure');
  });
  it('does not silently combine two local calendar days into one daily exposure', () => {
    const result = run({ rule: allDayRule, earliestPassageAt: '2026-11-23T23:58:00Z',
      predictedPassageAt: '2026-11-23T23:59:00Z', latestPassageAt: '2026-11-24T00:02:00Z' });
    assert.equal(result.status, 'unknown');
    const summer = { ...allDayRule, checkedAt: '2026-07-05T12:00:00Z' };
    assert.equal(run({ rule: summer, earliestPassageAt: '2026-07-06T22:58:00Z',
      predictedPassageAt: '2026-07-06T22:59:00Z', latestPassageAt: '2026-07-06T23:02:00Z' }).status,
    'unknown');
  });
  it('fails closed over the repeated UK autumn clock hour', () => {
    const october = { ...allDayRule, checkedAt: '2026-10-24T12:00:00Z' };
    const result = run({ rule: october, earliestPassageAt: '2026-10-25T00:58:00Z',
      predictedPassageAt: '2026-10-25T00:59:00Z', latestPassageAt: '2026-10-25T01:02:00Z' });
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'uk_clock_transition');
  });
  it('rejects unverified geometry and stale authority review', () => {
    assert.equal(run({ roadEvidence: 'polygon_overlap' }).status, 'unknown');
    assert.equal(run({ rule: { ...rule, checkedAt: '2026-09-01T00:00:00Z' } }).status, 'unknown');
  });
  it('never upgrades a rider-declared pass to verified exemption', () => {
    const entitlement = { schemeId: 'london_congestion' as const, vehicleClass: 'car' as const,
      source: 'user_declared' as const, status: 'exempt' as const };
    assert.equal(run({ entitlement }).assessment?.outcome, 'possible_charge');
  });
  it('accepts only operator-verified and current exemptions for the whole window', () => {
    const entitlement = { schemeId: 'london_congestion' as const, vehicleClass: 'car' as const,
      source: 'operator_verified' as const, status: 'exempt' as const,
      checkedAt: '2026-11-22T13:00:00Z', validThrough: '2026-11-23' };
    assert.equal(run({ entitlement }).assessment?.outcome, 'verified_exempt');
    assert.equal(run({ entitlement: { ...entitlement, checkedAt: '2026-11-25T13:00:00Z' } })
      .assessment?.outcome, 'possible_charge');
  });
  it('rejects malformed, reversed, non-covering and oversized windows', () => {
    const invalid: Partial<ChargePassageWindowInput>[] = [
      { earliestPassageAt: '2026-11-23T09:00:00' },
      { earliestPassageAt: '2026-11-23T24:00:00Z' },
      { earliestPassageAt: '2026-11-23T09:16:00Z' },
      { predictedPassageAt: '2026-11-23T09:16:00Z' },
      { latestPassageAt: '2026-11-23T09:11:00Z' },
      { earliestPassageAt: '2026-11-23T08:00:00Z', latestPassageAt: '2026-11-23T10:01:00Z' },
    ];
    for (const value of invalid) {
      const result = run(value);
      assert.equal(result.status, 'unknown');
      assert.equal(result.reason, 'invalid_or_unbounded_window');
      assert.equal(result.assessment, undefined);
    }
    assert.equal(MAX_CHARGE_PASSAGE_UNCERTAINTY_MINUTES, 120);
  });
  it('treats an exactly known instant as a bounded window, not full-route proof', () => {
    const result = run({ earliestPassageAt: input.predictedPassageAt,
      latestPassageAt: input.predictedPassageAt });
    assert.equal(result.status, 'consistent');
    assert.equal(result.routeCoverageComplete, false);
  });
  it('rejects an interval over the UK spring clock change', () => {
    const march = { ...allDayRule, checkedAt: '2026-03-28T12:00:00Z' };
    const result = run({ rule: march, earliestPassageAt: '2026-03-29T00:59:00Z',
      predictedPassageAt: '2026-03-29T01:00:00Z', latestPassageAt: '2026-03-29T01:02:00Z' });
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'uk_clock_transition');
  });
  it('honours a local date exception even if weekly rules are all day', () => {
    const holiday = { ...allDayRule, exceptions: [{ date: '2026-11-23', periods: [] }] };
    const closed = run({ rule: holiday });
    assert.equal(closed.status, 'consistent');
    assert.equal(closed.assessment?.outcome, 'outside_hours');
    const crossingMidnight = run({ rule: holiday,
      earliestPassageAt: '2026-11-23T23:59:00Z',
      predictedPassageAt: '2026-11-24T00:00:00Z',
      latestPassageAt: '2026-11-24T00:01:00Z' });
    assert.equal(crossingMidnight.status, 'unknown');
  });
  it('fails closed if source freshness expires inside the passage interval', () => {
    const expiresAt = { ...allDayRule, checkedAt: '2026-10-24T09:12:00Z' };
    const result = run({ rule: expiresAt,
      earliestPassageAt: '2026-11-23T09:11:59.999Z',
      predictedPassageAt: '2026-11-23T09:12:00Z',
      latestPassageAt: '2026-11-23T09:12:00.001Z' });
    assert.equal(result.status, 'unknown');
    assert.equal(result.assessment, undefined);
  });
  it('fails closed if operator entitlement review expires inside the interval', () => {
    const entitlement = { schemeId: 'london_congestion' as const,
      vehicleClass: 'car' as const, source: 'operator_verified' as const,
      status: 'exempt' as const, checkedAt: '2026-11-16T09:12:00Z',
      validThrough: '2026-11-23' };
    const result = run({ rule: allDayRule, entitlement,
      earliestPassageAt: '2026-11-23T09:11:59.999Z',
      predictedPassageAt: '2026-11-23T09:12:00Z',
      latestPassageAt: '2026-11-23T09:12:00.001Z' });
    assert.equal(result.status, 'unknown');
    assert.equal(result.assessment, undefined);
  });
});
