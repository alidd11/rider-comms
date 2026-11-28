/** Offline research only. Evaluate an exact continuous DRIVING interval, not
 * parking, a boundary contact, or an ETA uncertainty window. No live callers. */
import { parseChargeInstant } from './chargeInstant.ts';
import { assessChargeExposure, londonChargingDate, type ChargeVehicleClass, type ChargingRule } from './chargingRules.ts';

const DAILY_SCHEMES = new Set(['london_congestion', 'london_ulez', 'london_lez', 'uk_caz', 'oxford_zez']);
const MINUTE = 60_000;
const MAX_DRIVING_MS = 120 * MINUTE;
export interface DailyDrivingInterval {
  startedAt: string;
  endedAt: string;
  vehicleClass: ChargeVehicleClass;
  evidence: 'continuous_driving_within_zone' | 'unknown';
  rule: ChargingRule;
}
export interface DailyDrivingReview {
  status: 'advisory_only' | 'unknown';
  possibleChargeDates: string[];
  unknownDates: string[];
  routeCoverageComplete: false;
  productionApproved: false;
}

/** Half-open [start,end) interval. Sample every UK civil-minute boundary
 * (UTC minute boundaries also align in modern UK time). An operator entitlement
 * is deliberately not accepted until vehicle identity binding is implemented. */
export function reviewDailyDrivingInterval(input: DailyDrivingInterval): DailyDrivingReview {
  const result = (status: DailyDrivingReview['status'], possibleChargeDates: string[] = [], unknownDates: string[] = []): DailyDrivingReview =>
    ({ status, possibleChargeDates, unknownDates, routeCoverageComplete: false, productionApproved: false });
  if (!input || input.evidence !== 'continuous_driving_within_zone'
    || !input.rule || input.rule.unit !== 'daily' || !DAILY_SCHEMES.has(input.rule.schemeId)) return result('unknown');
  const start = parseChargeInstant(input.startedAt);
  const end = parseChargeInstant(input.endedAt);
  if (start === null || end === null || end <= start || end - start > MAX_DRIVING_MS) return result('unknown');
  const possible = new Set<string>();
  const unknown = new Set<string>();
  const sample = (at: number): void => {
    const instant = new Date(at).toISOString();
    const day = londonChargingDate(instant);
    if (!day) return;
    const assessment = assessChargeExposure({ schemeId: input.rule.schemeId, passageAt: instant,
      vehicleClass: input.vehicleClass, roadEvidence: 'confirmed_crossing', rule: input.rule });
    if (assessment.outcome === 'possible_charge') possible.add(day);
    if (assessment.outcome === 'unknown') unknown.add(day);
  };
  sample(start);
  for (let at = Math.floor(start / MINUTE) * MINUTE + MINUTE; at < end; at += MINUTE) {
    sample(at - 1);
    sample(at);
  }
  sample(end - 1);
  return result(unknown.size ? 'unknown' : 'advisory_only', [...possible].sort(), [...unknown].sort());
}
