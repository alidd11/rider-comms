/**
 * Future-only static Clean Air Zone reference catalogue. This is NOT a legal
 * entitlement source, charge schedule, geographic boundary or payment check.
 * Reviewed from GOV.UK on 21 Nov 2026; unknown/expired catalogue is advisory.
 */
export type CazClass = 'B' | 'C' | 'D';
export interface EnglishCleanAirZone {
  id: string;
  label: string;
  cazClass: CazClass;
}
export const ENGLISH_CAZ_SOURCE = 'https://www.gov.uk/guidance/driving-in-a-clean-air-zone';
export const ENGLISH_CAZ_VEHICLE_CHECK = 'https://www.gov.uk/clean-air-zones';
export const ENGLISH_CAZ_REVIEWED_AT = '2026-11-21';
export const ENGLISH_CAZ_CATALOGUE: ReadonlyArray<EnglishCleanAirZone> = Object.freeze([
  Object.freeze({ id: 'bath_caz', label: 'Bath', cazClass: 'C' }),
  Object.freeze({ id: 'birmingham_caz', label: 'Birmingham', cazClass: 'D' }),
  Object.freeze({ id: 'bradford_caz', label: 'Bradford', cazClass: 'C' }),
  Object.freeze({ id: 'bristol_caz', label: 'Bristol', cazClass: 'D' }),
  Object.freeze({ id: 'portsmouth_caz', label: 'Portsmouth', cazClass: 'B' }),
  Object.freeze({ id: 'sheffield_caz', label: 'Sheffield', cazClass: 'C' }),
  Object.freeze({ id: 'tyneside_caz', label: 'Tyneside (Newcastle and Gateshead)', cazClass: 'C' }),
]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function dateDay(value: string): number | null {
  if (!ISO_DAY.test(value)) return null;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp / 86400000 : null;
}
/** Prompts a source recheck rather than trusting indefinitely cached scheme info. */
export function isEnglishCazCatalogueCurrent(asOfLondonDate: string): boolean {
  const day = dateDay(asOfLondonDate), reviewed = dateDay(ENGLISH_CAZ_REVIEWED_AT);
  return day !== null && reviewed !== null && day >= reviewed && day - reviewed <= 90;
}
export function findEnglishCaz(id: string): EnglishCleanAirZone | undefined {
  return ENGLISH_CAZ_CATALOGUE.find(zone => zone.id === id);
}
