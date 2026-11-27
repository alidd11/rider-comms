import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewDailyDrivingInterval, type DailyDrivingInterval } from '../src/dailyDrivingInterval.ts';
import type { ChargingRule } from '../src/chargingRules.ts';

const rule: ChargingRule = {
  schemeId: 'london_ulez', unit: 'daily', sourceUrl: 'https://tfl.gov.uk/modes/driving/ultra-low-emission-zone',
  checkedAt: '2026-11-20T00:00:00Z', effectiveFrom: '2026-11-01', effectiveThrough: '2026-12-31',
  exceptionsReviewedThrough: '2026-12-31', vehicleClasses: ['motorcycle'],
  weeklyWindows: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })),
  exceptions: [], waivingStatuses: ['exempt'],
};
const base: DailyDrivingInterval = { startedAt: '2026-11-23T23:50:00Z', endedAt: '2026-11-24T00:10:00Z',
  vehicleClass: 'motorcycle', evidence: 'continuous_driving_within_zone', rule };
test('continuous driving across midnight contributes both dates without a new entry', () => {
  assert.deepEqual(reviewDailyDrivingInterval(base), { status: 'advisory_only',
    possibleChargeDates: ['2026-11-23', '2026-11-24'], unknownDates: [],
    routeCoverageComplete: false, productionApproved: false });
});
test('interval end is exclusive, and a calendar exception can remove one date', () => {
  assert.deepEqual(reviewDailyDrivingInterval({ ...base, endedAt: '2026-11-24T00:00:00Z' }).possibleChargeDates, ['2026-11-23']);
  assert.deepEqual(reviewDailyDrivingInterval({ ...base, rule: { ...rule,
    exceptions: [{ date: '2026-11-24', periods: [] }] } }).possibleChargeDates, ['2026-11-23']);
});
test('driving into charging hours while already inside the zone', () => {
  const result = reviewDailyDrivingInterval({ ...base, startedAt: '2026-11-23T06:55:00Z', endedAt: '2026-11-23T07:05:00Z',
    rule: { ...rule, weeklyWindows: [{ dayOfWeek: 1, startMinute: 420, endMinute: 1080 }] } });
  assert.deepEqual(result.possibleChargeDates, ['2026-11-23']);
});
test('unknown coverage, invalid bounds and crossing tariffs cannot clear a daily interval', () => {
  for (const item of [null, { ...base, evidence: 'unknown' }, { ...base, rule: null },
    { ...base, rule: { ...rule, unit: 'per_crossing' } },
    { ...base, rule: { ...rule, schemeId: 'dart_charge' } },
    { ...base, startedAt: 'invalid' }, { ...base, endedAt: 'invalid' },
    { ...base, endedAt: base.startedAt }, { ...base, endedAt: '2026-11-24T03:00:00Z' }]) {
    const result = reviewDailyDrivingInterval(item as DailyDrivingInterval);
    assert.equal(result.status, 'unknown');
    assert.equal(result.productionApproved, false);
  }
});
test('stale or conflicting source dates remain unknown', () => {
  const result = reviewDailyDrivingInterval({ ...base, rule: { ...rule, checkedAt: '2026-09-01T00:00:00Z' } });
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.unknownDates, ['2026-11-23', '2026-11-24']);
});
test('BST midnight uses London calendar rather than UTC day', () => {
  const result = reviewDailyDrivingInterval({ ...base, startedAt: '2026-07-01T23:55:00+01:00',
    endedAt: '2026-07-02T00:05:00+01:00', rule: { ...rule, checkedAt: '2026-07-01T00:00:00Z',
      effectiveFrom: '2026-07-01', effectiveThrough: '2026-07-31', exceptionsReviewedThrough: '2026-07-31' } });
  assert.deepEqual(result.possibleChargeDates, ['2026-07-01', '2026-07-02']);
});
