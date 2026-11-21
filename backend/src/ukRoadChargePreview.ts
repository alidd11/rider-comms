/**
 * Draft-only, no-network combined UK road-charge preview. Keeps zonal/daily
 * charges, individual crossings and M6 Toll journeys distinct; NEVER a quote,
 * verified road match, route preference or proof that a trip is toll-free.
 *
 * No production caller imports this module while the feature is gated off.
 */
import { previewRiderChargeExposure } from './riderVehicleChargePreview.ts';
import { reviewM6TollRoute, type M6TollJourneyCandidate } from './m6TollJourney.ts';
import { findEnglishTollInfrastructure } from './ukTollInfrastructure.ts';
import type { RouteChargePassage } from './routeChargeSummary.ts';

export interface UKRoadChargePreviewInput {
  riderVehicle: unknown;
  /** Existing reviewed observations from independent future road-level tooling. */
  chargePassages: readonly RouteChargePassage[];
  /** Entry/exit candidates are not proof of completed M6 Toll journeys. */
  m6Journeys: readonly M6TollJourneyCandidate[];
  /** Route hints, never a definitive list of all roads traversed. */
  possibleTollInfrastructureIds: readonly string[];
}
export interface UKRoadChargePreview {
  status: 'advisory_only' | 'invalid_input' | 'unknown_vehicle';
  possibleDailyChargeDays: number;
  possibleCrossingCharges: number;
  possibleM6TollJourneys: number;
  /** Named bridges/tunnels require operator-verified road and vehicle rules. */
  infrastructureRequiringReview: string[];
  /** A route hint not found in the dated English reference catalogue. */
  unknownInfrastructureIds: string[];
  needsOperatorReview: true;
  completeRouteCoverageVerified: false;
  /** No amounts, inferred exemptions or toll-free claims are emitted. */
}
const MAX_HINTS = 128;
export function previewUKRoadCharges(input: UKRoadChargePreviewInput): UKRoadChargePreview {
  const empty = (status: UKRoadChargePreview['status']): UKRoadChargePreview => ({
    status, possibleDailyChargeDays: 0, possibleCrossingCharges: 0,
    possibleM6TollJourneys: 0, infrastructureRequiringReview: [],
    unknownInfrastructureIds: [], needsOperatorReview: true,
    completeRouteCoverageVerified: false,
  });
  if (!input || !Array.isArray(input.chargePassages) || !Array.isArray(input.m6Journeys)
    || !Array.isArray(input.possibleTollInfrastructureIds)
    || input.possibleTollInfrastructureIds.length > MAX_HINTS
    || input.possibleTollInfrastructureIds.some(id =>
      typeof id !== 'string' || !/^[a-z][a-z0-9_-]{2,63}$/.test(id))
    || new Set(input.possibleTollInfrastructureIds).size !== input.possibleTollInfrastructureIds.length)
    return empty('invalid_input');
  const rider = previewRiderChargeExposure(input.riderVehicle, input.chargePassages);
  if (rider.status === 'unknown_vehicle') return empty('unknown_vehicle');
  const motorway = reviewM6TollRoute(input.m6Journeys);
  const known: string[] = [];
  const unknown: string[] = [];
  for (const id of input.possibleTollInfrastructureIds) {
    if (findEnglishTollInfrastructure(id)) known.push(id);
    else unknown.push(id);
  }
  return {
    status: 'advisory_only',
    possibleDailyChargeDays: rider.summary.possibleDailyChargeDays,
    possibleCrossingCharges: rider.summary.possibleCrossingCharges,
    possibleM6TollJourneys: motorway.possibleMotorwayTollJourneys,
    infrastructureRequiringReview: known,
    unknownInfrastructureIds: unknown,
    needsOperatorReview: true,
    completeRouteCoverageVerified: false,
  };
}
