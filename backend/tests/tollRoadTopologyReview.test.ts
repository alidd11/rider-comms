import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewTollRoadTopology,
  type ReviewedTollRoadLink,
  type RouteTollWayObservation,
} from '../src/tollRoadTopologyReview.ts';

const SHA = 'a'.repeat(64);
const observation: RouteTollWayObservation = {
  contactId: 'contact-001', infrastructureId: 'm6_toll',
  routeSegmentIndex: 3, wayId: 'osmid:1234', layer: 1,
  direction: 'forward', source: 'reviewed_graph', graphSha256: SHA,
};
const link: ReviewedTollRoadLink = {
  infrastructureId: 'm6_toll', wayId: 'osmid:1234',
  layer: 1, chargeDirection: 'forward', graphSha256: SHA,
  authorityCorroborated: true,
  authoritySourceUrl: 'https://www.m6toll.co.uk/pricing/',
  reviewedOn: '2026-11-21', reviewedThrough: '2026-12-15',
  commercialReuseApproved: true,
  licenceUrl: 'https://www.openstreetmap.org/copyright',
  attribution: 'Synthetic test-only way. No production mapping is distributed.',
  approvalReference: 'TEST-SYNTHETIC-NO-ROAD-DATA',
};
const when = '2026-11-22';
const screen = (o: readonly RouteTollWayObservation[] = [observation],
  l: readonly ReviewedTollRoadLink[] = [link], day = when) =>
  reviewTollRoadTopology(o, l, day);
const unknown = (observed: RouteTollWayObservation, ref: ReviewedTollRoadLink, reason: string) => {
  const result = screen([observed], [ref]);
  assert.equal(result.status, 'unknown');
  assert.equal(result.possibleRoadContacts, 0);
  assert.equal(result.results[0]?.reason, reason);
  assert.equal(result.requiresOperatorReview, true);
  assert.equal(result.routeCoverageComplete, false);
};
describe('draft-only toll road graph/crossing verification gate', () => {
  it('returns only an advisory candidate, never a charge or fully covered route', () => {
    const result = screen();
    assert.deepEqual(result, {
      status: 'screened', possibleRoadContacts: 1,
      results: [{ contactId: observation.contactId, infrastructureId: 'm6_toll',
        status: 'possible_road_contact', reason: 'topology_reviewed_candidate' }],
      requiresOperatorReview: true, routeCoverageComplete: false,
    });
    assert.equal('amountPence' in result, false);
    assert.equal('confirmed_crossing' in result, false);
    assert.equal('verifiedExempt' in result, false);
  });
  it('does not count visually overlapping but grade-separated carriageways', () => {
    unknown({ ...observation, layer: 0 }, link, 'grade_separated');
    unknown({ ...observation, layer: null }, link, 'grade_separated');
    unknown(observation, { ...link, layer: null }, 'grade_separated');
  });
  it('cannot treat a wrong direction or unknown travel orientation as charge-free', () => {
    unknown({ ...observation, direction: 'backward' }, link, 'opposite_direction');
    unknown({ ...observation, direction: 'unknown' }, link, 'direction_not_verified');
    assert.equal(screen([{ ...observation, direction: 'backward' }],
      [{ ...link, chargeDirection: 'both' }]).possibleRoadContacts, 1);
  });
  it('requires a pinned identical source graph and operator-matched way ID', () => {
    unknown({ ...observation, graphSha256: 'b'.repeat(64) }, link, 'source_version_mismatch');
    unknown({ ...observation, wayId: 'osmid:9999' }, link, 'no_reviewed_way_link');
    assert.equal(screen([observation], []).results[0]?.reason, 'no_reviewed_way_link');
  });
  it('rejects lone OSM tag yes and raw geometry as unreliable toll evidence', () => {
    unknown({ ...observation, source: 'osm_tag_only' }, link, 'unreliable_map_match');
    unknown({ ...observation, source: 'gps_geometry_only' }, link, 'unreliable_map_match');
    unknown(observation, { ...link, authorityCorroborated: false }, 'authority_not_verified');
  });
  it('requires independently recorded commercial reuse rights and current reviews', () => {
    unknown(observation, { ...link, commercialReuseApproved: false }, 'licence_not_approved');
    unknown(observation, { ...link, reviewedThrough: '2026-11-20' }, 'source_stale');
    unknown(observation, { ...link, reviewedOn: '2026-11-23' }, 'source_stale');
    assert.equal(screen([observation], [link], '2026-12-22').results[0]?.reason, 'source_stale');
  });
  it('preserves uncertainty if only one of two crossing observations is corroborated', () => {
    const second = { ...observation, contactId: 'contact-002',
      infrastructureId: 'humber_bridge', routeSegmentIndex: 8 };
    const result = screen([observation, second]);
    assert.equal(result.status, 'unknown');
    assert.equal(result.possibleRoadContacts, 1);
    assert.equal(result.results[1]?.reason, 'no_reviewed_way_link');
    assert.equal(result.routeCoverageComplete, false);
  });
  it('handles a set of 2 independently reviewed contacts without assuming prices', () => {
    const second = { ...observation, contactId: 'contact-002',
      infrastructureId: 'tyne_tunnels', wayId: 'osmid:2000', routeSegmentIndex: 8 };
    const otherLink = { ...link, infrastructureId: 'tyne_tunnels',
      wayId: 'osmid:2000', chargeDirection: 'both' as const };
    const result = screen([observation, second], [link, otherLink]);
    assert.equal(result.status, 'screened');
    assert.equal(result.possibleRoadContacts, 2);
    assert.equal(result.requiresOperatorReview, true);
  });
  it('rejects impossible dates, invalid topology identities and duplicate inputs', () => {
    assert.equal(screen([observation], [link], '2026-02-30').reason, 'invalid_input');
    assert.equal(screen([], [link]).reason, 'no_observations');
    assert.equal(screen([observation, observation]).reason, 'invalid_input');
    assert.equal(screen([observation], [link, link]).reason, 'invalid_input');
    assert.equal(screen([{ ...observation, infrastructureId: 'unlisted_toll' }]).reason, 'invalid_input');
    assert.equal(screen([{ ...observation, wayId: '__proto__/fake' }]).reason, 'invalid_input');
    assert.equal(screen([{ ...observation, routeSegmentIndex: -1 }]).reason, 'invalid_input');
    assert.equal(screen([{ ...observation, layer: 999 }]).reason, 'invalid_input');
    assert.equal(screen([{ ...observation, graphSha256: 'garbage' }]).reason, 'invalid_input');
    assert.equal(screen([{ ...observation, source: 'unrecognised' as RouteTollWayObservation['source'] }]).reason, 'invalid_input');
    assert.equal(screen([observation], [{ ...link, authoritySourceUrl: 'http://not-secure.example/' }]).reason, 'invalid_input');
    assert.equal(screen([observation], [{ ...link, licenceUrl: 'invalid' }]).reason, 'invalid_input');
    assert.equal(screen([observation], [{ ...link, approvalReference: 'x' }]).reason, 'invalid_input');
    assert.equal(screen([observation], [{ ...link, reviewedOn: 'not-a-date' }]).reason, 'invalid_input');
    assert.equal(screen(new Array(257).fill(observation)).reason, 'invalid_input');
    assert.equal(screen([observation], new Array(257).fill(link)).reason, 'invalid_input');
    assert.equal(screen(null as unknown as RouteTollWayObservation[]).reason, 'invalid_input');
  });
});
