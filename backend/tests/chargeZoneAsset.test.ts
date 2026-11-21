import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadReviewedChargeZone, type ReviewedChargeZoneAsset } from '../src/chargeZoneAsset.ts';
import { screenRouteAgainstChargeZone } from '../src/chargeZoneGeometry.ts';

const geojson = { type: 'Feature', geometry: {
  type: 'Polygon', coordinates: [[[-0.5, 51.3], [-0.3, 51.3], [-0.3, 51.5],
    [-0.5, 51.5], [-0.5, 51.3]]],
} };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = encode(geojson);
const manifest: ReviewedChargeZoneAsset = {
  sha256: hash(bytes),
  // Synthetic geometry authored exclusively for tests; no production asset
  // or authority licence is asserted by the following fixture.
  licenceReview: {
    commercialRedistributionApproved: true,
    reviewedOn: '2026-11-21',
    approvalReference: 'SYNTHETIC-TEST-GEOMETRY-ONLY',
    licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/2/',
  },
  provenance: {
    schemeId: 'london_ulez', sourceUrl: 'https://data.london.gov.uk/',
    licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/2/',
    attribution: 'Synthetic geometry for testing only, NOT the London ULEZ map',
    checkedAt: '2026-11-21T00:00:00Z', effectiveFrom: '2026-01-01',
    effectiveThrough: '2026-12-31', reviewedThrough: '2026-12-31',
  },
};

describe('checksum-pinned, offline zone asset loading', () => {
  it('loads only expected bytes and stays advisory even on an apparent zone contact', () => {
    const result = loadReviewedChargeZone(bytes, manifest);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const route = [{ lon: -0.45, lat: 51.4 }, { lon: -0.35, lat: 51.4 }];
    assert.equal(screenRouteAgainstChargeZone(route, result.zone, '2026-11-21').status,
      'possible_polygon_contact');
    assert.equal(screenRouteAgainstChargeZone(route, result.zone, '2027-01-01').status,
      'unknown');
  });
  it('rejects changed bytes, invalid digests, and missing manifest', () => {
    assert.equal(loadReviewedChargeZone(encode({ ...geojson, author: 'modified' }), manifest).reason,
      'checksum_mismatch');
    assert.equal(loadReviewedChargeZone(bytes, { ...manifest, sha256: 'x' }).reason,
      'invalid_manifest');
    assert.equal(loadReviewedChargeZone(bytes, null as unknown as ReviewedChargeZoneAsset).reason,
      'invalid_manifest');
  });
  it('fails closed when commercial redistribution was not separately approved', () => {
    assert.equal(loadReviewedChargeZone(bytes, {
      ...manifest, licenceReview: undefined as unknown as ReviewedChargeZoneAsset['licenceReview'],
    }).reason, 'licence_not_approved');
    assert.equal(loadReviewedChargeZone(bytes, {
      ...manifest, licenceReview: {
        ...manifest.licenceReview, commercialRedistributionApproved: false as unknown as true,
      },
    }).reason, 'licence_not_approved');
    assert.equal(loadReviewedChargeZone(bytes, {
      ...manifest, licenceReview: { ...manifest.licenceReview, approvalReference: '  ' },
    }).reason, 'licence_not_approved');
    assert.equal(loadReviewedChargeZone(bytes, {
      ...manifest, licenceReview: { ...manifest.licenceReview, reviewedOn: '2026-02-30' },
    }).reason, 'licence_not_approved');
    assert.equal(loadReviewedChargeZone(bytes, {
      ...manifest, licenceReview: { ...manifest.licenceReview,
        licenceUrl: 'https://another-publisher.example/terms' },
    }).reason, 'licence_not_approved');
    assert.equal(loadReviewedChargeZone(bytes, {
      ...manifest, licenceReview: { ...manifest.licenceReview, approvalReference: 'x'.repeat(201) },
    }).reason, 'licence_not_approved');
  });
  it('bounds resource use and rejects empty data', () => {
    assert.equal(loadReviewedChargeZone(new Uint8Array(), manifest).reason, 'too_large');
    assert.equal(loadReviewedChargeZone(new Uint8Array(5 * 1024 * 1024 + 1), manifest).reason,
      'too_large');
  });
  it('rejects invalid UTF-8, invalid JSON and legacy coordinate systems', () => {
    const malformedUtf8 = Uint8Array.of(0xc3, 0x28);
    assert.equal(loadReviewedChargeZone(malformedUtf8,
      { ...manifest, sha256: hash(malformedUtf8) }).reason, 'invalid_geojson');
    const malformedJson = new TextEncoder().encode('{');
    assert.equal(loadReviewedChargeZone(malformedJson,
      { ...manifest, sha256: hash(malformedJson) }).reason, 'invalid_geojson');
    const legacyCrs = encode({ ...geojson, crs: { type: 'name', properties: { name: 'EPSG:27700' } } });
    assert.equal(loadReviewedChargeZone(legacyCrs,
      { ...manifest, sha256: hash(legacyCrs) }).reason, 'invalid_geojson');
    const embeddedCrs = encode({ ...geojson, geometry: {
      ...geojson.geometry, crs: { type: 'name', properties: { name: 'EPSG:27700' } },
    } });
    assert.equal(loadReviewedChargeZone(embeddedCrs,
      { ...manifest, sha256: hash(embeddedCrs) }).reason, 'invalid_geojson');
    const featureCollectionCrs = encode({ type: 'FeatureCollection', features: [
      { ...geojson, crs: { type: 'name', properties: { name: 'EPSG:27700' } } },
    ] });
    assert.equal(loadReviewedChargeZone(featureCollectionCrs,
      { ...manifest, sha256: hash(featureCollectionCrs) }).reason, 'invalid_geojson');
  });
  it('rejects a reviewed checksum whose underlying polygon is invalid', () => {
    const wrong = encode({ type: 'Point', coordinates: [0, 0] });
    assert.equal(loadReviewedChargeZone(wrong, { ...manifest, sha256: hash(wrong) }).reason,
      'invalid_zone');
  });
});
