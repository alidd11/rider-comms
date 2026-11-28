import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRouteChargePassages, screenChargeAreasForRoute, type RouteChargePassage } from '../src/routeChargeSummary.ts';
import type { ChargingRule } from '../src/chargingRules.ts';
import { compileChargeZoneGeoJson } from '../src/chargeZoneGeometry.ts';

const dailyRule: ChargingRule = {
  schemeId: 'london_congestion', unit: 'daily', sourceUrl: 'https://tfl.gov.uk/modes/driving/congestion-charge',
  checkedAt: '2026-01-01T00:00:00Z', effectiveFrom: '2026-01-01', effectiveThrough: '2026-12-31',
  exceptionsReviewedThrough: '2026-12-31', vehicleClasses: ['car', 'van'],
  weeklyWindows: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })),
  exceptions: [], waivingStatuses: ['exempt'],
};
const event = (eventId: string, extras: Partial<RouteChargePassage> = {}): RouteChargePassage => {
  const entry: RouteChargePassage = {
    eventId, schemeId: 'london_congestion', passageAt: '2026-07-06T07:00:00Z',
    roadEvidence: 'confirmed_crossing', rule: dailyRule, ...extras,
  };
  // Use synthetic, timely authority checks for each distinct passage date.
  const time = Date.parse(entry.passageAt);
  if (entry.rule?.checkedAt === dailyRule.checkedAt && Number.isFinite(time))
    entry.rule = { ...entry.rule, checkedAt: new Date(time - 86400000).toISOString() };
  return entry;
};

describe('offline future-route charging summary', () => {
  it('counts a daily charge only once for repeated visits that London day', () => {
    const output = summarizeRouteChargePassages('car', [
      event('first'), event('second', { passageAt: '2026-07-06T21:00:00Z' }),
      event('third', { passageAt: '2026-07-06T23:00:00Z' }),
    ]);
    assert.equal(output.possibleDailyChargeDays, 2); // 23:00 UTC is midnight BST on Tuesday
    assert.equal(output.possibleCrossingCharges, 0);
    assert.equal(output.needsVerification, true);
    assert.equal(output.routeCoverageComplete, false);
  });
  it('rejects non-CAZ zone IDs so arbitrary labels cannot inflate daily counts', () => {
    const output = summarizeRouteChargePassages('car', [
      event('a', { zoneId: 'fake_a' }), event('b', { zoneId: 'fake_b' }),
      event('c', { rule: { ...dailyRule, zoneId: 'fake_c' } }),
    ]);
    assert.equal(output.possibleDailyChargeDays, 0);
    assert.equal(output.needsVerification, true);
    assert.ok(output.results.every(result => result.assessment.outcome === 'unknown'));
    assert.equal(summarizeRouteChargePassages('car', [event('clean')]).possibleDailyChargeDays, 1);
  });
  it('keeps the separate Oxford ZEZ as one daily charge exposure, not a UK CAZ', () => {
    const oxfordRule: ChargingRule = {
      ...dailyRule, schemeId: 'oxford_zez',
      vehicleClasses: ['motorcycle', 'car'],
      sourceUrl: 'https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/charges-oxfords-zez',
    };
    const out = summarizeRouteChargePassages('motorcycle', [
      event('oxford-in', { schemeId: 'oxford_zez', rule: oxfordRule }),
      event('oxford-again', { schemeId: 'oxford_zez', rule: oxfordRule }),
    ]);
    assert.equal(out.possibleDailyChargeDays, 1);
    assert.equal(out.possibleCrossingCharges, 0);
    assert.equal(out.routeCoverageComplete, false);
    assert.equal(out.needsVerification, true);
  });
  it('counts independent crossings without turning them into a daily fee', () => {
    const tunnel: ChargingRule = { ...dailyRule, schemeId: 'blackwall_silvertown', unit: 'per_crossing' };
    const output = summarizeRouteChargePassages('car', [
      event('outbound', { schemeId: 'blackwall_silvertown', rule: tunnel }),
      event('return', { schemeId: 'blackwall_silvertown', rule: tunnel }),
    ]);
    assert.equal(output.possibleDailyChargeDays, 0);
    assert.equal(output.possibleCrossingCharges, 2);
    assert.equal(output.routeCoverageComplete, false);
    assert.equal(output.needsVerification, true);
  });
  it('does not count outside-hours, out-of-scope or operator-verified exempt events', () => {
    const limited: ChargingRule = { ...dailyRule,
      weeklyWindows: [{ dayOfWeek: 1, startMinute: 600, endMinute: 720 }] };
    const events = [
      event('off_hours', { rule: limited }),
      event('ordinary'),
      event('exempt', { entitlement: {
        schemeId: 'london_congestion', vehicleClass: 'car', status: 'exempt', source: 'operator_verified',
        checkedAt: '2026-07-05T00:00:00Z', validThrough: '2026-12-31',
      } }),
    ];
    const out = summarizeRouteChargePassages('car', events);
    assert.equal(out.possibleDailyChargeDays, 1);
    assert.equal(summarizeRouteChargePassages('motorcycle', [events[1]!]).possibleDailyChargeDays, 0);
    assert.equal(out.needsVerification, true);
    assert.equal(out.routeCoverageComplete, false);
  });
  it('keeps user-declared exemptions chargeable and uncertain evidence unknown', () => {
    const out = summarizeRouteChargePassages('car', [
      event('declared', { entitlement: {
        schemeId: 'london_congestion', vehicleClass: 'car', status: 'exempt', source: 'user_declared',
      } }),
      event('only_polygon', { roadEvidence: 'polygon_overlap' }),
      event('missing_rule', { rule: undefined }),
    ]);
    assert.equal(out.possibleDailyChargeDays, 1);
    assert.equal(out.needsVerification, true);
    assert.equal(out.results[1]?.assessment.outcome, 'unknown');
  });
  it('never applies an unrelated Clean Air Zone entitlement', () => {
    const bradford: ChargingRule = { ...dailyRule, schemeId: 'uk_caz', zoneId: 'bradford_caz',
      waivingStatuses: ['exempt', 'compliant'] };
    const out = summarizeRouteChargePassages('car', [
      event('bradford', { schemeId: 'uk_caz', zoneId: 'bradford_caz', rule: bradford }),
      event('birmingham', { schemeId: 'uk_caz', zoneId: 'birmingham_caz', rule: bradford }),
    ]);
    assert.equal(out.possibleDailyChargeDays, 1);
    assert.equal(out.needsVerification, true);
    assert.equal(out.results[1]?.assessment.outcome, 'unknown');
  });
  it('rejects ambiguous duplicate passage IDs and oversized input', () => {
    const duplicates = summarizeRouteChargePassages('car', [event('same'), event('same')]);
    assert.equal(duplicates.reason, 'duplicate_event');
    assert.equal(duplicates.needsVerification, true);
    assert.equal(duplicates.routeCoverageComplete, false);
    assert.equal(summarizeRouteChargePassages('car', new Array(257).fill(event('x'))).reason, 'invalid_event_list');
    assert.equal(summarizeRouteChargePassages('car', [event('')]).reason, 'invalid_event_list');
    // One confirmed absence is not proof every road in the route was checked.
    const noCrossing = summarizeRouteChargePassages('car', [
      event('no_crossing', { roadEvidence: 'confirmed_no_crossing' }),
    ]);
    assert.equal(noCrossing.possibleCrossingCharges + noCrossing.possibleDailyChargeDays, 0);
    assert.equal(noCrossing.needsVerification, true);
    assert.equal(noCrossing.routeCoverageComplete, false);
  });
  it('screens existing route geometry without interpreting polygons as verified charges', () => {
    const polygon = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
    const source = { schemeId: 'london_ulez' as const, sourceUrl: 'https://tfl.gov.uk/',
      licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/',
      attribution: 'Sample data, not a real charging boundary', checkedAt: '2026-07-05T00:00:00Z',
      effectiveFrom: '2026-01-01', effectiveThrough: '2026-12-31', reviewedThrough: '2026-12-31' };
    const zone = compileChargeZoneGeoJson(polygon, source);
    assert.ok(zone);
    const inside = screenChargeAreasForRoute([{ lon: 0.1, lat: 0.1 }, { lon: 1, lat: 1 }], '2026-07-06T12:00:00Z', [zone]);
    assert.equal(inside.possibleContacts, 1);
    assert.equal(inside.results[0]?.status, 'possible_polygon_contact');
    assert.equal(inside.requiresReview, true);
    const midnightBoundary = compileChargeZoneGeoJson(polygon,
      { ...source, effectiveThrough: '2026-07-06' });
    assert.equal(screenChargeAreasForRoute([{ lon: 0.1, lat: 0.1 }, { lon: 1, lat: 1 }],
      '2026-07-06T22:59:00Z', [midnightBoundary]).results[0]?.status, 'possible_polygon_contact');
    // Local midnight is 23:00 UTC in British Summer Time.
    assert.equal(screenChargeAreasForRoute([{ lon: 0.1, lat: 0.1 }, { lon: 1, lat: 1 }],
      '2026-07-06T23:00:00Z', [midnightBoundary]).results[0]?.status, 'unknown');
    const outside = screenChargeAreasForRoute([{ lon: 10, lat: 10 }, { lon: 11, lat: 11 }], '2026-07-06T12:00:00Z', [zone]);
    assert.equal(outside.possibleContacts, 0);
    assert.equal(outside.requiresReview, true);
    assert.equal(outside.results[0]?.status, 'no_polygon_contact');
    const expired = screenChargeAreasForRoute([{ lon: 0.1, lat: 0.1 }, { lon: 1, lat: 1 }], '2027-07-06T12:00:00Z', [zone]);
    assert.equal(expired.results[0]?.status, 'unknown');
    assert.equal(screenChargeAreasForRoute([], 'invalid', []).requiresReview, true);
    assert.deepEqual(screenChargeAreasForRoute([], '2026-07-06', [zone]).results, []);
    assert.equal(screenChargeAreasForRoute([{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }],
      '2026-07-06T12:00:00Z', Array(65).fill(zone)).requiresReview, true);
    const missing = screenChargeAreasForRoute([{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }],
      '2026-07-06T12:00:00Z', [null]);
    assert.deepEqual(missing.results, []);
    assert.equal(missing.possibleContacts, 0);
    assert.equal(missing.requiresReview, true);
    // In particular, missing identity must not be falsely labelled uk_caz.
    const mixed = screenChargeAreasForRoute([{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }],
      '2026-07-06T12:00:00Z', [zone, null]);
    assert.deepEqual(mixed.results, []);
  });
  it('does not call any network provider to calculate a fee', () => {
    const output = summarizeRouteChargePassages('car', []);
    assert.deepEqual(output, { possibleDailyChargeDays: 0, possibleCrossingCharges: 0,
      routeCoverageComplete: false, needsVerification: true, reason: 'no_evidence', results: [] });
  });
});
