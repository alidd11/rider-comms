/**
 * Future-only authority-evidence freshness policy.
 *
 * Effective-through dates do not replace a recent human check of the
 * operator's policy. This pure gate does not fetch sources, verify licence
 * terms, authenticate an entitlement, or grant charging exemptions.
 *
 * Time windows are conservative engineering safeguards, NOT statutory rules.
 */
export type ChargeReviewSubject = 'rule' | 'tariff' | 'entitlement' | 'geometry';
export type ChargeFreshnessStatus =
  | 'fresh' | 'invalid_timestamp' | 'review_after_passage' | 'review_stale';
export interface ChargeFreshnessResult {
  status: ChargeFreshnessStatus;
  maxAgeDays: number;
  requiresAuthorityReview: true;
}
export const MAX_CHARGE_REVIEW_AGE_DAYS: Readonly<Record<ChargeReviewSubject, number>> =
  Object.freeze({
    // Changes in scheme terms, charging hours and exemptions should be
    // reviewed frequently; exceptional operator announcements may occur sooner.
    rule: 30,
    // Quoted tariffs and permit entitlements change more frequently.
    tariff: 7,
    entitlement: 7,
    // Independently reviewed geospatial datasets must also be rechecked.
    geometry: 30,
  });
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const MAX_OFFSET_HOURS = 14;
const ONE_DAY = 86400000;
function parseReviewedInstant(input: unknown): number | null {
  if (typeof input !== 'string' || !INSTANT.test(input)) return null;
  const base = input.slice(0, 10);
  const date = Date.parse(base + 'T00:00:00Z');
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== base) return null;
  const tz = input.match(/([+-])(\d{2}):(\d{2})$/);
  if (tz && (Number(tz[2]) > MAX_OFFSET_HOURS ||
    (Number(tz[2]) === MAX_OFFSET_HOURS && Number(tz[3]) > 0))) return null;
  const ms = Date.parse(input);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Fail closed on invalid timestamps, future-dated reviews or elapsed age past
 * the policy. The planned passage instant is the reference clock; a verifier
 * may not use a policy snapshot from the future to prove a past journey.
 */
export function reviewChargeEvidenceFreshness(
  subject: ChargeReviewSubject,
  reviewedAt: unknown,
  passageAt: unknown,
): ChargeFreshnessResult {
  const maxAgeDays = MAX_CHARGE_REVIEW_AGE_DAYS[subject];
  const make = (status: ChargeFreshnessStatus): ChargeFreshnessResult => ({
    status, maxAgeDays: Number.isFinite(maxAgeDays) ? maxAgeDays : 0,
    requiresAuthorityReview: true,
  });
  if (!Number.isInteger(maxAgeDays) || maxAgeDays <= 0)
    return make('invalid_timestamp');
  const review = parseReviewedInstant(reviewedAt);
  const passage = parseReviewedInstant(passageAt);
  if (review === null || passage === null) return make('invalid_timestamp');
  if (review > passage) return make('review_after_passage');
  if (passage - review > maxAgeDays * ONE_DAY) return make('review_stale');
  return make('fresh');
}
