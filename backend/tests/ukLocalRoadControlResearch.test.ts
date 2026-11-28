import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_ROAD_CONTROL_RESEARCH, LOCAL_ROAD_CONTROL_REVIEWED_ON,
  lookupLocalRoadControl,
} from '../src/ukLocalRoadControlResearch.ts';

describe('unreleased source-checked local charging / traffic restrictions catalogue', () => {
  it('keeps Oxford temporary congestion, current traffic filters and ZEZ distinct', () => {
    const byId = new Map(LOCAL_ROAD_CONTROL_RESEARCH.map(item => [item.id, item]));
    assert.equal(byId.size, 4);
    assert.equal(byId.get('oxford_temporary_congestion')?.kind, 'ended_charge');
    assert.equal(byId.get('oxford_temporary_congestion')?.endedAfter, '2026-09-27');
    assert.equal(byId.get('oxford_traffic_filters')?.kind, 'permit_based_traffic_restriction');
    assert.equal(byId.get('oxford_traffic_filters')?.effectiveFrom, '2026-09-28');
    assert.equal(byId.get('oxford_zez')?.kind, 'charge_requires_operator_check');
    assert.equal(byId.get('durham_road_user_charge')?.kind, 'charge_requires_operator_check');
    assert.equal(LOCAL_ROAD_CONTROL_REVIEWED_ON, '2026-11-22');
  });
  it('never treats traffic filter permits as paid tolls or claims charging eligibility', () => {
    for (const entry of LOCAL_ROAD_CONTROL_RESEARCH) {
      assert.equal(entry.requiresOperatorReview, true);
      assert.equal(entry.routeAccessVerified, false);
      assert.equal(entry.chargeEligibilityVerified, false);
      assert.match(entry.officialSourceUrl, /^https:\/\//);
      assert.ok(Object.isFrozen(entry));
      assert.equal('pricePence' in entry, false);
      assert.equal('tollFree' in entry, false);
    }
    assert.ok(Object.isFrozen(LOCAL_ROAD_CONTROL_RESEARCH));
  });
  it('keeps the ended charge advisory as at the source review date', () => {
    const ended = lookupLocalRoadControl('oxford_temporary_congestion', '2026-11-22');
    assert.equal(ended.status, 'advisory');
    if (ended.status === 'advisory') {
      assert.equal(ended.research.kind, 'ended_charge');
      assert.equal(ended.requiresOperatorReview, true);
    }
    assert.equal(lookupLocalRoadControl('oxford_traffic_filters', '2026-11-22').status, 'advisory');
    assert.equal(lookupLocalRoadControl('oxford_zez', '2026-11-22').status, 'advisory');
    assert.equal(lookupLocalRoadControl('durham_road_user_charge', '2026-11-22').status, 'advisory');
  });
  it('refuses historic or unsupported dates instead of inventing old policy', () => {
    assert.equal(lookupLocalRoadControl('oxford_temporary_congestion', '2026-09-27').status, 'date_not_reviewed');
    assert.equal(lookupLocalRoadControl('oxford_traffic_filters', '2026-09-27').status, 'date_not_reviewed');
    assert.equal(lookupLocalRoadControl('oxford_zez', '2026-09-27').status, 'date_not_reviewed');
    assert.equal(lookupLocalRoadControl('oxford_traffic_filters', '2026-11-21').status, 'date_not_reviewed');
    assert.equal(lookupLocalRoadControl('oxford_zez', '2026-11-23').status, 'advisory');
    assert.equal(lookupLocalRoadControl('oxford_zez', '2026-12-22').status, 'advisory');
    assert.equal(lookupLocalRoadControl('oxford_zez', '2026-12-23').status, 'reference_stale');
  });
  it('rejects invalid IDs, fabricated schemes, impossible dates and inherited keys', () => {
    for (const id of [null, undefined, 'unknown', '__proto__', 'constructor', '', [], 123, {}]) {
      assert.deepEqual(lookupLocalRoadControl(id, '2026-11-22'), {
        status: 'reference_unknown', requiresOperatorReview: true,
      });
    }
    for (const date of ['2026-02-30', 'broken', '', '2026-13-01', '2026-11-22T00:00:00Z']) {
      assert.equal(lookupLocalRoadControl('oxford_zez', date).status, 'reference_unknown');
    }
  });
});
