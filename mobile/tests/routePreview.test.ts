import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InAppNavigationRoute } from '../src/api/directions.ts';
import { hasUsableRoadPreview, roadPreviewDiffersFromReviewedDistance } from '../src/routes/routePreview.ts';

const valid: InAppNavigationRoute = {
  coordinates: [{ lat: 51.5, lon: -0.1 }, { lat: 51.6, lon: -0.2 }],
  steps: [],
  distanceMeters: 39 * 1609.344,
  durationSeconds: 5400,
};

describe('curated route road-preview validation', () => {
  it('accepts a finite road path with calculated distance and duration', () => {
    assert.equal(hasUsableRoadPreview(valid), true);
  });
  it('rejects truncated, non-finite or zero-distance responses', () => {
    assert.equal(hasUsableRoadPreview({ ...valid, coordinates: valid.coordinates.slice(0, 1) }), false);
    assert.equal(hasUsableRoadPreview({ ...valid, coordinates: [{ lat: Number.NaN, lon: -0.1 }, valid.coordinates[1]!] }), false);
    assert.equal(hasUsableRoadPreview({ ...valid, coordinates: [{ lat: 94, lon: -0.1 }, valid.coordinates[1]!] }), false);
    assert.equal(hasUsableRoadPreview({ ...valid, distanceMeters: 0 }), false);
    assert.equal(hasUsableRoadPreview({ ...valid, durationSeconds: Number.POSITIVE_INFINITY }), false);
  });
  it('flags significant differences from the reviewed route distance', () => {
    assert.equal(roadPreviewDiffersFromReviewedDistance(39, 39 * 1609.344), false);
    assert.equal(roadPreviewDiffersFromReviewedDistance(39, 47 * 1609.344), false);
    assert.equal(roadPreviewDiffersFromReviewedDistance(39, 60 * 1609.344), true);
    assert.equal(roadPreviewDiffersFromReviewedDistance(39, 25 * 1609.344), true);
    assert.equal(roadPreviewDiffersFromReviewedDistance(0, 60 * 1609.344), false);
    assert.equal(roadPreviewDiffersFromReviewedDistance(39, Number.NaN), false);
  });
});
