import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OFFLINE_CHARGING_DATASET_BYTES,
  verifyChargeDatasetContent,
} from '../src/chargeDatasetManifest.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const sha256 = (data: Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

const sourceBytes = bytes('{"synthetic":"operator rules","version":1}');
const outputBytes = bytes('{"synthetic":"compiled charge policy","version":1}');
const passage = '2026-11-23T12:00:00Z';

const manifest = {
  manifestVersion: 1,
  scope: 'charging_only',
  datasetId: 'synthetic_charge_data',
  evidenceKind: 'rule',
  source: {
    url: 'https://example.org/synthetic-operator.json',
    publisher: 'Synthetic authority fixture (not an official source)',
    version: '2026-11-22-fixture',
    retrievedAt: '2026-11-22T09:00:00Z',
    snapshotSha256: sha256(sourceBytes),
  },
  reuse: {
    licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    attribution: 'Synthetic example only, no actual authority dataset',
    reviewReference: 'TEST-ONLY-NOT-A-LICENCE-GRANT',
  },
  transform: {
    toolId: 'fixture-compiler',
    toolVersion: 'v1.0.0',
    outputSha256: sha256(outputBytes),
  },
  review: {
    checkedAt: '2026-11-22T10:00:00Z',
    effectiveFrom: '2026-01-01',
    effectiveThrough: '2026-12-31',
    reviewedThrough: '2026-12-31',
  },
};

const check = (m: unknown = manifest, at: unknown = passage,
  src: unknown = sourceBytes, out: unknown = outputBytes) =>
  verifyChargeDatasetContent(m, at, src, out);

describe('offline charging evidence content integrity (no live data)', () => {
  it('re-hashes pinned original and compiled bytes without granting legal rights or live use', () => {
    assert.deepEqual(check(), {
      status: 'hashes_match',
      reasons: [],
      requiresIndependentAuthorityAndLicenceVerification: true,
      productionApproved: false,
    });
  });

  it('rejects a changed original snapshot even when its manifest digest looks well-formed', () => {
    const tampered = Uint8Array.from(sourceBytes);
    tampered[0] = tampered[0]! ^ 1;
    const out = check(manifest, passage, tampered, outputBytes);
    assert.equal(out.status, 'blocked');
    assert.deepEqual(out.reasons, ['source_sha256_mismatch']);
  });

  it('rejects a changed transformed artefact independently of the source snapshot', () => {
    const modified = bytes('{"synthetic":"compiled charge policy","version":2}');
    const out = check(manifest, passage, sourceBytes, modified);
    assert.deepEqual(out.reasons, ['output_sha256_mismatch']);
  });

  it('rejects mismatches in both hashes without conflating them', () => {
    const result = check(manifest, passage, bytes('different original'), bytes('different output'));
    assert.deepEqual(result.reasons, ['source_sha256_mismatch', 'output_sha256_mismatch']);
    assert.equal(result.productionApproved, false);
  });

  it('fails closed on stale source review, wrong schema, or lane-permission data', () => {
    for (const invalid of [
      { ...manifest, review: { ...manifest.review, checkedAt: '2026-10-01T10:00:00Z' } },
      { ...manifest, scope: 'lane_access' },
      { ...manifest, evidenceKind: 'bus_lane_permission' },
      { ...manifest, lanePermission: true },
      { ...manifest, source: { ...manifest.source, snapshotSha256: 'incorrect' } },
    ]) {
      const out = check(invalid);
      assert.equal(out.status, 'blocked');
      assert.deepEqual(out.reasons, ['invalid_metadata']);
    }
  });

  it('rejects invalid, empty or oversized byte buffers before attempting hashing', () => {
    for (const invalid of [
      null, undefined, bytes(''), new DataView(new ArrayBuffer(2)),
      'pretend bytes', [1, 2, 3],
      new Uint8Array(MAX_OFFLINE_CHARGING_DATASET_BYTES + 1),
    ]) {
      assert.deepEqual(check(manifest, passage, invalid, outputBytes).reasons,
        ['invalid_source_bytes']);
      assert.deepEqual(check(manifest, passage, sourceBytes, invalid).reasons,
        ['invalid_output_bytes']);
    }
  });

  it('does not accept a valid hash when its passage timestamp is invalid or unverified', () => {
    for (const invalid of [
      '2026-11-23T12:00:00', '2026-11-23T24:00:00Z', null,
      '2027-01-01T00:00:00Z',
    ]) {
      assert.deepEqual(check(manifest, invalid).reasons, ['invalid_metadata']);
    }
  });
});
