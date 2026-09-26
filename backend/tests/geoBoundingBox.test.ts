import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { latLonBoundingBox } from '../src/geoBoundingBox.ts';

describe('latLonBoundingBox', () => {
  it('produces a plain BETWEEN clause away from the antimeridian and poles', () => {
    const box = latLonBoundingBox({ lat: 51.5, lon: -0.1 }, 40, 5);
    assert.ok(box.minLat < 51.5 && box.maxLat > 51.5);
    assert.equal(box.longitudeClause, 'AND lon BETWEEN $5 AND $6');
    assert.equal(box.longitudeParams.length, 2);
    assert.ok(box.longitudeParams[0]! < -0.1 && box.longitudeParams[1]! > -0.1);
  });

  it('clamps latitude to [-90, 90]', () => {
    const northPole = latLonBoundingBox({ lat: 89, lon: 0 }, 200, 5);
    assert.equal(northPole.maxLat, 90);
    const southPole = latLonBoundingBox({ lat: -89, lon: 0 }, 200, 5);
    assert.equal(southPole.minLat, -90);
  });

  it('wraps the whole longitude range near the poles instead of dividing by a near-zero scale', () => {
    const box = latLonBoundingBox({ lat: 89.9999, lon: 0 }, 40, 5);
    assert.equal(box.longitudeClause, '');
    assert.deepEqual(box.longitudeParams, []);
  });

  it('splits into an OR clause when the search wraps past longitude -180', () => {
    const box = latLonBoundingBox({ lat: 0, lon: -179 }, 100, 3);
    assert.equal(box.longitudeClause, 'AND (lon >= $3 OR lon <= $4)');
    assert.ok(box.longitudeParams[0]! > 0);
    assert.ok(box.longitudeParams[1]! < 0);
  });

  it('splits into an OR clause when the search wraps past longitude 180', () => {
    const box = latLonBoundingBox({ lat: 0, lon: 179 }, 100, 3);
    assert.equal(box.longitudeClause, 'AND (lon >= $3 OR lon <= $4)');
    assert.ok(box.longitudeParams[0]! > 0);
    assert.ok(box.longitudeParams[1]! < 0);
  });

  it('uses the given start param index for both placeholders', () => {
    const box = latLonBoundingBox({ lat: 0, lon: 0 }, 40, 9);
    assert.equal(box.longitudeClause, 'AND lon BETWEEN $9 AND $10');
  });
});
