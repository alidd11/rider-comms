import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRouteChargeWindows, type RouteChargeWindowPassage } from '../src/routeChargeWindowSummary.ts';
import type { ChargingRule, ChargingSchemeId } from '../src/chargingRules.ts';

// All rules, boundaries and entitlements here are synthetic, not legal data.
const windows = Array.from({ length: 7 }, (_, dayOfWeek) =>
  ({ dayOfWeek, startMinute: 0, endMinute: 1440 }));
const dailyRule: ChargingRule = {
  schemeId: 'london_congestion', unit: 'daily', sourceUrl: 'https://example.org/synthetic-charge',
  checkedAt: '2026-11-22T12:00:00Z', effectiveFrom: '2026-01-01', effectiveThrough: '2026-12-31',
  exceptionsReviewedThrough: '2026-12-31', vehicleClasses: ['car'], weeklyWindows: windows,
  exceptions: [], waivingStatuses: ['exempt'],
};
const event = (eventId: string, extras: Partial<RouteChargeWindowPassage> = {}): RouteChargeWindowPassage => ({
  eventId, schemeId: 'london_congestion', roadEvidence: 'confirmed_crossing', rule: dailyRule,
  earliestPassageAt: '2026-11-23T12:00:00Z', predictedPassageAt: '2026-11-23T12:01:00Z',
  latestPassageAt: '2026-11-23T12:02:00Z', ...extras,
});
const schemeRule = (schemeId: ChargingSchemeId, zoneId?: string): ChargingRule => ({
  ...dailyRule, schemeId, ...(zoneId ? { zoneId } : {}),
  unit: schemeId === 'dart_charge' || schemeId === 'blackwall_silvertown' ? 'per_crossing' : 'daily',
});

describe('offline route multi-charge window projection', () => {
  it('deduplicates observed daily visits but never declares full route coverage', () => {
    const result = summarizeRouteChargeWindows('car', [event('a'), event('b')]);
    assert.equal(result.possibleDailyChargeDays, 1);
    assert.equal(result.possibleCrossingCharges, 0);
    assert.equal(result.unknownEventCount, 0);
    assert.equal(result.routeCoverageComplete, false);
    assert.equal(result.needsVerification, true);
    assert.equal(result.productionApproved, false);
    assert.equal(result.results.length, 2);
  });
  it('counts distinct charging days without combining local midnight', () => {
    const result = summarizeRouteChargeWindows('car', [
      event('day-one', { earliestPassageAt: '2026-11-23T23:40:00Z',
        predictedPassageAt: '2026-11-23T23:41:00Z', latestPassageAt: '2026-11-23T23:42:00Z' }),
      event('day-two', { earliestPassageAt: '2026-11-24T00:10:00Z',
        predictedPassageAt: '2026-11-24T00:11:00Z', latestPassageAt: '2026-11-24T00:12:00Z' }),
    ]);
    assert.equal(result.possibleDailyChargeDays, 2);
    assert.equal(result.unknownEventCount, 0);
  });
  it('never deduplicates separate scheme IDs together', () => {
    const result = summarizeRouteChargeWindows('car', [
      event('congestion'), event('oxford', { schemeId: 'oxford_zez', rule: schemeRule('oxford_zez') }),
    ]);
    assert.equal(result.possibleDailyChargeDays, 2);
  });
  it('preserves authority-specific CAZ identities', () => {
    const result = summarizeRouteChargeWindows('car', [
      event('bradford-a', { schemeId: 'uk_caz', zoneId: 'bradford_caz',
        rule: schemeRule('uk_caz', 'bradford_caz') }),
      event('bradford-b', { schemeId: 'uk_caz', zoneId: 'bradford_caz',
        rule: schemeRule('uk_caz', 'bradford_caz') }),
      event('birmingham', { schemeId: 'uk_caz', zoneId: 'birmingham_caz',
        rule: schemeRule('uk_caz', 'birmingham_caz') }),
    ]);
    assert.equal(result.possibleDailyChargeDays, 2);
    assert.equal(result.unknownEventCount, 0);
  });
  it('counts separate toll crossings independently of daily scheme exposures', () => {
    const result = summarizeRouteChargeWindows('car', [
      event('crossing-east', { schemeId: 'dart_charge', rule: schemeRule('dart_charge') }),
      event('crossing-west', { schemeId: 'dart_charge', rule: schemeRule('dart_charge') }),
      event('daily'),
    ]);
    assert.equal(result.possibleDailyChargeDays, 1);
    assert.equal(result.possibleCrossingCharges, 2);
  });
  it('does not discard an uncertain event because another event was assessed', () => {
    const short = { ...dailyRule,
      weeklyWindows: [{ dayOfWeek: 1, startMinute: 540, endMinute: 600 }] };
    const result = summarizeRouteChargeWindows('car', [
      event('known'),
      event('straddle', { rule: short, earliestPassageAt: '2026-11-23T08:59:00Z',
        predictedPassageAt: '2026-11-23T09:00:00Z', latestPassageAt: '2026-11-23T09:01:00Z' }),
      event('polygon', { roadEvidence: 'polygon_overlap' }),
    ]);
    assert.equal(result.possibleDailyChargeDays, 1);
    assert.equal(result.unknownEventCount, 2);
    assert.equal(result.results[1]?.assessment.status, 'unknown');
    assert.equal(result.routeCoverageComplete, false);
  });
  it('rejects mismatched local authority zone IDs before applying the rule', () => {
    const result = summarizeRouteChargeWindows('car', [
      event('bad-caz', { schemeId: 'uk_caz', zoneId: 'birmingham_caz',
        rule: schemeRule('uk_caz', 'bradford_caz') }),
      event('unscoped-caz', { schemeId: 'uk_caz', rule: schemeRule('uk_caz', 'bradford_caz') }),
      event('injected-zone', { zoneId: 'any_other_zone' }),
    ]);
    assert.equal(result.possibleDailyChargeDays, 0);
    assert.equal(result.unknownEventCount, 3);
    assert.ok(result.results.every(x => x.assessment.status === 'unknown'));
  });
  it('keeps declared passes chargeable; only fresh operator evidence can waive an event', () => {
    const declared = { schemeId: 'london_congestion' as const, vehicleClass: 'car' as const,
      status: 'exempt' as const, source: 'user_declared' as const };
    const verified = { ...declared, source: 'operator_verified' as const,
      checkedAt: '2026-11-22T13:00:00Z', validThrough: '2026-11-23' };
    const result = summarizeRouteChargeWindows('car', [
      event('declared', { entitlement: declared }),
      event('verified', { entitlement: verified }),
    ]);
    assert.equal(result.possibleDailyChargeDays, 1);
    assert.equal(result.results[0]?.assessment.assessment?.outcome, 'possible_charge');
    assert.equal(result.results[1]?.assessment.assessment?.outcome, 'verified_exempt');
    assert.equal(result.productionApproved, false);
  });
  it('does not keep stale data from a prior route assessment on reroute', () => {
    const first = summarizeRouteChargeWindows('car', [event('old-route')]);
    const second = summarizeRouteChargeWindows('car', [
      event('rerouted', { roadEvidence: 'polygon_overlap' }),
    ]);
    assert.equal(first.possibleDailyChargeDays, 1);
    assert.equal(second.possibleDailyChargeDays, 0);
    assert.equal(second.unknownEventCount, 1);
    assert.equal(second.needsVerification, true);
  });
  it('rejects duplicate/invalid event lists instead of quietly double counting', () => {
    assert.equal(summarizeRouteChargeWindows('car', [event('same'), event('same')]).reason,
      'duplicate_event');
    assert.equal(summarizeRouteChargeWindows('car', [event('   ')]).reason,
      'invalid_event_list');
    assert.equal(summarizeRouteChargeWindows('car', Array(257).fill(event('different'))).reason,
      'invalid_event_list');
    assert.deepEqual(summarizeRouteChargeWindows('car', []), {
      possibleDailyChargeDays: 0, possibleCrossingCharges: 0, unknownEventCount: 0,
      routeCoverageComplete: false, needsVerification: true, productionApproved: false,
      reason: 'no_evidence', results: [],
    });
  });
});
