/**
 * Future-only, offline multi-event charging projection. All results remain
 * advisory: matching observed events is not a proof of whole-route coverage.
 * This module does not communicate with Maps, providers or live navigation.
 */
import {
  assessChargePassageWindow,
  type ChargePassageWindowInput,
  type ChargePassageWindowResult,
} from './chargePassageWindow.ts';
import { validChargingZoneId, type ChargeVehicleClass,
  type ChargingSchemeId } from './chargingRules.ts';

export interface RouteChargeWindowPassage extends Omit<ChargePassageWindowInput, 'vehicleClass'> {
  /** Unique per observed crossing on this invocation; never a graph edge ID. */
  eventId: string;
  /** Exact authority-specific Clean Air Zone, if and only if scheme is UK CAZ. */
  zoneId?: string;
}
export interface RouteChargeWindowEvent {
  eventId: string;
  schemeId: ChargingSchemeId;
  zoneId?: string;
  assessment: ChargePassageWindowResult;
}
export interface RouteChargeWindowSummary {
  /** Distinct *observed possible* daily exposures, not a price or route total. */
  possibleDailyChargeDays: number;
  /** Distinct *observed possible* pay-per-crossing events, not a price. */
  possibleCrossingCharges: number;
  /** Every unknown event could still involve a charge. */
  unknownEventCount: number;
  /** Source coverage, identity matching, and complete route graph not proven. */
  routeCoverageComplete: false;
  needsVerification: true;
  productionApproved: false;
  reason?: 'no_evidence' | 'invalid_event_list' | 'duplicate_event';
  results: RouteChargeWindowEvent[];
}
const MAX_ROUTE_CHARGE_WINDOW_EVENTS = 256;

/**
 * Evaluate every observed event independently using a single rider vehicle
 * class and conservative ETA uncertainty. Daily exposure is deduplicated by
 * scheme, authority zone and London-local charging date; separate tunnel or
 * bridge crossings remain separate. No event is carried across invocations:
 * callers must recalculate on reroute or graph/rules revision.
 *
 * WARNING: even 0 possible charges does NOT mean a free or charge-free route.
 * This function cannot independently establish that every charged road was
 * detected, that input road matching is authoritative, or that evidence is
 * lawfully reused. It never returns routeCoverageComplete=true.
 */
export function summarizeRouteChargeWindows(
  vehicleClass: ChargeVehicleClass,
  passages: readonly RouteChargeWindowPassage[],
): RouteChargeWindowSummary {
  const empty = (reason: RouteChargeWindowSummary['reason']): RouteChargeWindowSummary => ({
    possibleDailyChargeDays: 0, possibleCrossingCharges: 0, unknownEventCount: 0,
    routeCoverageComplete: false, needsVerification: true, productionApproved: false,
    reason, results: [],
  });
  if (!Array.isArray(passages) || passages.length > MAX_ROUTE_CHARGE_WINDOW_EVENTS)
    return empty('invalid_event_list');
  if (passages.length === 0) return empty('no_evidence');
  const ids = new Set<string>();
  const daily = new Set<string>();
  const results: RouteChargeWindowEvent[] = [];
  let crossings = 0;
  let unknownEvents = 0;

  for (const passage of passages) {
    if (!passage || typeof passage.eventId !== 'string'
      || passage.eventId.trim().length === 0 || passage.eventId.length > 128)
      return empty('invalid_event_list');
    if (ids.has(passage.eventId)) return empty('duplicate_event');
    ids.add(passage.eventId);
    const zoneMatches = passage.schemeId === 'uk_caz'
      ? validChargingZoneId(passage.schemeId, passage.zoneId)
        && passage.rule?.zoneId === passage.zoneId
      : passage.zoneId === undefined && passage.rule?.zoneId === undefined;
    const assessment: ChargePassageWindowResult = zoneMatches
      ? assessChargePassageWindow({ ...passage, vehicleClass })
      : {
        status: 'unknown', reason: 'unverified_or_conflicting_exposure',
        routeCoverageComplete: false, requiresIndependentRoadAndAuthorityReview: true,
        productionApproved: false,
      };
    results.push({ eventId: passage.eventId, schemeId: passage.schemeId,
      ...(passage.zoneId === undefined ? {} : { zoneId: passage.zoneId }), assessment });
    if (assessment.status !== 'consistent' || !assessment.assessment) {
      unknownEvents += 1;
      continue;
    }
    const individual = assessment.assessment;
    if (individual.outcome !== 'possible_charge') continue;
    if (individual.unit === 'daily' && individual.localDate) {
      daily.add(JSON.stringify([passage.schemeId, passage.zoneId ?? '', individual.localDate]));
    } else if (individual.unit === 'per_crossing') {
      crossings += 1;
    } else {
      // Future evaluator changes must not silently turn a missing charge unit
      // or local date into a no-charge event.
      unknownEvents += 1;
    }
  }
  return { possibleDailyChargeDays: daily.size, possibleCrossingCharges: crossings,
    unknownEventCount: unknownEvents, routeCoverageComplete: false,
    needsVerification: true, productionApproved: false, results };
}
