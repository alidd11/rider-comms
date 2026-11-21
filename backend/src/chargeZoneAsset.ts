/**
 * Offline, future-only ingestion of a reviewed, pinned charging-zone dataset.
 * No downloads, licence inference, real route integration or network calls.
 * A checksum confirms the reviewed bytes have not changed; it does NOT prove
 * that the data is correct, current or licensed for redistribution.
 */
import { createHash } from 'node:crypto';
import { compileChargeZoneGeoJson, type ChargeZoneProvenance,
  type PreparedChargeZone } from './chargeZoneGeometry.ts';

const MAX_ZONE_ASSET_BYTES = 5 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
function validDay(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function hasHumanApprovedCommercialLicence(asset: ReviewedChargeZoneAsset): boolean {
  const review = asset.licenceReview;
  return Boolean(review && typeof review === 'object'
    && review.commercialRedistributionApproved === true
    && validDay(review.reviewedOn)
    && typeof review.approvalReference === 'string'
    && review.approvalReference.trim().length > 3
    && review.approvalReference.length <= 200
    && review.licenceUrl === asset.provenance.licenceUrl);
}
export interface ZoneCommercialLicenceReview {
  /** An explicit human approval is required; HTTPS metadata alone is NOT a licence. */
  commercialRedistributionApproved: true;
  /** Date on which the linked licence and attribution were reviewed. */
  reviewedOn: string;
  /** Traceable internal approval/ticket ID. Not a substitute for legal rights. */
  approvalReference: string;
  /** Must match the licence URL recorded in the boundary provenance. */
  licenceUrl: string;
}
export interface ReviewedChargeZoneAsset {
  /** Human-reviewed SHA-256 digest of the exact source bytes. */
  sha256: string;
  /** Source/licence metadata, reviewed independently of the checksum. */
  provenance: ChargeZoneProvenance;
  /** Explicitly approved commercial redistribution rights; never auto-infer from URL. */
  licenceReview: ZoneCommercialLicenceReview;
}
export type ChargeZoneLoadReason =
  | 'ok' | 'invalid_manifest' | 'too_large' | 'checksum_mismatch'
  | 'invalid_geojson' | 'invalid_zone' | 'licence_not_approved';
export type ChargeZoneLoadResult =
  | { ok: true; reason: 'ok'; zone: PreparedChargeZone }
  | { ok: false; reason: Exclude<ChargeZoneLoadReason, 'ok'> };

/** Reject old-style CRS overrides at all structural GeoJSON levels. */
function hasLegacyCrs(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(data, 'crs')) return true;
  const item = data as { type?: unknown; geometry?: unknown; features?: unknown };
  if (item.type === 'Feature') return hasLegacyCrs(item.geometry);
  if (item.type === 'FeatureCollection' && Array.isArray(item.features)) {
    return item.features.some((feature: unknown) => hasLegacyCrs(feature));
  }
  return false;
}

export function loadReviewedChargeZone(
  bytes: Uint8Array,
  asset: ReviewedChargeZoneAsset,
): ChargeZoneLoadResult {
  const fail = (reason: Exclude<ChargeZoneLoadReason, 'ok'>): ChargeZoneLoadResult =>
    ({ ok: false, reason });
  if (!asset || typeof asset !== 'object'
    || !SHA256.test(asset.sha256) || !asset.provenance) return fail('invalid_manifest');
  if (!hasHumanApprovedCommercialLicence(asset)) return fail('licence_not_approved');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1
    || bytes.byteLength > MAX_ZONE_ASSET_BYTES) return fail('too_large');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== asset.sha256) return fail('checksum_mismatch');
  let data: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    data = JSON.parse(text);
  } catch {
    return fail('invalid_geojson');
  }
  // GeoJSON RFC 7946 uses WGS84 longitude/latitude. Do not accept a legacy
  // CRS override that might silently reinterpret British National Grid data.
  if (!data || typeof data !== 'object'
    || hasLegacyCrs(data)) return fail('invalid_geojson');
  const zone = compileChargeZoneGeoJson(data, asset.provenance);
  return zone ? { ok: true, reason: 'ok', zone } : fail('invalid_zone');
}
