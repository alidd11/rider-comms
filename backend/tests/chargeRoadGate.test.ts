import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { screenReviewedRoadGates, type ReviewedRoadGate } from '../src/chargeRoadGate.ts';

const gate: ReviewedRoadGate = {
  id: 'sample_gate', schemeId: 'blackwall_silvertown',
  sourceUrl: 'https://tfl.gov.uk/modes/driving/silvertown-blackwall-tunnels-charge',
  effectiveFrom: '2026-01-01', effectiveThrough: '2026-12-31', reviewedThrough: '2026-12-31',
  start: { lon: -1, lat: 0 }, end: { lon: 1, lat: 0 }, direction: 'either',
};
const north = [{ lon: 0, lat: -1 }, { lon: 0, lat: 1 }];
const south = [...north].reverse();
const date = '2026-11-23T12:00:00Z';

describe('offline candidate road gate screening', () => {
  it('detects crossings in either direction without claiming a fee or a road match', () => {
    const result = screenReviewedRoadGates(north, date, [gate]);
    assert.deepEqual(result, {
      status: 'screened', requiresRoadReview: true, possibleGateContacts: 1,
      candidates: [{ gateId: 'sample_gate', schemeId: 'blackwall_silvertown', routeSegmentIndex: 0 }],
    });
    assert.equal(screenReviewedRoadGates(south, date, [gate]).possibleGateContacts, 1);
    assert.equal('confirmed_crossing' in result, false);
    assert.equal('pricePence' in result, false);
  });
  it('honours the reviewer-supplied direction, not guessed road direction', () => {
    const directional = { ...gate, direction: 'negative_to_positive' as const };
    assert.equal(screenReviewedRoadGates(north, date, [directional]).possibleGateContacts, 1);
    assert.equal(screenReviewedRoadGates(south, date, [directional]).possibleGateContacts, 0);
    assert.equal(screenReviewedRoadGates(north, date, [{ ...gate,
      direction: 'positive_to_negative' }]).possibleGateContacts, 0);
  });
  it('screens a path that passes nearby without crossing the actual gate segment', () => {
    const result = screenReviewedRoadGates([{ lon: 3, lat: -1 }, { lon: 3, lat: 1 }], date, [gate]);
    assert.equal(result.status, 'screened');
    assert.equal(result.possibleGateContacts, 0);
    assert.equal(result.requiresRoadReview, true);
  });
  it('marks touching and collinear contacts unknown rather than confirmed', () => {
    const touching = screenReviewedRoadGates(
      [{ lon: 0, lat: -1 }, { lon: 0, lat: 0 }], date, [gate]);
    assert.equal(touching.reason, 'ambiguous_contact');
    const collinear = screenReviewedRoadGates(
      [{ lon: -0.5, lat: 0 }, { lon: 0.5, lat: 0 }], date, [gate]);
    assert.equal(collinear.status, 'unknown');
  });
  it('counts repeated candidate crossings separately, without any legal fee estimate', () => {
    const result = screenReviewedRoadGates(
      [{ lon: 0, lat: -1 }, { lon: 0, lat: 1 }, { lon: 0, lat: -1 }], date, [gate]);
    assert.equal(result.possibleGateContacts, 2);
    assert.deepEqual(result.candidates.map(x => x.routeSegmentIndex), [0, 1]);
  });
  it('rejects untrusted, expired or mismatched authority gate metadata', () => {
    assert.equal(screenReviewedRoadGates(north, date, [{ ...gate, sourceUrl: 'http://example.com' }]).reason, 'invalid_gate_data');
    assert.equal(screenReviewedRoadGates(north, date, [{ ...gate, effectiveThrough: '2026-11-22' }]).reason, 'invalid_gate_data');
    assert.equal(screenReviewedRoadGates(north, date, [{ ...gate, reviewedThrough: '2026-11-22' }]).reason, 'invalid_gate_data');
    assert.equal(screenReviewedRoadGates(north, date, [{ ...gate, start: gate.end }]).reason, 'invalid_gate_data');
    assert.equal(screenReviewedRoadGates(north, date, [{ ...gate, zoneId: 'fake_caz' }]).reason, 'invalid_gate_data');
    assert.equal(screenReviewedRoadGates(north, date, [{ ...gate, direction: 'bad' as ReviewedRoadGate['direction'] }]).reason, 'invalid_gate_data');
    const caz: ReviewedRoadGate = { ...gate, schemeId: 'uk_caz', zoneId: 'bradford_caz' };
    assert.equal(screenReviewedRoadGates(north, date, [caz]).candidates[0]?.zoneId, 'bradford_caz');
    assert.equal(screenReviewedRoadGates(north, date, [{ ...caz, zoneId: undefined }]).reason, 'invalid_gate_data');
  });
  it('fails closed on missing, malformed, duplicated or too-long inputs', () => {
    assert.equal(screenReviewedRoadGates([], date, [gate]).reason, 'invalid_route_or_date');
    assert.equal(screenReviewedRoadGates(north, 'bad', [gate]).reason, 'invalid_route_or_date');
    assert.equal(screenReviewedRoadGates([{ lon: 200, lat: 0 }, ...north], date, [gate]).reason, 'invalid_route_or_date');
    assert.equal(screenReviewedRoadGates([{ lon: 179, lat: 1 }, { lon: -179, lat: 1 }], date, [gate]).reason, 'invalid_route_or_date');
    assert.equal(screenReviewedRoadGates(north, date, []).reason, 'invalid_gate_data');
    assert.equal(screenReviewedRoadGates(north, date, [gate, gate]).reason, 'invalid_gate_data');
    assert.equal(screenReviewedRoadGates(north, date, new Array(129).fill(gate)).reason, 'invalid_gate_data');
  });
});
