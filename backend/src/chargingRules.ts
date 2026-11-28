/**
 * Future-feature charging assessment. NOT connected to live navigation.
 * A rule must be supplied by a separately validated, versioned authority feed;
 * we deliberately ship NO production boundaries, tariffs or schedules here.
 * Never turn client-declared passes into verified exemptions.
 */
import { reviewChargeEvidenceFreshness } from './chargeSourceFreshness.ts';
import { parseChargeInstant } from './chargeInstant.ts';

export type ChargingSchemeId =
  | 'london_congestion' | 'london_ulez' | 'london_lez'
  | 'blackwall_silvertown' | 'dart_charge' | 'uk_caz' | 'oxford_zez';
export type ChargeVehicleClass = 'motorcycle' | 'car' | 'van' | 'heavy' | 'other';
export type ChargeUnit = 'daily' | 'per_crossing';
export type RouteChargeEvidence = 'unknown' | 'polygon_overlap' | 'confirmed_crossing' | 'confirmed_no_crossing';
export type EntitlementStatus = 'unknown' | 'exempt' | 'compliant' | 'discounted' | 'registered' | 'paying';

export interface ChargeWindow {
  /** Sunday 0 to Saturday 6; start is inclusive, end exclusive. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}
export interface ChargeDayOverride {
  /** Official exceptions including bank holidays and Christmas shutdowns. */
  date: string; // YYYY-MM-DD in Europe/London
  periods: ReadonlyArray<Pick<ChargeWindow, 'startMinute' | 'endMinute'>>;
}
export interface ChargingRule {
  schemeId: ChargingSchemeId;
  /** Required for UK CAZs: a verified local authority scheme ID, not a generic CAZ entitlement. */
  zoneId?: string;
  unit: ChargeUnit;
  sourceUrl: string;
  checkedAt: string; // Offset-bearing ISO instant
  /** Inclusive coverage, not a licence to extrapolate future policy. */
  effectiveFrom: string;
  effectiveThrough: string;
  /** Date through which all date-specific exceptions were verified. */
  exceptionsReviewedThrough: string;
  vehicleClasses: ReadonlyArray<ChargeVehicleClass>;
  weeklyWindows: ReadonlyArray<ChargeWindow>;
  exceptions: ReadonlyArray<ChargeDayOverride>;
  /** 'Compliant' only waives a charge on emissions schemes, never a generic toll. */
  waivingStatuses: ReadonlyArray<'exempt' | 'compliant'>;
}
export interface ChargeEntitlement {
  schemeId: ChargingSchemeId;
  /** Prevent an exemption issued for one city's CAZ applying to another city. */
  zoneId?: string;
  vehicleClass: ChargeVehicleClass;
  status: EntitlementStatus;
  source: 'user_declared' | 'operator_verified';
  /** Both are required for any operator-verified free-route conclusion. */
  checkedAt?: string;
  validThrough?: string; // YYYY-MM-DD, inclusive
}
export interface ChargeAssessmentInput {
  schemeId: ChargingSchemeId;
  passageAt: string; // crossing/zone entry time as an offset-bearing ISO instant; NOT route departure
  vehicleClass: ChargeVehicleClass;
  roadEvidence: RouteChargeEvidence;
  rule?: ChargingRule;
  entitlement?: ChargeEntitlement;
}
export type ChargeOutcome =
  | 'unknown' | 'not_on_route' | 'outside_hours'
  | 'vehicle_not_subject' | 'verified_exempt' | 'possible_charge';
export interface ChargeAssessment {
  schemeId: ChargingSchemeId;
  outcome: ChargeOutcome;
  reason: 'missing_or_invalid_data' | 'unverified_road_geometry' | 'no_crossing'
    | 'outside_verified_period' | 'stale_source_review' | 'source_review_after_passage'
    | 'not_charging_now' | 'vehicle_out_of_scope'
    | 'authority_verified_waiver' | 'charge_may_apply';
  /** For downstream de-duplication, never proof of a payable price. */
  localDate?: string;
  unit?: ChargeUnit;
}

const LONDON_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const VEHICLES = new Set<ChargeVehicleClass>(['motorcycle', 'car', 'van', 'heavy', 'other']);
const WAIVERS = new Set(['exempt', 'compliant']);
const SCHEMES = new Set<ChargingSchemeId>(['london_congestion', 'london_ulez', 'london_lez',
  'blackwall_silvertown', 'dart_charge', 'uk_caz', 'oxford_zez']);
// A provider's data must never reclassify a crossing as a daily zone or vice versa.
const UNIT_BY_SCHEME: Record<ChargingSchemeId, ChargeUnit> = {
  london_congestion: 'daily', london_ulez: 'daily', london_lez: 'daily',
  blackwall_silvertown: 'per_crossing', dart_charge: 'per_crossing',
  uk_caz: 'daily', oxford_zez: 'daily',
};
const EMISSIONS_SCHEMES = new Set<ChargingSchemeId>(['london_ulez', 'london_lez', 'uk_caz']);
export function validChargingZoneId(schemeId: ChargingSchemeId, zoneId: string | undefined): boolean {
  return schemeId === 'uk_caz'
    ? typeof zoneId === 'string' && /^[a-z][a-z0-9_-]{2,63}$/.test(zoneId)
    : zoneId === undefined;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function parseInstant(value: unknown): Date | null {
  const instant = parseChargeInstant(value);
  return instant === null ? null : new Date(instant);
}
function validPeriod(value: unknown): value is { startMinute: number; endMinute: number } {
  if (!value || typeof value !== 'object') return false;
  const period = value as Partial<ChargeWindow>;
  return Number.isInteger(period.startMinute) && period.startMinute! >= 0
    && Number.isInteger(period.endMinute) && period.endMinute! <= 1440
    && period.startMinute! < period.endMinute!;
}
function validHttpsSource(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch { return false; }
}
function validRule(rule: ChargingRule, scheme: ChargingSchemeId): boolean {
  if (rule.schemeId !== scheme || !SCHEMES.has(scheme) || !validChargingZoneId(scheme, rule.zoneId)
    || rule.unit !== UNIT_BY_SCHEME[scheme]
    || !validHttpsSource(rule.sourceUrl)
    || !parseInstant(rule.checkedAt)
    || !validDate(rule.effectiveFrom) || !validDate(rule.effectiveThrough)
    || !validDate(rule.exceptionsReviewedThrough) || rule.effectiveFrom > rule.effectiveThrough
    // An empty scope or schedule cannot establish a vehicle exemption or
    // a charge-free time; require explicitly reviewed nonempty authority data.
    || !Array.isArray(rule.vehicleClasses) || rule.vehicleClasses.length === 0
    || !rule.vehicleClasses.every(v => VEHICLES.has(v))
    || !Array.isArray(rule.weeklyWindows) || rule.weeklyWindows.length === 0
    || !Array.isArray(rule.exceptions)
    || !Array.isArray(rule.waivingStatuses)
    || !rule.waivingStatuses.every(v => WAIVERS.has(v))
    || (rule.waivingStatuses.includes('compliant') && !EMISSIONS_SCHEMES.has(scheme))
    || rule.weeklyWindows.some(w => !w || !Number.isInteger(w.dayOfWeek) || w.dayOfWeek < 0 || w.dayOfWeek > 6 || !validPeriod(w))
    || rule.exceptions.some(d => !d || !validDate(d.date) || !Array.isArray(d.periods) || d.periods.some((p: unknown) => !validPeriod(p)))) return false;
  const days = rule.exceptions.map(d => d.date);
  return new Set(days).size === days.length;
}
function londonParts(date: Date): { localDate: string; day: number; minute: number } | null {
  const parts = Object.fromEntries(LONDON_PARTS.formatToParts(date).map(p => [p.type, p.value]));
  const day = WEEKDAYS[parts.weekday ?? ''];
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (day === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23
    || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { localDate: [parts.year, parts.month, parts.day].join('-'), day, minute: hour * 60 + minute };
}

/** Derive the UK charging calendar date from the actual passage instant. */
export function londonChargingDate(passageAt: string): string | null {
  const instant = parseInstant(passageAt);
  return instant ? londonParts(instant)?.localDate ?? null : null;
}

/** A cautious, deterministic assessment, NOT a price quote or navigation instruction. */
export function assessChargeExposure(input: ChargeAssessmentInput): ChargeAssessment {
  const { schemeId, roadEvidence, vehicleClass, entitlement, rule } = input;
  const unknown = (reason: ChargeAssessment['reason']): ChargeAssessment => ({ schemeId, outcome: 'unknown', reason });
  const when = parseInstant(input.passageAt);
  if (!when || !rule || !validRule(rule, schemeId) || !VEHICLES.has(vehicleClass)) return unknown('missing_or_invalid_data');
  const local = londonParts(when);
  if (!local) return unknown('missing_or_invalid_data');
  if (local.localDate < rule.effectiveFrom || local.localDate > rule.effectiveThrough
    || local.localDate > rule.exceptionsReviewedThrough) return unknown('outside_verified_period');
  // The rule's long effective period and exception calendar are NOT enough
  // to justify a no-charge or exempt decision when the authority source
  // has not been rechecked recently. This runs before all road, vehicle,
  // hours and exemption outcomes (including confirmed_no_crossing).
  const review = reviewChargeEvidenceFreshness('rule', rule.checkedAt, input.passageAt);
  if (review.status !== 'fresh') {
    return unknown(review.status === 'review_after_passage'
      ? 'source_review_after_passage' : 'stale_source_review');
  }
  const make = (outcome: ChargeOutcome, reason: ChargeAssessment['reason']): ChargeAssessment =>
    ({ schemeId, outcome, reason, localDate: local.localDate, unit: rule.unit });
  if (roadEvidence === 'confirmed_no_crossing') return make('not_on_route', 'no_crossing');
  if (roadEvidence !== 'confirmed_crossing') return unknown('unverified_road_geometry');
  if (!rule.vehicleClasses.includes(vehicleClass)) return make('vehicle_not_subject', 'vehicle_out_of_scope');
  const override = rule.exceptions.find(d => d.date === local.localDate);
  const windows = override ? override.periods : rule.weeklyWindows.filter(w => w.dayOfWeek === local.day);
  if (!windows.some(w => w.startMinute <= local.minute && local.minute < w.endMinute)) {
    return make('outside_hours', 'not_charging_now');
  }
  // Never treat a user-declared toggle, discount, payment registration or
  // stale/incorrect vehicle entitlement as a verified full exemption.
  if (entitlement?.schemeId === schemeId && entitlement.vehicleClass === vehicleClass
    && validChargingZoneId(schemeId, entitlement.zoneId)
    && entitlement.zoneId === rule.zoneId
    && entitlement.source === 'operator_verified' && rule.waivingStatuses.includes(entitlement.status as 'exempt' | 'compliant')
    && reviewChargeEvidenceFreshness('entitlement', entitlement.checkedAt, input.passageAt).status === 'fresh'
    && validDate(entitlement.validThrough)
    && entitlement.validThrough >= local.localDate) {
    return make('verified_exempt', 'authority_verified_waiver');
  }
  return make('possible_charge', 'charge_may_apply');
}
