import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileChargeZoneGeoJson, screenRouteAgainstChargeZone } from '../src/chargeZoneGeometry.ts';

const source = {
  schemeId: 'london_ulez' as const,
  sourceUrl: 'https://data.london.gov.uk/dataset/london-wide-ultra-low-emission-zone-2023-vd455',
  licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/2/',
  attribution: 'Contains public sector information licensed under OGL v2',
  checkedAt: '2026-11-21T00:00:00Z', effectiveFrom: '2026-01-01',
  effectiveThrough: '2026-12-31', reviewedThrough: '2026-12-31',
};
const square = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
const hole = [[0.75, 0.75], [0.75, 1.25], [1.25, 1.25], [1.25, 0.75], [0.75, 0.75]];
const geo = (rings: number[][][]) => ({ type: 'Polygon', coordinates: rings });
const prepare = (value: unknown = geo([square])) => compileChargeZoneGeoJson(value, source);
const screen = (coordinates: Array<[number, number]>, zone = prepare(), date = '2026-06-01') =>
  screenRouteAgainstChargeZone(coordinates.map(([lon, lat]) => ({ lon, lat })), zone, date);

describe('offline charge zone GeoJSON screening (not live routing)', () => {
  it('detects roads inside a zone, crossing it and touching its boundary', () => {
    assert.equal(screen([[0.1, 0.1], [1, 1]]).status, 'possible_polygon_contact');
    assert.equal(screen([[-1, 1], [3, 1]]).reason, 'route_intersects_polygon');
    assert.equal(screen([[-1, 0], [0, 0]]).status, 'possible_polygon_contact');
  });
  it('does not mistake a polygon miss for legal permission or a fee estimate', () => {
    const result = screen([[3, 3], [4, 4]]);
    assert.equal(result.status, 'no_polygon_contact');
    assert.equal(result.reason, 'geometry_does_not_contact_polygon');
    assert.ok(!('pricePence' in result) && !('confirmed_crossing' in result));
  });
  it('handles GeoJSON holes, multiple polygons and multi-feature collections', () => {
    const withHole = prepare(geo([square, hole]));
    assert.equal(screen([[0.9, 0.9], [1.1, 1.1]], withHole).status, 'no_polygon_contact');
    assert.equal(screen([[0.9, 0.9], [1.5, 1.5]], withHole).status, 'possible_polygon_contact');
    const multi = prepare({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: geo([square]), properties: {} },
      { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [
        [[ [4, 4], [5, 4], [5, 5], [4, 5], [4, 4] ]],
      ] }, properties: {} },
    ] });
    assert.equal(screen([[4.2, 4.2], [4.4, 4.4]], multi).status, 'possible_polygon_contact');
    assert.equal(screen([[3, 3], [3.1, 3.1]], multi).status, 'no_polygon_contact');
  });
  it('rejects malformed, unlicensed, degenerate or unsupported datasets', () => {
    assert.equal(prepare(geo([square.slice(0, 4)])), null);
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, zoneId: 'fake_city' }), null);
    assert.equal(prepare(geo([[[0, 0], [2, 0], [2, 2], [0, 0], [0, 0]]])), null);
    assert.equal(prepare({ type: 'LineString', coordinates: square }), null);
    // A self-crossing polygon can have non-zero signed area: still reject.
    assert.equal(prepare(geo([[[0, 0], [3, 0], [0, 3], [3, 3], [1, 4], [0, 0]]])), null);
    // A simple concave polygon remains valid.
    assert.ok(prepare(geo([[[0, 0], [3, 0], [3, 3], [1, 1], [0, 3], [0, 0]]])));
    // A bow-tie is not a meaningful area even if its bounding box is valid.
    assert.equal(prepare(geo([[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]])), null);
    const legacyCrs = { type: 'name', properties: { name: 'EPSG:27700' } };
    assert.equal(prepare({ ...geo([square]), crs: legacyCrs }), null);
    assert.equal(prepare({ type: 'Feature', geometry: { ...geo([square]), crs: legacyCrs } }), null);
    assert.equal(prepare({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: geo([square]), crs: legacyCrs },
    ] }), null);
    assert.equal(prepare({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null }] }), null);
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, sourceUrl: 'http://example.com' }), null);
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, attribution: '' }), null);
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, effectiveFrom: '2026-02-30' }), null);
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, schemeId: 'invalid' as typeof source.schemeId }), null);
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, checkedAt: '2026-02-30T00:00:00Z' }), null);
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, reviewedThrough: '2025-12-31' }), null);
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, schemeId: 'uk_caz', zoneId: undefined }), null);
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, schemeId: 'uk_caz', zoneId: 'UNKNOWN AREA' }), null);
    const oxford = compileChargeZoneGeoJson(geo([square]), { ...source, schemeId: 'oxford_zez' });
    assert.equal(screen([[0.2, 0.2], [0.3, 0.3]], oxford).schemeId, 'oxford_zez');
    assert.equal(compileChargeZoneGeoJson(geo([square]), { ...source, schemeId: 'oxford_zez', zoneId: 'wrong_caz' }), null);
    const bradford = compileChargeZoneGeoJson(geo([square]), { ...source, schemeId: 'uk_caz', zoneId: 'bradford_caz' });
    assert.equal(screen([[0.2, 0.2], [0.3, 0.3]], bradford).zoneId, 'bradford_caz');
  });
  it('rejects holes outside, crossing or nested within other holes', () => {
    const rect = (a: number, b: number, c: number, d: number) =>
      [[a,b],[c,b],[c,d],[a,d],[a,b]];
    assert.equal(prepare(geo([square, rect(3,3,4,4)])), null);
    assert.equal(prepare(geo([square, rect(1,1,3,3)])), null);
    assert.equal(prepare(geo([square, rect(0,0.5,1,1.5)])), null);
    assert.equal(prepare(geo([square, hole, rect(0.8,0.8,1,1)])), null);
    assert.equal(prepare(geo([square, hole, rect(1,1,1.5,1.5)])), null);
    assert.ok(prepare(geo([square, hole, rect(0.1,0.1,0.3,0.3)])));
  });
  it('bounds cumulative topology work across polygons', () => {
    const ring = Array.from({ length: 1800 }, (_, i) =>
      [Math.cos(i * 2 * Math.PI / 1800), Math.sin(i * 2 * Math.PI / 1800)]);
    ring.push([...ring[0]!]);
    assert.ok(prepare(geo([ring])));
    assert.equal(prepare({ type: 'MultiPolygon', coordinates: [[ring], [ring]] }), null);
  });
  it('snapshots supplied geometry and source metadata so callers cannot alter validated zones', () => {
    const sourceRing = square.map(point => [...point]);
    const data = geo([sourceRing]);
    const metadata = { ...source };
    const compiled = compileChargeZoneGeoJson(data, metadata);
    assert.ok(compiled);
    sourceRing[0]![0] = 100;
    metadata.effectiveThrough = '2020-01-01';
    assert.equal(screen([[0.1, 0.1], [0.2, 0.2]], compiled).status, 'possible_polygon_contact');
    assert.equal(compiled.provenance.effectiveThrough, '2026-12-31');
    assert.ok(Object.isFrozen(compiled));
    assert.ok(Object.isFrozen(compiled.polygons));
    assert.ok(Object.isFrozen(compiled.polygons[0]?.rings[0]?.[0]));
    assert.throws(() => { (compiled.provenance as { effectiveThrough: string }).effectiveThrough = '1999-01-01'; }, TypeError);
  });
  it('fails closed for missing, expired, invalid or antimeridian-spanning routes', () => {
    assert.equal(screen([[0.1, 0.1], [0.2, 0.2]], prepare(), '2027-01-01').reason, 'outside_verified_period');
    assert.equal(screen([[0.1, 0.1], [0.2, 0.2]], null).status, 'unknown');
    assert.equal(screen([[200, 0], [201, 0]]).status, 'unknown');
    assert.equal(screen([[179, 0], [-179, 0]]).status, 'unknown');
    assert.equal(screen([[0, 0]]).status, 'unknown');
    assert.deepEqual(
      { status: screen([[3, 3], [3, 3]]).status, reason: screen([[3, 3], [3, 3]]).reason },
      { status: 'unknown', reason: 'missing_or_invalid_data' },
    );
    assert.equal(screen([[3, 3], [3, 3], [4, 4]]).status, 'no_polygon_contact');
    assert.equal(screen([[0, 0], [0, 0]], prepare(), 'invalid').status, 'unknown');
  });
});
