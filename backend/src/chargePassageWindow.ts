/**
 * Charging-only, offline uncertainty assessment. NOT wired into navigation.
 * A route provider's single ETA cannot prove whether a crossing falls inside
 * or outside a charge window. No prices, road matching or access permissions.
 */
import { parseChargeInstant } from './chargeInstant.ts';
import { assessChargeExposure, type ChargeAssessment,
  type ChargeAssessmentInput } from './chargingRules.ts';

export const MAX_CHARGE_PASSAGE_UNCERTAINTY_MINUTES = 120;
const MINUTE_MS = 60_000;
const UK_OFFSET = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', timeZoneName: 'shortOffset',
});

export interface ChargePassageWindowInput extends Omit<ChargeAssessmentInput, 'passageAt'> {
  earliestPassageAt: string;
  predictedPassageAt: string;
  latestPassageAt: string;
}
export interface ChargePassageWindowResult {
  status: 'consistent' | 'unknown';
  reason: 'invalid_or_unbounded_window' | 'uk_clock_transition'
    | 'unverified_or_conflicting_exposure' | 'consistent_observed_rule';
  /** Present only when all checked instants agree on a non-unknown result. */
  assessment?: ChargeAssessment;
  routeCoverageComplete: false;
  requiresIndependentRoadAndAuthorityReview: true;
  productionApproved: false;
}

function ukOffset(ms: number): string | undefined {
  return UK_OFFSET.formatToParts(new Date(ms)).find(part => part.type === 'timeZoneName')?.value;
}
function sameAssessment(a: ChargeAssessment, b: ChargeAssessment): boolean {
  return a.schemeId === b.schemeId && a.outcome === b.outcome
    && a.reason === b.reason && a.localDate === b.localDate && a.unit === b.unit;
}

/**
 * All rule windows are minute-based in Europe/London. Verify the endpoints,
 * estimated instant and both sides of every intervening UTC minute boundary;
 * this catches charging-hour/holiday transitions even if both endpoints agree.
 * A UK clock change fails closed rather than interpreting a repeated hour.
 * Freshness deadlines are monotonic, so endpoint agreement also catches a
 * sub-minute expiration of a source/entitlement review.
 *
 * Consistency describes ONLY the supplied individual road event and rule.
 * It is never proof that the operator evidence is genuine, that every route
 * charge was detected, or that a whole route is charge-free.
 */
export function assessChargePassageWindow(input: ChargePassageWindowInput): ChargePassageWindowResult {
  const make = (reason: ChargePassageWindowResult['reason'],
    assessment?: ChargeAssessment): ChargePassageWindowResult => ({
    status: assessment ? 'consistent' : 'unknown',
    reason,
    ...(assessment ? { assessment } : {}),
    routeCoverageComplete: false,
    requiresIndependentRoadAndAuthorityReview: true,
    productionApproved: false,
  });
  if (!input || typeof input !== 'object') return make('invalid_or_unbounded_window');
  const start = parseChargeInstant(input.earliestPassageAt);
  const estimate = parseChargeInstant(input.predictedPassageAt);
  const end = parseChargeInstant(input.latestPassageAt);
  if (start === null || estimate === null || end === null
    || start > estimate || estimate > end
    || end - start > MAX_CHARGE_PASSAGE_UNCERTAINTY_MINUTES * MINUTE_MS) {
    return make('invalid_or_unbounded_window');
  }
  const startOffset = ukOffset(start);
  if (!startOffset || startOffset !== ukOffset(end)) return make('uk_clock_transition');

  const check = (at: number): ChargeAssessment => assessChargeExposure({
    ...input, passageAt: new Date(at).toISOString(),
  });
  const baseline = check(estimate);
  if (baseline.outcome === 'unknown') return make('unverified_or_conflicting_exposure');
  const consistentAt = (at: number): boolean => {
    const result = check(at);
    return result.outcome !== 'unknown' && sameAssessment(baseline, result);
  };
  if (!consistentAt(start) || !consistentAt(end))
    return make('unverified_or_conflicting_exposure');
  // UTC minute boundaries encompass every London-local minute change, even
  // during BST; examine 1 ms before AND exactly at each boundary.
  for (let boundary = Math.floor(start / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
    boundary <= end; boundary += MINUTE_MS) {
    if (!consistentAt(boundary - 1) || !consistentAt(boundary))
      return make('unverified_or_conflicting_exposure');
  }
  return make('consistent_observed_rule', baseline);
}
