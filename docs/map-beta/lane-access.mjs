// Research-only lane permission and guidance foundation. There is deliberately
// no live route, backend, GPS, charging, exemption or official road data here.
export const RIDER_LANE_GUIDANCE_RELEASED = false;

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = new Set(['motorcycle', 'moped', 'scooter', 'car', 'van', 'heavy']);
const DIRECTIONS = new Set(['forward', 'backward']);
const WEEKDAYS = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
const LONDON_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', year: 'numeric',
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',
});

function utcMs(value) {
  if (typeof value !== 'string' || !UTC.test(value)) return null;
  const result = Date.parse(value);
  if (!Number.isFinite(result)) return null;
  const canonical = new Date(result).toISOString();
  // Validate calendar bounds rather than allowing Date.parse normalisation.
  const supplied = value.replace(/\.0{1,3}Z$/, 'Z');
  const expected = canonical.replace(/\.000Z$/, 'Z');
  if (!supplied.includes('.') && expected !== supplied) return null;
  if (supplied.includes('.') && !canonical.startsWith(supplied.slice(0, -1).padEnd(23, '0'))) return null;
  return result;
}
function validDay(date) {
  const ms = typeof date === 'string' && DAY.test(date) ? Date.parse(date + 'T00:00:00Z') : NaN;
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}
function londonParts(timestampMs) {
  const parts = Object.fromEntries(LONDON_CLOCK.formatToParts(timestampMs).map(p => [p.type, p.value]));
  return {
    day: parts.year + '-' + parts.month + '-' + parts.day,
    weekday: WEEKDAYS[parts.weekday],
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
function validWindow(w) {
  return w && Number.isInteger(w.startMinute) && Number.isInteger(w.endMinute)
    && w.startMinute >= 0 && w.endMinute <= 1440
    && w.startMinute < w.endMinute
    && (w.access === 'allowed' || w.access === 'prohibited');
}
function validWindows(windows) {
  return Array.isArray(windows) && windows.length <= 16 && windows.every(validWindow)
    && windows.every((w, i) => windows.every((other, j) =>
      i === j || w.endMinute <= other.startMinute || other.endMinute <= w.startMinute));
}
function validSchedule(rule) {
  return Array.isArray(rule.weekly) && rule.weekly.length <= 7
    && rule.weekly.every(d => Number.isInteger(d.weekday) && d.weekday >= 0
      && d.weekday <= 6 && validWindows(d.windows))
    && new Set(rule.weekly.map(d => d.weekday)).size === rule.weekly.length
    && Array.isArray(rule.dateOverrides) && rule.dateOverrides.length <= 31
    && rule.dateOverrides.every(d => validDay(d.date) && validWindows(d.windows))
    && new Set(rule.dateOverrides.map(d => d.date)).size === rule.dateOverrides.length;
}
function accessAt(rule, atMs) {
  const local = londonParts(atMs);
  if (local.day > rule.exceptionsReviewedThrough) return null;
  const entry = rule.dateOverrides.find(x => x.date === local.day)
    ?? rule.weekly.find(x => x.weekday === local.weekday);
  if (!entry) return null;
  return entry.windows.find(x => x.startMinute <= local.minute && local.minute < x.endMinute)?.access ?? null;
}

const unknown = (reason) => ({ status: 'unknown', reason, syntheticOnly: true });

/**
 * Evaluates ONLY synthetic fixtures. It can never prove a real bus-lane
 * permission. Explicit times are required for both allowed and prohibited
 * decisions: outside the reviewed windows is UNKNOWN, not implicitly legal.
 *
 * Each graph edge ID is scoped to graphSha256; OSM way + polygon contact is not
 * a verified lane correspondence. All timestamps are UTC with a Z suffix.
 */
export function evaluateSyntheticLaneAccess(input) {
  if (RIDER_LANE_GUIDANCE_RELEASED !== false) return unknown('release_guard');
  if (!input || typeof input !== 'object' || Array.isArray(input)) return unknown('invalid_input');
  const { graphSha256, traversal, lane, vehicleCategory, passage, rule } = input;
  if (!SHA256.test(graphSha256 ?? '') || !traversal || !lane || !passage || !rule
    || !CATEGORIES.has(vehicleCategory)
    || !ID.test(traversal.edgeId ?? '') || !ID.test(lane.edgeId ?? '')
    || !ID.test(lane.laneId ?? '') || !DIRECTIONS.has(traversal.direction)
    || !DIRECTIONS.has(lane.direction) || !['bus_lane', 'ordinary', 'bus_gate', 'contraflow_bus'].includes(lane.kind)
    || !ID.test(rule.edgeId ?? '') || !ID.test(rule.laneId ?? '')
    || !DIRECTIONS.has(rule.direction) || !SHA256.test(rule.graphSha256 ?? '')
    || !CATEGORIES.has(rule.vehicleCategory) || !validDay(rule.exceptionsReviewedThrough)
    || !validSchedule(rule)) return unknown('invalid_input');
  // No official road records are accepted by this draft foundation. A future
  // legally reviewed evaluator will be separate and require verified evidence.
  if (rule.provenance !== 'synthetic_fixture') return unknown('unverified_source');
  if (lane.kind !== 'bus_lane') return unknown('unsupported_lane_type');
  if (graphSha256 !== rule.graphSha256 || traversal.edgeId !== lane.edgeId
    || traversal.edgeId !== rule.edgeId || lane.laneId !== rule.laneId
    || traversal.direction !== lane.direction || traversal.direction !== rule.direction)
    return unknown('graph_lane_or_direction_mismatch');
  if (rule.vehicleCategory !== vehicleCategory) return unknown('vehicle_mismatch');

  const earliest = utcMs(passage.earliestUtc);
  const estimate = utcMs(passage.estimatedUtc);
  const latest = utcMs(passage.latestUtc);
  const checked = utcMs(rule.reviewedAtUtc);
  const start = utcMs(rule.effectiveFromUtc);
  const expiry = utcMs(rule.effectiveThroughUtc);
  if ([earliest, estimate, latest, checked, start, expiry].some(x => x === null)
    || earliest > estimate || estimate > latest || latest - earliest > 2 * 60 * 60 * 1000)
    return unknown('invalid_or_unbounded_time');
  if (start > earliest || expiry < latest || checked > earliest
    || earliest - checked > 30 * 86400000)
    return unknown('source_outside_reviewed_period');

  let previous = null;
  // Local operating windows have minute precision, so evaluating every UTC
  // minute bucket across the entire bounded ETA covers UK DST transitions and
  // any operating-hour change within the uncertainty window.
  const begin = Math.floor(earliest / 60000) * 60000;
  for (let at = begin; at <= latest; at += 60000) {
    const current = accessAt(rule, at);
    if (!current) return unknown('schedule_not_covered');
    if (previous !== null && current !== previous) return unknown('passage_window_crosses_rule_change');
    previous = current;
  }
  return {
    status: previous === 'allowed' ? 'illustrative_permitted' : 'illustrative_prohibited',
    reason: 'synthetic_schedule_only',
    syntheticOnly: true,
  };
}

export const SYNTHETIC_LANE_GRAPH_SHA256 = 'a'.repeat(64);
export function syntheticBusLaneScenario(utcInstant) {
  const ms = utcMs(utcInstant);
  if (ms === null) throw new TypeError('Synthetic example requires a valid UTC instant');
  return {
    graphSha256: SYNTHETIC_LANE_GRAPH_SHA256,
    traversal: { edgeId: 'synthetic-edge-1', direction: 'forward' },
    lane: { edgeId: 'synthetic-edge-1', laneId: 'synthetic-lane-3', direction: 'forward', kind: 'bus_lane' },
    vehicleCategory: 'motorcycle',
    passage: {
      estimatedUtc: utcInstant,
      earliestUtc: new Date(ms - 60_000).toISOString(),
      latestUtc: new Date(ms + 60_000).toISOString(),
    },
    rule: {
      provenance: 'synthetic_fixture',
      graphSha256: SYNTHETIC_LANE_GRAPH_SHA256,
      edgeId: 'synthetic-edge-1',
      laneId: 'synthetic-lane-3',
      direction: 'forward',
      vehicleCategory: 'motorcycle',
      reviewedAtUtc: '2026-11-22T12:00:00Z',
      effectiveFromUtc: '2026-11-22T00:00:00Z',
      effectiveThroughUtc: '2026-11-30T23:59:59Z',
      exceptionsReviewedThrough: '2026-11-30',
      weekly: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        windows: [
          { startMinute: 0, endMinute: 420, access: 'prohibited' },
          { startMinute: 420, endMinute: 1140, access: 'allowed' },
          { startMinute: 1140, endMinute: 1440, access: 'prohibited' },
        ],
      })),
      dateOverrides: [],
    },
  };
}
