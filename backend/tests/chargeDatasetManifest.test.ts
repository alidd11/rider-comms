import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewChargeDatasetManifest } from '../src/chargeDatasetManifest.ts';

const passage = '2026-11-23T12:00:00Z';
const source = {
  url: 'https://example.org/charging/snapshot.json',
  publisher: 'Synthetic operator',
  version: 'fixture-2026-11-22',
  retrievedAt: '2026-11-22T08:00:00Z',
  snapshotSha256: 'a'.repeat(64),
};
const manifest = {
  manifestVersion: 1,
  scope: 'charging_only',
  datasetId: 'sample_charge_rules',
  evidenceKind: 'rule',
  source,
  reuse: {
    licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    attribution: 'Synthetic test only, no real authority dataset',
    reviewReference: 'TEST-ONLY-REVIEW',
  },
  transform: {
    toolId: 'fixture-compiler',
    toolVersion: 'v1.0.0',
    outputSha256: 'b'.repeat(64),
  },
  review: {
    checkedAt: '2026-11-22T10:00:00Z',
    effectiveFrom: '2026-01-01',
    effectiveThrough: '2026-12-31',
    reviewedThrough: '2026-12-31',
  },
};
const check = (input: unknown = manifest, at: unknown = passage) =>
  reviewChargeDatasetManifest(input, at);

describe('offline UK charging dataset manifest (metadata only)', () => {
  it('requires source and build hashes but never authorises live charges or licences', () => {
    assert.deepEqual(check(), {
      status: 'metadata_valid',
      reasons: [],
      requiresIndependentAuthorityAndLicenceVerification: true,
      productionApproved: false,
    });
  });
  it('rejects lane-access content, unapproved contract versions and unknown fields', () => {
    for (const input of [
      { ...manifest, scope: 'bus_lane_access' },
      { ...manifest, evidenceKind: 'bus_lane_permission' },
      { ...manifest, lanePermission: 'yes' },
      { ...manifest, manifestVersion: 2 },
      { ...manifest, datasetId: '__proto__' },
      { ...manifest, source: { ...source, graphEdgeId: '1' } },
    ]) {
      assert.equal(check(input).status, 'blocked');
    }
  });
  it('blocks invalid provenance, missing rights-review metadata and unversioned transforms', () => {
    for (const input of [
      { ...manifest, source: { ...source, url: 'http://example.org/' } },
      { ...manifest, source: { ...source, snapshotSha256: 'a'.repeat(63) } },
      { ...manifest, source: { ...source, retrievedAt: '2026-11-22T24:00:00Z' } },
      { ...manifest, reuse: { ...manifest.reuse, reviewReference: '' } },
      { ...manifest, reuse: { ...manifest.reuse, attribution: 'Line 1\nLine 2' } },
      { ...manifest, source: { ...source, publisher: 'Unsafe\u0000name' } },
      { ...manifest, reuse: { ...manifest.reuse, licenceUrl: 'https://user:pass@example.org/' } },
      { ...manifest, transform: { ...manifest.transform, outputSha256: 'invalid' } },
      { ...manifest, transform: { ...manifest.transform, toolVersion: '' } },
    ]) assert.equal(check(input).status, 'blocked');
  });
  it('blocks future, stale or malformed source review and snapshots retrieved after review', () => {
    assert.ok(check({
      ...manifest, review: { ...manifest.review, checkedAt: '2026-11-24T00:00:00Z' },
    }).reasons.includes('source_review_not_fresh'));
    assert.ok(check({
      ...manifest, review: { ...manifest.review, checkedAt: '2026-11-22T24:00:00Z' },
    }).reasons.includes('invalid_review_metadata'));
    assert.ok(check({
      ...manifest, source: { ...source, retrievedAt: '2026-11-23T00:00:00Z' },
    }).reasons.includes('snapshot_after_review'));
    assert.ok(check(manifest, '2026-11-23T24:00:00Z').reasons.includes('invalid_passage_time'));
    assert.ok(check(manifest, null).reasons.includes('invalid_passage_time'));
    assert.ok(check(manifest, 1700000000000).reasons.includes('invalid_passage_time'));
  });
  it('uses conservative rule/geometry 30-day and tariff/entitlement 7-day review windows', () => {
    const old = {
      ...manifest,
      source: { ...source, retrievedAt: '2026-11-16T11:00:00Z' },
      review: { ...manifest.review, checkedAt: '2026-11-16T12:00:00Z' },
    };
    for (const evidenceKind of ['rule', 'geometry', 'tariff', 'entitlement'])
      assert.equal(check({ ...old, evidenceKind }).status, 'metadata_valid');
    const older = {
      ...old,
      source: { ...source, retrievedAt: '2026-11-16T10:59:59.999Z' },
      review: { ...manifest.review, checkedAt: '2026-11-16T11:59:59.999Z' },
    };
    assert.equal(check({ ...older, evidenceKind: 'rule' }).status, 'metadata_valid');
    for (const evidenceKind of ['tariff', 'entitlement'])
      assert.ok(check({ ...older, evidenceKind }).reasons.includes('source_review_not_fresh'));
  });
  it('uses UK calendar dates at DST boundaries and rejects unreviewed coverage', () => {
    assert.ok(check(manifest, '2027-01-01T00:00:00Z').reasons.includes('outside_reviewed_period'));
    assert.ok(check({
      ...manifest, review: { ...manifest.review, reviewedThrough: '2026-11-22' },
    }).reasons.includes('outside_reviewed_period'));
    assert.ok(check({
      ...manifest, review: { ...manifest.review, effectiveFrom: '2026-02-30' },
    }).reasons.includes('invalid_review_metadata'));
    const summer = {
      ...manifest,
      source: { ...source, retrievedAt: '2026-06-30T20:00:00Z' },
      review: { ...manifest.review, checkedAt: '2026-06-30T21:00:00Z',
        effectiveFrom: '2026-07-01', effectiveThrough: '2026-07-01', reviewedThrough: '2026-07-01' },
    };
    assert.equal(check(summer, '2026-06-30T23:30:00Z').status, 'metadata_valid');
  });
});
