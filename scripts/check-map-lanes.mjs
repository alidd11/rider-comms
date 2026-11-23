import assert from 'node:assert/strict';
import {
  RIDER_LANE_GUIDANCE_RELEASED,
  evaluateSyntheticLaneAccess,
  syntheticBusLaneScenario,
} from '../map-lab/lane-access.mjs';

const green = 'illustrative_permitted';
const forbidden = 'illustrative_prohibited';
const example = (at) => syntheticBusLaneScenario(at);
const evaluate = (input) => evaluateSyntheticLaneAccess(input);
const morning = example('2026-11-23T08:30:00Z');

assert.equal(RIDER_LANE_GUIDANCE_RELEASED, false);
assert.deepEqual(evaluate(morning), {
  status: green, reason: 'synthetic_schedule_only', syntheticOnly: true,
});
assert.equal(evaluate(example('2026-11-23T20:30:00Z')).status, forbidden);
assert.equal(evaluate(example('2026-11-23T06:30:00Z')).status, forbidden);

// A predicted passage spanning either operating-hours boundary is UNKNOWN,
// even if the nominal ETA is just inside the permit window.
assert.equal(evaluate(example('2026-11-23T07:00:00Z')).reason, 'passage_window_crosses_rule_change');
assert.equal(evaluate(example('2026-11-23T19:00:00Z')).reason, 'passage_window_crosses_rule_change');

// Matching an OSM way or a visual line is not matching a verified directed
// lane. The same bridge/road in the opposite direction is never permitted.
for (const changed of [
  { traversal: { ...morning.traversal, direction: 'backward' } },
  { lane: { ...morning.lane, edgeId: 'other-edge' } },
  { lane: { ...morning.lane, laneId: 'other-lane' } },
  { lane: { ...morning.lane, direction: 'backward' } },
  { rule: { ...morning.rule, graphSha256: 'b'.repeat(64) } },
  { graphSha256: 'b'.repeat(64) },
]) {
  assert.equal(evaluate({ ...morning, ...changed }).reason, 'graph_lane_or_direction_mismatch');
}
assert.equal(evaluate({ ...morning, vehicleCategory: 'car' }).reason, 'vehicle_mismatch');
assert.equal(evaluate({ ...morning, vehicleCategory: 'moped' }).reason, 'vehicle_mismatch');
assert.equal(evaluate({ ...morning, lane: { ...morning.lane, kind: 'bus_gate' } }).reason, 'unsupported_lane_type');
assert.equal(evaluate({ ...morning, lane: { ...morning.lane, kind: 'contraflow_bus' } }).reason, 'unsupported_lane_type');

// A real external authority record cannot slip through this synthetic-only
// module. A future legal evaluator needs separate sign/TRO validation.
assert.equal(evaluate({ ...morning, rule: { ...morning.rule, provenance: 'authority_verified' } }).reason, 'unverified_source');
assert.equal(evaluate({ ...morning, rule: { ...morning.rule, provenance: 'osm_tag_only' } }).reason, 'unverified_source');
assert.equal(evaluate({ ...morning, rule: { ...morning.rule, reviewedAtUtc: '2026-09-01T00:00:00Z' } }).reason, 'source_outside_reviewed_period');
assert.equal(evaluate({ ...morning, rule: { ...morning.rule, effectiveThroughUtc: '2026-11-23T08:30:00Z' } }).reason, 'source_outside_reviewed_period');
assert.equal(evaluate({ ...morning, rule: { ...morning.rule, exceptionsReviewedThrough: '2026-11-22' } }).reason, 'schedule_not_covered');
assert.equal(evaluate({ ...morning, passage: { ...morning.passage, earliestUtc: '2026-11-23T05:00:00Z' } }).reason, 'invalid_or_unbounded_time');
assert.equal(evaluate({ ...morning, passage: { ...morning.passage, estimatedUtc: '2026-11-23T08:30:00' } }).reason, 'invalid_or_unbounded_time');
assert.equal(evaluate({ ...morning, passage: { ...morning.passage, estimatedUtc: '2026-11-23T24:00:00Z' } }).reason, 'invalid_or_unbounded_time');
assert.equal(evaluate({ ...morning, rule: { ...morning.rule, weekly: [{ weekday: 1, windows: [{ startMinute: 700, endMinute: 600, access: 'allowed' }] }] } }).reason, 'invalid_input');
assert.equal(evaluate({ ...morning, rule: { ...morning.rule, weekly: [{ weekday: 1, windows: [{ startMinute: 0, endMinute: 500, access: 'allowed' }, { startMinute: 400, endMinute: 600, access: 'prohibited' }] }] } }).reason, 'invalid_input');

// Officially reviewed date exceptions will be represented explicitly; there
// is no implicit bank holiday rule or assumption of regular operating hours.
const exception = { ...morning.rule,
  dateOverrides: [{ date: '2026-11-23', windows: [{ startMinute: 0, endMinute: 1440, access: 'prohibited' }] }],
};
assert.equal(evaluate({ ...morning, rule: exception }).status, forbidden);
const missingDay = { ...morning.rule, weekly: [], dateOverrides: [] };
assert.equal(evaluate({ ...morning, rule: missingDay }).reason, 'schedule_not_covered');

// Britain repeats its 01:00–02:00 clock hour on the autumn DST transition.
// Two distinct UTC instants must be evaluated in Europe/London, not based on
// assumed or inferred local offsets.
const autumnRule = {
  ...morning.rule,
  reviewedAtUtc: '2026-10-24T00:00:00Z',
  effectiveFromUtc: '2026-10-24T00:00:00Z',
  effectiveThroughUtc: '2026-10-27T00:00:00Z',
  exceptionsReviewedThrough: '2026-10-26',
  weekly: Array.from({ length: 7 }, (_, weekday) => ({
    weekday, windows: [{ startMinute: 60, endMinute: 120, access: 'allowed' }],
  })),
};
for (const instant of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
  assert.equal(evaluate({ ...example(instant), rule: autumnRule }).status, green);
}
assert.equal(evaluate({ ...example('2026-10-25T02:30:00Z'), rule: autumnRule }).reason, 'schedule_not_covered');

console.log('Rider Comms Maps: synthetic-only directed bus-lane windows, UTC/BST, provenance and fail-closed states verified.');
