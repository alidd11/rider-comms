/**
 * Future-feature charging assessment. NOT connected to live navigation.
 * A rule must be supplied by a separately validated, versioned authority feed;
 * we deliberately ship NO production boundaries, tariffs or schedules here.
 * Never turn client-declared passes into verified exemptions.
 */
export type ChargingSchemeId =
  | 'london_congestion' | 'london_ulez' | 'london_lez'
  | 'blackwall_silvertown' | 'dart_charge' | 'uk_caz';
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
    | 'outside_verified_period' | 'not_charging_now' | 'vehicle_out_of_scope'
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
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const VEHICLES = new Set<ChargeVehicleClass>(['motorcycle', 'car', 'van', 'heavy', 'other']);
const WAIVERS = new Set(['exempt', 'compliant']);
const SCHEMES = new Set<ChargingSchemeId>(['london_congestion', 'london_ulez', 'london_lez', 'blackwall_silvertown', 'dart_charge', 'uk_caz']);
// A provider's data must never reclassify a crossing as a daily zone or vice versa.
const UNIT_BY_SCHEME: Record<ChargingSchemeId, ChargeUnit> = {
  london_congestion: 'daily', london_ulez: 'daily', london_lez: 'daily',
  blackwall_silvertown: 'per_crossing', dart_charge: 'per_crossing', uk_caz: 'daily',
};
const EMISSIONS_SCHEMES = new Set<ChargingSchemeId>(['london_ulez', 'london_lez', 'uk_caz']);

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return null;
  if (!validDate(value.slice(0, 10))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function validPeriod(value: { startMinute: number; endMinute: number }): boolean {
  return Number.isInteger(value.startMinute) && value.startMinute >= 0
    && Number.isInteger(value.endMinute) && value.endMinute <= 1440
    && value.startMinute < value.endMinute;
}
function validRule(rule: ChargingRule, scheme: ChargingSchemeId): boolean {
  if (rule.schemeId !== scheme || !SCHEMES.has(scheme) || rule.unit !== UNIT_BY_SCHEME[scheme]
    || typeof rule.sourceUrl !== 'string' || !/^https:\/\//.test(rule.sourceUrl)
    || !parseInstant(rule.checkedAt)
    || !validDate(rule.effectiveFrom) || !validDate(rule.effectiveThrough)
    || !validDate(rule.exceptionsReviewedThrough) || rule.effectiveFrom > rule.effectiveThrough
    || !Array.isArray(rule.vehicleClasses) || !rule.vehicleClasses.every(v => VEHICLES.has(v))
    || !Array.isArray(rule.weeklyWindows) || !Array.isArray(rule.exceptions)
    || !Array.isArray(rule.waivingStatuses)
    || !rule.waivingStatuses.every(v => WAIVERS.has(v))
    || (rule.waivingStatuses.includes('compliant') && !EMISSIONS_SCHEMES.has(scheme))
    || rule.weeklyWindows.some(w => !Number.isInteger(w.dayOfWeek) || w.dayOfWeek < 0 || w.dayOfWeek > 6 || !validPeriod(w))
    || rule.exceptions.some(d => !validDate(d.date) || !Array.isArray(d.periods) || d.periods.some((p: Pick<ChargeWindow, 'startMinute' | 'endMinute'>) => !validPeriod(p)))) return false;
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
    && entitlement.source === 'operator_verified' && rule.waivingStatuses.includes(entitlement.status as 'exempt' | 'compliant')
    && parseInstant(entitlement.checkedAt) && validDate(entitlement.validThrough)
    && entitlement.validThrough >= local.localDate && parseInstant(entitlement.checkedAt)!.getTime() <= when.getTime()) {
    return make('verified_exempt', 'authority_verified_waiver');
  }
  return make('possible_charge', 'charge_may_apply');
}
