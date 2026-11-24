import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewChargeRouteSnapshot, type ChargeRouteSnapshotIdentity,
  type ChargeRouteObservedPassage } from '../src/chargeRouteSnapshot.ts';
import type { ChargingRule } from '../src/chargingRules.ts';

// No verified authority data or released Maps graph enters these fixtures.
const graph = 'a'.repeat(64);
const newerGraph = 'b'.repeat(64);
const active: ChargeRouteSnapshotIdentity = {
  schemaVersion: 1,
  routeId: 'synthetic-plan-a', revision: 4, graphBuildSha256: graph,
  profileRevision: 'motorcycle-test-v1', vehicleClass: 'motorcycle',
};
const rule: ChargingRule = {
  schemeId: 'dart_charge', unit: 'per_crossing',
  sourceUrl: 'https://example.org/not-an-operator',
  checkedAt: '2026-11-22T12:00:00Z', effectiveFrom: '2026-01-01',
  effectiveThrough: '2026-12-31', exceptionsReviewedThrough: '2026-12-31',
  vehicleClasses: ['motorcycle'], weeklyWindows: Array.from({ length: 7 }, (_, dayOfWeek) =>
    ({ dayOfWeek, startMinute: 0, endMinute: 1440 })),
  exceptions: [], waivingStatuses: ['exempt'],
};
function observed(occurrenceId: string, changes: Partial<ChargeRouteObservedPassage> = {}): ChargeRouteObservedPassage {
  return {
    occurrenceId, routeId: active.routeId, revision: active.revision,
    graphBuildSha256: graph, directedEdgeId: 'graph-edge-42', direction: 'forward',
    passage: {
      eventId: occurrenceId, schemeId: 'dart_charge', roadEvidence: 'confirmed_crossing', rule,
      earliestPassageAt: '2026-11-23T12:00:00Z', predictedPassageAt: '2026-11-23T12:01:00Z',
      latestPassageAt: '2026-11-23T12:02:00Z',
    },
    ...changes,
  };
}
const snapshot = (observations: ChargeRouteObservedPassage[] = [observed('passage-a')]) =>
  ({ ...active, observations });
const check = (candidate: unknown = snapshot(), expected: unknown = active) =>
  reviewChargeRouteSnapshot(expected, candidate);

describe('offline route snapshot coherence fencing (not authenticating graph)', () => {
  it('assesses only internally matched, synthetic route observations', () => {
    const out = check();
    assert.equal(out.status, 'internally_consistent');
    assert.equal(out.summary?.possibleCrossingCharges, 1);
    assert.equal(out.summary?.routeCoverageComplete, false);
    assert.equal(out.routeCoverageComplete, false);
    assert.equal(out.productionApproved, false);
  });
  it('rejects incompatible or missing envelope versions before aggregating', () => {
    assert.equal(check({ ...snapshot(), schemaVersion: 2 }).reason, 'invalid_snapshot');
    assert.equal(check({ ...snapshot(), schemaVersion: undefined }).reason, 'invalid_snapshot');
    assert.equal(check(snapshot(), { ...active, schemaVersion: 2 }).reason,
      'invalid_expected_route');
  });
  it('rejects old route identity and stale plan revision on reroute', () => {
    assert.equal(check(snapshot(), { ...active, routeId: 'synthetic-plan-b' }).reason, 'stale_route_revision');
    assert.equal(check(snapshot(), { ...active, revision: 5 }).reason, 'stale_route_revision');
    assert.equal(check({ ...snapshot(), routeId: 'synthetic-plan-b' }).reason, 'stale_route_revision');
  });
  it('rejects old graph observations after a rebuild', () => {
    assert.equal(check(snapshot(), { ...active, graphBuildSha256: newerGraph }).reason, 'graph_mismatch');
    assert.equal(check(snapshot([observed('x', { graphBuildSha256: newerGraph })])).reason, 'graph_mismatch');
  });
  it('does not mix vehicle class or profile on the same revision', () => {
    assert.equal(check({ ...snapshot(), vehicleClass: 'car' }).reason, 'vehicle_or_profile_mismatch');
    assert.equal(check({ ...snapshot(), profileRevision: 'motorcycle-test-v2' }).reason, 'vehicle_or_profile_mismatch');
  });
  it('rejects observations belonging to other routes or revisions', () => {
    assert.equal(check(snapshot([observed('x', { routeId: 'old-plan' })])).reason, 'stale_route_revision');
    assert.equal(check(snapshot([observed('x', { revision: 2 })])).reason, 'stale_route_revision');
  });
  it('does not accept fabricated directed edge or crossing identity', () => {
    assert.equal(check(snapshot([observed('x', { directedEdgeId: '' })])).reason, 'invalid_observation');
    assert.equal(check(snapshot([observed('x', { direction: 'north' as 'forward' })])).reason,
      'invalid_observation');
    assert.equal(check(snapshot([observed('x', { passage: { ...observed('x').passage, eventId: 'other' } })])).reason,
      'invalid_observation');
  });
  it('preserves multiple traversals of the same directed graph edge', () => {
    const out = check(snapshot([observed('first'), observed('second')]));
    assert.equal(out.status, 'internally_consistent');
    assert.equal(out.summary?.possibleCrossingCharges, 2);
    assert.equal(out.summary?.routeCoverageComplete, false);
  });
  it('rejects out-of-order crossings by UTC instant, not lexical offset text', () => {
    const first = observed('first');
    const wrongOrder = observed('second', { passage: { ...observed('second').passage,
      earliestPassageAt: '2026-11-23T12:29:00+01:00',
      predictedPassageAt: '2026-11-23T12:30:00+01:00',
      latestPassageAt: '2026-11-23T12:31:00+01:00' } });
    assert.equal(check(snapshot([first, wrongOrder])).reason, 'non_monotonic_passage_time');
    assert.equal(check(snapshot([wrongOrder, first])).status, 'internally_consistent');
  });
  it('allows equal ETA estimates for distinct road crossings and overlapping uncertainty', () => {
    const first = observed('first');
    const second = observed('second', { passage: { ...observed('second').passage,
      predictedPassageAt: '2026-11-23T13:01:00+01:00' } });
    const out = check(snapshot([first, second]));
    assert.equal(out.status, 'internally_consistent');
    assert.equal(out.summary?.possibleCrossingCharges, 2);
  });
  it('rejects a missing or malformed crossing ETA instead of claiming chronological coherence', () => {
    const bad = observed('bad', { passage: { ...observed('bad').passage,
      predictedPassageAt: '2026-11-23T12:01:00' } });
    assert.equal(check(snapshot([bad])).reason, 'invalid_observation');
  });
  it('blocks malformed, reversed and unbounded passage windows before aggregating', () => {
    const initial = observed('window');
    const variants = [
      { ...initial.passage, earliestPassageAt: '2026-11-23T12:00:00' },
      { ...initial.passage, latestPassageAt: 'not-an-instant' },
      { ...initial.passage, earliestPassageAt: '2026-11-23T12:02:00Z' },
      { ...initial.passage, latestPassageAt: '2026-11-23T12:00:00Z' },
      { ...initial.passage, latestPassageAt: '2026-11-23T14:01:01Z' },
    ];
    for (const passage of variants) {
      const review = check(snapshot([observed('window', { passage })]));
      assert.equal(review.status, 'blocked');
      assert.equal(review.reason, 'invalid_observation');
      assert.equal(review.routeCoverageComplete, false);
      assert.equal(review.productionApproved, false);
      assert.equal(review.summary, undefined);
    }
  });
  it('validates uncertainty envelopes by actual UTC instants despite differing offsets', () => {
    const passage = { ...observed('offset').passage,
      earliestPassageAt: '2026-11-23T13:00:00+01:00',
      predictedPassageAt: '2026-11-23T12:01:00Z',
      latestPassageAt: '2026-11-23T13:02:00+01:00' };
    const review = check(snapshot([observed('offset', { passage })]));
    assert.equal(review.status, 'internally_consistent');
    assert.equal(review.summary?.possibleCrossingCharges, 1);
  });
  it('rejects an occurrence listed twice rather than silently deduplicating it', () => {
    assert.equal(check(snapshot([observed('same'), observed('same')])).reason, 'duplicate_observation');
  });
  it('rejects invalid active identity and malformed or oversized candidates', () => {
    assert.equal(check(snapshot(), { ...active, graphBuildSha256: 'not-a-digest' }).reason,
      'invalid_expected_route');
    assert.equal(check(snapshot(), { ...active, revision: -1 }).reason, 'invalid_expected_route');
    assert.equal(check({ ...snapshot(), graphBuildSha256: 'bad' }).reason, 'invalid_snapshot');
    assert.equal(check({ ...snapshot(), observations: null }).reason, 'invalid_snapshot');
    assert.equal(check(snapshot(Array.from({ length: 257 }, (_, i) => observed('passage-' + i)))).reason,
      'invalid_snapshot');
  });
  it('does not accept an event list containing malformed passages', () => {
    assert.equal(check(snapshot([observed('x', { passage: null as unknown as ChargeRouteObservedPassage['passage'] })])).reason,
      'invalid_observation');
    assert.equal(check(snapshot([observed('x', { passage: { eventId: 'x' } as ChargeRouteObservedPassage['passage'] })])).reason,
      'invalid_observation');
  });
  it('treats an empty but well-identified route as no evidence, never a verified free route', () => {
    const out = check(snapshot([]));
    assert.equal(out.status, 'internally_consistent');
    assert.equal(out.summary?.reason, 'no_evidence');
    assert.equal(out.summary?.needsVerification, true);
    assert.equal(out.routeCoverageComplete, false);
  });
});
