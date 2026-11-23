/**
 * Offline-only metadata gate for future charging evidence. NOT a licence
 * approval, permission to use a bus lane, or a live charging rule.
 * Intentionally independent of the unapproved Maps #572 shared contract.
 */
import { createHash } from 'node:crypto';
import { parseChargeInstant } from './chargeInstant.ts';
import { londonChargingDate } from './chargingRules.ts';
import { reviewChargeEvidenceFreshness, type ChargeReviewSubject } from './chargeSourceFreshness.ts';

export interface ChargeDatasetManifestV1 {
  manifestVersion: 1;
  scope: 'charging_only';
  datasetId: string;
  evidenceKind: ChargeReviewSubject;
  source: {
    url: string;
    publisher: string;
    version: string;
    retrievedAt: string;
    snapshotSha256: string;
  };
  reuse: {
    licenceUrl: string;
    attribution: string;
    reviewReference: string;
  };
  transform: {
    toolId: string;
    toolVersion: string;
    outputSha256: string;
  };
  review: {
    checkedAt: string;
    effectiveFrom: string;
    effectiveThrough: string;
    reviewedThrough: string;
  };
}
export interface ChargeDatasetManifestReview {
  status: 'metadata_valid' | 'blocked';
  reasons: readonly string[];
  requiresIndependentAuthorityAndLicenceVerification: true;
  productionApproved: false;
}

const ID = /^[a-z][a-z0-9_-]{2,63}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{2,95}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EVIDENCE = new Set<ChargeReviewSubject>(['rule', 'tariff', 'geometry', 'entitlement']);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}
function label(value: unknown, min = 1, max = 250): boolean {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max)
    return false;
  // Keep rejecting ASCII control characters without a control-character
  // regex, which violates the repository's ESLint no-control-regex rule.
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return false;
  }
  return true;
}
function version(value: unknown): boolean {
  return typeof value === 'string' && VERSION.test(value);
}
function digest(value: unknown): boolean {
  return typeof value === 'string' && SHA256.test(value);
}
function https(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username
      && !url.password && !url.hash;
  } catch { return false; }
}
function validDay(value: unknown): string | null {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
    ? value : null;
}

/** Validate metadata only: source and derived bytes must be hashed separately. */
export function reviewChargeDatasetManifest(
  input: unknown,
  predictedPassageAt: unknown,
): ChargeDatasetManifestReview {
  const reasons: string[] = [];
  const answer = (): ChargeDatasetManifestReview => ({
    status: reasons.length ? 'blocked' : 'metadata_valid',
    reasons: Object.freeze([...reasons]),
    requiresIndependentAuthorityAndLicenceVerification: true,
    productionApproved: false,
  });
  if (!object(input)) {
    reasons.push('invalid_manifest');
    return answer();
  }
  if (!onlyKeys(input, ['manifestVersion', 'scope', 'datasetId', 'evidenceKind',
    'source', 'reuse', 'transform', 'review'])
    || input.manifestVersion !== 1 || input.scope !== 'charging_only'
    || typeof input.datasetId !== 'string' || !ID.test(input.datasetId)
    || !EVIDENCE.has(input.evidenceKind as ChargeReviewSubject))
    reasons.push('invalid_contract_or_scope');

  const source = object(input.source) ? input.source : null;
  if (!source || !onlyKeys(source, ['url', 'publisher', 'version', 'retrievedAt', 'snapshotSha256'])
    || !https(source.url) || !label(source.publisher) || !version(source.version)
    || !digest(source.snapshotSha256) || parseChargeInstant(source.retrievedAt) === null)
    reasons.push('invalid_source_snapshot');
  const reuse = object(input.reuse) ? input.reuse : null;
  if (!reuse || !onlyKeys(reuse, ['licenceUrl', 'attribution', 'reviewReference'])
    || !https(reuse.licenceUrl) || !label(reuse.attribution)
    || !label(reuse.reviewReference, 4, 128))
    reasons.push('missing_reuse_review_metadata');
  const transform = object(input.transform) ? input.transform : null;
  if (!transform || !onlyKeys(transform, ['toolId', 'toolVersion', 'outputSha256'])
    || !version(transform.toolId) || !version(transform.toolVersion)
    || !digest(transform.outputSha256))
    reasons.push('invalid_transform_provenance');

  const review = object(input.review) ? input.review : null;
  // The public metadata boundary accepts unknown input; narrow it before
  // calling the string-only London calendar helper.
  const passageDate = typeof predictedPassageAt === 'string'
    ? londonChargingDate(predictedPassageAt) : null;
  if (!passageDate) reasons.push('invalid_passage_time');
  if (!review || !onlyKeys(review, ['checkedAt', 'effectiveFrom',
    'effectiveThrough', 'reviewedThrough'])
    || parseChargeInstant(review.checkedAt) === null
    || validDay(review.effectiveFrom) === null || validDay(review.effectiveThrough) === null
    || validDay(review.reviewedThrough) === null) {
    reasons.push('invalid_review_metadata');
  } else {
    const from = review.effectiveFrom as string;
    const through = review.effectiveThrough as string;
    const exceptions = review.reviewedThrough as string;
    if (from > through || exceptions < from || (passageDate
      && (passageDate < from || passageDate > through || passageDate > exceptions)))
      reasons.push('outside_reviewed_period');
    if (passageDate && EVIDENCE.has(input.evidenceKind as ChargeReviewSubject)
      && reviewChargeEvidenceFreshness(input.evidenceKind as ChargeReviewSubject,
        review.checkedAt, predictedPassageAt).status !== 'fresh')
      reasons.push('source_review_not_fresh');
    const retrieved = parseChargeInstant(source?.retrievedAt);
    const checked = parseChargeInstant(review.checkedAt);
    if (retrieved !== null && checked !== null && retrieved > checked)
      reasons.push('snapshot_after_review');
  }
  return answer();
}


/**
 * Content-integrity check for small, offline, charging-only dataset snapshots.
 * It verifies bytes against a previously recorded versioned manifest; it does
 * NOT authenticate the source, approve its licence, establish full UK road
 * coverage, validate operator charge rules or authorise production use.
 *
 * Larger datasets require a separate bounded streaming archive pipeline.
 * Neither the bytes nor their contents are sent to a network service.
 */
export interface ChargeDatasetContentReview {
  status: 'hashes_match' | 'blocked';
  reasons: readonly ('invalid_metadata' | 'invalid_source_bytes' |
    'invalid_output_bytes' | 'source_sha256_mismatch' | 'output_sha256_mismatch')[];
  requiresIndependentAuthorityAndLicenceVerification: true;
  productionApproved: false;
}
export const MAX_OFFLINE_CHARGING_DATASET_BYTES = 16 * 1024 * 1024;

function validSnapshotBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength > 0
    && value.byteLength <= MAX_OFFLINE_CHARGING_DATASET_BYTES;
}

/**
 * The caller must first save immutable copies of the original source bytes
 * and the derived artefact; a manifest with plausible-looking SHA-256 strings
 * is not proof those bytes were actually pinned or reproducibly transformed.
 */
export function verifyChargeDatasetContent(
  manifest: unknown,
  predictedPassageAt: unknown,
  sourceBytes: unknown,
  outputBytes: unknown,
): ChargeDatasetContentReview {
  const reasons: ChargeDatasetContentReview['reasons'][number][] = [];
  const metadata = reviewChargeDatasetManifest(manifest, predictedPassageAt);
  if (metadata.status !== 'metadata_valid') reasons.push('invalid_metadata');
  if (!validSnapshotBytes(sourceBytes)) reasons.push('invalid_source_bytes');
  if (!validSnapshotBytes(outputBytes)) reasons.push('invalid_output_bytes');
  if (reasons.length === 0) {
    // Input has passed the strict manifest and byte-shape gates above.
    const pinned = manifest as ChargeDatasetManifestV1;
    const actualSource = createHash('sha256').update(sourceBytes as Uint8Array).digest('hex');
    const actualOutput = createHash('sha256').update(outputBytes as Uint8Array).digest('hex');
    if (actualSource !== pinned.source.snapshotSha256) reasons.push('source_sha256_mismatch');
    if (actualOutput !== pinned.transform.outputSha256) reasons.push('output_sha256_mismatch');
  }
  return {
    status: reasons.length === 0 ? 'hashes_match' : 'blocked',
    reasons,
    requiresIndependentAuthorityAndLicenceVerification: true,
    productionApproved: false,
  };
}
