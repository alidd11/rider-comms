/**
 * Offline, future-only route exposure aggregation. A route planner must supply
 * independently verified road-level passage events. This function never fetches
 * data, identifies chargeable roads from polygons, calculates prices, or
 * participates in live navigation.
 */
import {
  assessChargeExposure,
  londonChargingDate,
  type ChargeAssessment,
  type ChargeEntitlement,
  type ChargeVehicleClass,
  type ChargingRule,
  type ChargingSchemeId,
  type RouteChargeEvidence,
} from './chargingRules.ts';
import { screenRouteAgainstChargeZone, type PreparedChargeZone, type RoutePosition,
  type ZoneScreenResult } from './chargeZoneGeometry.ts';

export interface RouteChargePassage {
  /** Stable ID for one road-level crossing observation on this route. */
  eventId: string;
  schemeId: ChargingSchemeId;
  /** Required for local-authority-specific UK Clean Air Zones. */
  zoneId?: string;
  /** Actual predicted passage instant, never assumed to be departure time. */
  passageAt: string;
  roadEvidence: RouteChargeEvidence;
  rule?: ChargingRule;
  entitlement?: ChargeEntitlement;
}
export interface RouteChargeEventResult {
  eventId: string;
  schemeId: ChargingSchemeId;
  zoneId?: string;
  assessment: ChargeAssessment;
}
export interface RouteChargeSummary {
  /** Potential exposure count, NOT a verified charge or amount payable. */
  possibleDailyChargeDays: number;
  possibleCrossingCharges: number;
  /** Some events are uncertain; the summary cannot be interpreted as complete. */
  needsVerification: boolean;
  reason?: 'no_evidence' | 'invalid_event_list' | 'duplicate_event';
  results: RouteChargeEventResult[];
}
const MAX_PASSAGES = 256;

/**
 * Deduplicates potential daily charges by scheme, zone and London-local date.
 * It does not deduplicate separate crossings; each requires a unique eventId.
 * Unknown results NEVER imply a charge-free route.
 */
export function summarizeRouteChargePassages(
  vehicleClass: ChargeVehicleClass,
  passages: readonly RouteChargePassage[],
): RouteChargeSummary {
  const empty = (reason: RouteChargeSummary['reason']): RouteChargeSummary => ({
    possibleDailyChargeDays: 0,
    possibleCrossingCharges: 0,
    needsVerification: true,
    reason,
    results: [],
  });
  if (!Array.isArray(passages) || passages.length > MAX_PASSAGES) return empty('invalid_event_list');
  if (passages.length === 0) return empty('no_evidence');
  const ids = new Set<string>();
  const daily = new Set<string>();
  const results: RouteChargeEventResult[] = [];
  let crossingCount = 0;
  let needsVerification = false;
  for (const passage of passages) {
    if (!passage || typeof passage.eventId !== 'string' || passage.eventId.length < 1 || passage.eventId.length > 128) {
      return empty('invalid_event_list');
    }
    if (ids.has(passage.eventId)) return empty('duplicate_event');
    ids.add(passage.eventId);
    // The zone and rule must describe the *same* local charging authority.
    // Generic CAZ passes cannot be reused between unrelated cities.
    const zoneMatches = passage.schemeId !== 'uk_caz'
      || Boolean(passage.zoneId && passage.rule?.zoneId === passage.zoneId);
    const assessment = zoneMatches
      ? assessChargeExposure({ ...passage, vehicleClass })
      : { schemeId: passage.schemeId, outcome: 'unknown', reason: 'missing_or_invalid_data' } as ChargeAssessment;
    results.push({ eventId: passage.eventId, schemeId: passage.schemeId,
      ...(passage.zoneId ? { zoneId: passage.zoneId } : {}), assessment });
    if (assessment.outcome === 'unknown') needsVerification = true;
    if (assessment.outcome !== 'possible_charge') continue;
    // A future rule returning a potential charge without a known charge unit
    // or date remains unverified, rather than looking charge-free.
    needsVerification ||= assessment.unit !== 'per_crossing'
      && !(assessment.unit === 'daily' && Boolean(assessment.localDate));
    if (assessment.unit === 'daily' && assessment.localDate) {
      daily.add(JSON.stringify([passage.schemeId, passage.zoneId ?? '', assessment.localDate]));
    } else if (assessment.unit === 'per_crossing') {
      crossingCount += 1;
    }
  }
  return { possibleDailyChargeDays: daily.size, possibleCrossingCharges: crossingCount,
    needsVerification, results };
}

/**
 * A no-network screening step for route geometry already available to the
 * application. Geometry can suggest zone contact; it is NEVER road evidence
 * suitable to declare a charge or a free passage.
 */
export interface RouteZoneScreening {
  possibleContacts: number;
  requiresReview: boolean;
  results: ZoneScreenResult[];
}
export function screenChargeAreasForRoute(
  route: readonly RoutePosition[],
  passageAt: string,
  zones: readonly (PreparedChargeZone | null)[],
): RouteZoneScreening {
  // Missing coverage or too many independently supplied zones means we do not
  // know whether charging data covers the journey. Fail closed.
  if (!Array.isArray(zones) || zones.length === 0 || zones.length > 64) {
    return { possibleContacts: 0, requiresReview: true, results: [] };
  }
  const londonLocalDate = londonChargingDate(passageAt);
  if (!londonLocalDate) return { possibleContacts: 0, requiresReview: true, results: [] };
  const results = zones.map(zone => screenRouteAgainstChargeZone(route, zone, londonLocalDate));
  return {
    possibleContacts: results.filter(result => result.status === 'possible_polygon_contact').length,
    // Even 'no polygon contact' cannot prove no charge without complete and
    // validated road restrictions. This is always advisory only.
    requiresReview: true,
    results,
  };
}
