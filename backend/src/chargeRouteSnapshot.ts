/**
 * Experimental, offline-only coherence fence for one candidate route charge
 * snapshot. This is NOT a Maps #572 contract or live navigation adapter.
 * A matching route/graph identity proves only internal consistency of caller-
 * supplied fields, NOT authenticity of any map, road match or charge source.
 */
import { parseChargeInstant } from './chargeInstant.ts';
import { MAX_CHARGE_PASSAGE_UNCERTAINTY_MINUTES } from './chargePassageWindow.ts';
import { summarizeRouteChargeWindows, type RouteChargeWindowPassage,
  type RouteChargeWindowSummary } from './routeChargeWindowSummary.ts';
import type { ChargeVehicleClass } from './chargingRules.ts';

export interface ChargeRouteSnapshotIdentity {
  /** Version of this experimental coherence envelope, not a Maps contract. */
  schemaVersion: 1;
  /** Identifier for one route plan; alternatives must not share one identity. */
  routeId: string;
  /** Monotonically increasing plan revision maintained by the caller. */
  revision: number;
  /** SHA-256 for the exact routing graph BUILD, not the OSM PBF. */
  graphBuildSha256: string;
  /** Exact vehicle-specific costing/profile revision used for the route. */
  profileRevision: string;
  vehicleClass: ChargeVehicleClass;
}
export interface ChargeRouteObservedPassage {
  /** Distinct crossing occurrence even if the same edge is traversed twice. */
  occurrenceId: string;
  routeId: string;
  revision: number;
  graphBuildSha256: string;
  directedEdgeId: string;
  direction: 'forward' | 'reverse';
  passage: RouteChargeWindowPassage;
}
export interface ChargeRouteEvidenceSnapshot extends ChargeRouteSnapshotIdentity {
  observations: readonly ChargeRouteObservedPassage[];
}
export interface ChargeRouteSnapshotReview {
  status: 'internally_consistent' | 'blocked';
  reason: 'coherent_observations' | 'invalid_expected_route'
    | 'invalid_snapshot' | 'stale_route_revision' | 'graph_mismatch'
    | 'vehicle_or_profile_mismatch' | 'invalid_observation'
    | 'duplicate_observation' | 'invalid_charge_event_list'
    | 'non_monotonic_passage_time';
  /** Present only if all identifiers match. Even here, routes are NOT cleared. */
  summary?: RouteChargeWindowSummary;
  routeCoverageComplete: false;
  needsVerification: true;
  productionApproved: false;
}
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VEHICLES = new Set<ChargeVehicleClass>(['motorcycle', 'car', 'van', 'heavy', 'other']);
const MAX_OBSERVATIONS = 256;

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function identity(value: unknown): value is ChargeRouteSnapshotIdentity {
  return record(value) && value.schemaVersion === 1
    && typeof value.routeId === 'string' && TOKEN.test(value.routeId)
    && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0
    && typeof value.graphBuildSha256 === 'string' && SHA256.test(value.graphBuildSha256)
    && typeof value.profileRevision === 'string' && TOKEN.test(value.profileRevision)
    && VEHICLES.has(value.vehicleClass as ChargeVehicleClass);
}

/**
 * Compare a candidate charge snapshot against the current route identity
 * supplied separately by its caller. This rejects mixed plans/revisions,
 * graph builds, vehicle profiles and repeated crossing occurrences BEFORE
 * assessment. The caller MUST invalidate its expected identity on every
 * reroute/rebuild. We do not authenticate its claim or prove road coverage.
 */
export function reviewChargeRouteSnapshot(
  expectedActiveRoute: unknown,
  candidate: unknown,
): ChargeRouteSnapshotReview {
  const blocked = (reason: ChargeRouteSnapshotReview['reason']): ChargeRouteSnapshotReview => ({
    status: 'blocked', reason, routeCoverageComplete: false,
    needsVerification: true, productionApproved: false,
  });
  if (!identity(expectedActiveRoute)) return blocked('invalid_expected_route');
  if (!identity(candidate) || !record(candidate)
    || !Array.isArray(candidate.observations)
    || candidate.observations.length > MAX_OBSERVATIONS) return blocked('invalid_snapshot');
  if (expectedActiveRoute.routeId !== candidate.routeId
    || expectedActiveRoute.revision !== candidate.revision) return blocked('stale_route_revision');
  if (expectedActiveRoute.graphBuildSha256 !== candidate.graphBuildSha256)
    return blocked('graph_mismatch');
  if (expectedActiveRoute.profileRevision !== candidate.profileRevision
    || expectedActiveRoute.vehicleClass !== candidate.vehicleClass)
    return blocked('vehicle_or_profile_mismatch');

  const seen = new Set<string>();
  const passages: RouteChargeWindowPassage[] = [];
  let precedingPredictedAt: number | null = null;
  for (const observation of candidate.observations as unknown[]) {
    if (!record(observation)
      || typeof observation.occurrenceId !== 'string' || !TOKEN.test(observation.occurrenceId)
      || typeof observation.directedEdgeId !== 'string' || !TOKEN.test(observation.directedEdgeId)
      || (observation.direction !== 'forward' && observation.direction !== 'reverse')
      || !record(observation.passage)
      || observation.passage.eventId !== observation.occurrenceId) {
      return blocked('invalid_observation');
    }
    if (observation.routeId !== candidate.routeId
      || observation.revision !== candidate.revision) return blocked('stale_route_revision');
    if (observation.graphBuildSha256 !== candidate.graphBuildSha256)
      return blocked('graph_mismatch');
    if (seen.has(observation.occurrenceId)) return blocked('duplicate_observation');
    // Array order must represent consecutive crossings on this route. Compare
    // UTC instants rather than the lexical text of ISO offset timestamps.
    // Independent earliest/latest estimates MAY overlap; do not reject them.
    // Internal snapshot coherence requires a valid full ETA uncertainty
    // envelope, not merely a parseable predicted time. Otherwise a malformed
    // crossing could be labelled internally_consistent while its per-event
    // charging assessment silently falls back to unknown.
    const earliest = parseChargeInstant(observation.passage.earliestPassageAt);
    const predicted = parseChargeInstant(observation.passage.predictedPassageAt);
    const latest = parseChargeInstant(observation.passage.latestPassageAt);
    if (earliest === null || predicted === null || latest === null
      || earliest > predicted || predicted > latest
      || latest - earliest > MAX_CHARGE_PASSAGE_UNCERTAINTY_MINUTES * 60_000)
      return blocked('invalid_observation');
    if (precedingPredictedAt !== null && predicted < precedingPredictedAt)
      return blocked('non_monotonic_passage_time');
    precedingPredictedAt = predicted;
    seen.add(observation.occurrenceId);
    passages.push(observation.passage as unknown as RouteChargeWindowPassage);
  }
  const summary = summarizeRouteChargeWindows(candidate.vehicleClass, passages);
  if (summary.reason === 'invalid_event_list' || summary.reason === 'duplicate_event')
    return blocked('invalid_charge_event_list');
  return { status: 'internally_consistent', reason: 'coherent_observations', summary,
    routeCoverageComplete: false, needsVerification: true, productionApproved: false };
}
