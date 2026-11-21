/**
 * Future-only, no-network M6 Toll journey screening.
 *
 * M6 Toll prices depend on the actual entry/exit, zones traversed, operator
 * vehicle class and account tariff. This pure module NEVER quotes a price,
 * checks eligibility, proves a road passage, or influences live navigation.
 */
import { classifyRiderVehicleForCharging } from './riderVehicleChargePreview.ts';
import type { ChargeVehicleClass } from './chargingRules.ts';

export const M6_TOLL_OFFICIAL_JUNCTION_SOURCE =
  'https://www.m6toll.co.uk/using-the-m6toll/what-to-expect/';
export const M6_TOLL_OFFICIAL_TARIFF_SOURCE = 'https://www.m6toll.co.uk/pricing/';
export type M6Direction = 'northbound' | 'southbound';
export type M6Junction =
  | 'M6_SOUTH' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6'
  | 'T7' | 'T8' | 'M6_NORTH';
const ORDER: readonly M6Junction[] = [
  'M6_SOUTH', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'M6_NORTH',
];
// Based only on the operator's publicly described entry/exit directions.
// Not an authoritative road graph, and junctions can temporarily close.
const NORTH_ENTRIES: readonly M6Junction[] =
  ['M6_SOUTH', 'T1', 'T3', 'T4', 'T5', 'T6'];
const NORTH_EXITS: readonly M6Junction[] =
  ['T1', 'T3', 'T4', 'T6', 'T7', 'T8', 'M6_NORTH'];
const SOUTH_ENTRIES: readonly M6Junction[] =
  ['M6_NORTH', 'T8', 'T7', 'T6', 'T4', 'T3', 'T1'];
const SOUTH_EXITS: readonly M6Junction[] =
  ['T6', 'T5', 'T4', 'T3', 'T2', 'M6_SOUTH'];

export interface M6TollJourneyCandidate {
  journeyId: string;
  direction: M6Direction;
  entry: M6Junction;
  exit: M6Junction;
  enteredAt: string;
  exitedAt: string;
  /** Optional operator-map observation; NOT inferred from junction numbers. */
  observedZones?: 1 | 2 | 3;
  /** User's vehicle preference is not its M6 Toll operator vehicle class. */
  riderVehicle: unknown;
}
export interface M6TollJourneyReview {
  status: 'possible_toll_journey' | 'unknown';
  reason: 'candidate_only' | 'invalid_journey' | 'invalid_entry_or_exit'
    | 'unknown_vehicle' | 'invalid_observed_zones';
  journeyId: string | null;
  /** Observed count only. A valid value is NOT a verified tariff zone. */
  observedZones: 1 | 2 | 3 | null;
  coarseVehicleClass: ChargeVehicleClass | null;
  requiresOperatorRoadReview: true;
  requiresOperatorVehicleClassReview: true;
  requiresOperatorTariffReview: true;
  routeCoverageComplete: false;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !INSTANT.test(value) || !DATE.test(value.slice(0, 10))) return null;
  const datePart = value.slice(0, 10);
  const day = new Date(datePart + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== datePart) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
const MAX_JOURNEY_HOURS = 48;
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value);
function junctionsFeasible(input: M6TollJourneyCandidate): boolean {
  const entryIndex = ORDER.indexOf(input.entry);
  const exitIndex = ORDER.indexOf(input.exit);
  if (entryIndex < 0 || exitIndex < 0 || entryIndex === exitIndex) return false;
  return input.direction === 'northbound'
    ? NORTH_ENTRIES.includes(input.entry) && NORTH_EXITS.includes(input.exit) && entryIndex < exitIndex
    : input.direction === 'southbound'
      && SOUTH_ENTRIES.includes(input.entry) && SOUTH_EXITS.includes(input.exit)
      && entryIndex > exitIndex;
}

/** A candidate motorway trip, not a legal charging or price decision. */
export function reviewM6TollJourney(input: M6TollJourneyCandidate): M6TollJourneyReview {
  const make = (status: M6TollJourneyReview['status'], reason: M6TollJourneyReview['reason'],
    vehicle: ChargeVehicleClass | null = null, zones: 1 | 2 | 3 | null = null): M6TollJourneyReview => ({
    status, reason, journeyId: validId(input?.journeyId) ? input.journeyId : null,
    observedZones: zones, coarseVehicleClass: vehicle,
    requiresOperatorRoadReview: true, requiresOperatorVehicleClassReview: true,
    requiresOperatorTariffReview: true, routeCoverageComplete: false,
  });
  if (!input || !validId(input.journeyId)) return make('unknown', 'invalid_journey');
  const start = instant(input.enteredAt), end = instant(input.exitedAt);
  if (start === null || end === null || end <= start
    || end - start > MAX_JOURNEY_HOURS * 60 * 60 * 1000) return make('unknown', 'invalid_journey');
  if (!junctionsFeasible(input)) return make('unknown', 'invalid_entry_or_exit');
  const vehicle = classifyRiderVehicleForCharging(input.riderVehicle);
  if (!vehicle) return make('unknown', 'unknown_vehicle');
  if (input.observedZones !== undefined && input.observedZones !== 1
    && input.observedZones !== 2 && input.observedZones !== 3)
    return make('unknown', 'invalid_observed_zones', vehicle.chargeClass);
  return make('possible_toll_journey', 'candidate_only',
    vehicle.chargeClass, input.observedZones ?? null);
}
export interface M6TollRouteReview {
  possibleMotorwayTollJourneys: number;
  needsVerification: true;
  reason?: 'no_observations' | 'invalid_journeys' | 'duplicate_journey';
  journeyReviews: M6TollJourneyReview[];
}
/** Each complete entry/exit pair counts once; a plaza observation is not a trip. */
export function reviewM6TollRoute(
  journeys: readonly M6TollJourneyCandidate[],
): M6TollRouteReview {
  const failed = (reason: NonNullable<M6TollRouteReview['reason']>): M6TollRouteReview =>
    ({ possibleMotorwayTollJourneys: 0, needsVerification: true, reason, journeyReviews: [] });
  if (!Array.isArray(journeys) || journeys.length > 64) return failed('invalid_journeys');
  if (!journeys.length) return failed('no_observations');
  const ids = new Set<string>();
  const journeyReviews: M6TollJourneyReview[] = [];
  for (const journey of journeys) {
    if (!journey || !validId(journey.journeyId)) return failed('invalid_journeys');
    if (ids.has(journey.journeyId)) return failed('duplicate_journey');
    ids.add(journey.journeyId);
    journeyReviews.push(reviewM6TollJourney(journey));
  }
  return {
    possibleMotorwayTollJourneys: journeyReviews.filter(x => x.status === 'possible_toll_journey').length,
    needsVerification: true,
    journeyReviews,
  };
}
