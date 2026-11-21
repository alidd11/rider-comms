/**
 * Reviewed UK charging-hours references for future-only offline data audits.
 *
 * Informational source comparisons, NOT a charging policy feed or verified
 * navigation advice. Exceptions, road evidence, payment registration and vehicle
 * eligibility require separate authoritative checks; never use this guide to
 * calculate a payable fee or assert that a route is free of charge.
 */
import type { ChargingRule, ChargingSchemeId, ChargeUnit, ChargeWindow } from './chargingRules.ts';

export interface ChargingHoursReference {
  schemeId: ChargingSchemeId;
  authority: string;
  sourceUrl: string;
  reviewedAt: string;
  expectedUnit: ChargeUnit;
  /** Typical operating windows, not a statement about holiday exceptions. */
  normalWeek: ReadonlyArray<ChargeWindow>;
  caveat: string;
}
const allDays = (startMinute: number, endMinute: number): readonly ChargeWindow[] =>
  Object.freeze(Array.from({ length: 7 }, (_, dayOfWeek) =>
    Object.freeze({ dayOfWeek, startMinute, endMinute })));
const weekdaysAndWeekends: readonly ChargeWindow[] = Object.freeze([
  ...[1, 2, 3, 4, 5].map(dayOfWeek =>
    Object.freeze({ dayOfWeek, startMinute: 420, endMinute: 1080 })),
  ...[0, 6].map(dayOfWeek =>
    Object.freeze({ dayOfWeek, startMinute: 720, endMinute: 1080 })),
]);
const REVIEWED = '2026-11-21';
function entry(schemeId: ChargingSchemeId, authority: string, sourceUrl: string,
  expectedUnit: ChargeUnit, normalWeek: readonly ChargeWindow[], caveat: string): ChargingHoursReference {
  return Object.freeze({ schemeId, authority, sourceUrl, expectedUnit,
    normalWeek, reviewedAt: REVIEWED, caveat });
}

/** Each reference comes from the linked official operator (not map scraping). */
export const CHARGING_HOURS_REFERENCES: Readonly<Record<ChargingSchemeId, ChargingHoursReference>> =
  Object.freeze({
    london_congestion: entry('london_congestion', 'Transport for London',
      'https://tfl.gov.uk/modes/driving/congestion-charge',
      'daily', weekdaysAndWeekends,
      'Bank holidays follow weekend hours; the Christmas Day to New Year holiday shutdown must be reviewed separately.'),
    london_ulez: entry('london_ulez', 'Transport for London',
      'https://tfl.gov.uk/modes/driving/ultra-low-emission-zone',
      'daily', allDays(0, 1440),
      'No ULEZ charge on Christmas Day. Emissions and exemptions require the TfL vehicle checker.'),
    london_lez: entry('london_lez', 'Transport for London',
      'https://tfl.gov.uk/modes/driving/low-emission-zone',
      'daily', allDays(0, 1440),
      'Operates every day of the year; the affected heavy-vehicle categories require separate checking.'),
    blackwall_silvertown: entry('blackwall_silvertown', 'Transport for London',
      'https://tfl.gov.uk/modes/driving/silvertown-blackwall-tunnels-charge',
      'per_crossing', allDays(360, 1320),
      'Christmas Day closure, peak direction, vehicle type and Auto Pay discounts need independent verification. Motorcycles are not automatically free.'),
    dart_charge: entry('dart_charge', 'GOV.UK / National Highways',
      'https://www.gov.uk/pay-dartford-crossing-charge/charges',
      'per_crossing', allDays(360, 1320),
      'Official vehicle class A motorcycles and mopeds are free; user-selected vehicle category is not an official vehicle-class check.'),
    uk_caz: entry('uk_caz', 'GOV.UK / local charging authorities',
      'https://www.gov.uk/guidance/driving-in-a-clean-air-zone',
      'daily', allDays(0, 1440),
      'Local zone class and motorcycle inclusion vary; a generic CAZ approval cannot prove individual eligibility.'),
    oxford_zez: entry('oxford_zez', 'Oxfordshire County Council',
      'https://www.oxfordshire.gov.uk/transport-and-travel/oxford-zero-emission-zone-zez/charges-oxfords-zez',
      'daily', allDays(420, 1140),
      'Non-zero-emission two- and three-wheelers may pay; zero-emission status and discounts require official checks.'),
  } satisfies Record<ChargingSchemeId, ChargingHoursReference>);

function dateDay(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date.getTime() / 86400000 : null;
}
export type HoursAuditResult = {
  status: 'matches_reference' | 'differs_from_reference' | 'review_required';
  /** Never confirms holiday exceptions, amount payable or road eligibility. */
  requiresAuthorityReview: true;
  sourceUrl?: string;
};

/**
 * Catches incomplete/contradictory weekly schedules in reviewed authority
 * data before integration. Both a match and a mismatch are only audit hints.
 * A stale reference or invalid metadata always requires a fresh source review.
 */
export function auditChargingHoursAgainstOfficialReference(
  rule: Pick<ChargingRule, 'schemeId' | 'unit' | 'weeklyWindows'> | null,
  asOfLondonDate: string,
): HoursAuditResult {
  const review: HoursAuditResult = { status: 'review_required', requiresAuthorityReview: true };
  if (!rule || typeof rule !== 'object' || !Object.hasOwn(CHARGING_HOURS_REFERENCES, rule.schemeId))
    return review;
  const reference = CHARGING_HOURS_REFERENCES[rule.schemeId];
  const when = dateDay(asOfLondonDate), checked = dateDay(reference.reviewedAt);
  if (when === null || checked === null || when < checked || when - checked > 30) return review;
  if (!Array.isArray(rule.weeklyWindows) || rule.weeklyWindows.length !== reference.normalWeek.length)
    return { status: 'differs_from_reference', requiresAuthorityReview: true, sourceUrl: reference.sourceUrl };
  const encoded = (windows: ReadonlyArray<ChargeWindow>): string[] => windows.map(w =>
    w && Number.isInteger(w.dayOfWeek) && Number.isInteger(w.startMinute) && Number.isInteger(w.endMinute)
      ? [w.dayOfWeek, w.startMinute, w.endMinute].join(':') : 'invalid').sort();
  const actual = encoded(rule.weeklyWindows), expected = encoded(reference.normalWeek);
  const matches = rule.unit === reference.expectedUnit && actual.every((item, index) => item === expected[index]);
  return { status: matches ? 'matches_reference' : 'differs_from_reference',
    requiresAuthorityReview: true, sourceUrl: reference.sourceUrl };
}
