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
export interface ReviewedChargeZoneAsset {
  /** Human-reviewed SHA-256 digest of the exact source bytes. */
  sha256: string;
  /** Source/licence metadata, reviewed independently of the checksum. */
  provenance: ChargeZoneProvenance;
}
export type ChargeZoneLoadReason =
  | 'ok' | 'invalid_manifest' | 'too_large' | 'checksum_mismatch'
  | 'invalid_geojson' | 'invalid_zone';
export type ChargeZoneLoadResult =
  | { ok: true; reason: 'ok'; zone: PreparedChargeZone }
  | { ok: false; reason: Exclude<ChargeZoneLoadReason, 'ok'> };

export function loadReviewedChargeZone(
  bytes: Uint8Array,
  asset: ReviewedChargeZoneAsset,
): ChargeZoneLoadResult {
  const fail = (reason: Exclude<ChargeZoneLoadReason, 'ok'>): ChargeZoneLoadResult =>
    ({ ok: false, reason });
  if (!asset || typeof asset !== 'object'
    || !SHA256.test(asset.sha256) || !asset.provenance) return fail('invalid_manifest');
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
    || Object.prototype.hasOwnProperty.call(data, 'crs')) return fail('invalid_geojson');
  const zone = compileChargeZoneGeoJson(data, asset.provenance);
  return zone ? { ok: true, reason: 'ok', zone } : fail('invalid_zone');
}
