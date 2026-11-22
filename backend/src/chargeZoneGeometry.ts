/**
 * No-network, future-only GeoJSON zone screening. Polygon contact is only a
 * hint, never verification that a road is chargeable (or charge-free).
 * The caller supplies correctly licensed, separately reviewed geographic data.
 */
import { validChargingZoneId, type ChargingSchemeId } from './chargingRules.ts';
import { reviewChargeEvidenceFreshness } from './chargeSourceFreshness.ts';
import { parseChargeInstant } from './chargeInstant.ts';

type Position = readonly number[];
type Ring = readonly Position[];
type Polygon = readonly Ring[];
interface BoundingBox { minLon: number; maxLon: number; minLat: number; maxLat: number }
interface PreparedPolygon { rings: Polygon; bounds: BoundingBox; vertices: number }
export interface ChargeZoneProvenance {
  schemeId: ChargingSchemeId;
  /** Stable authority-specific identifier for a UK Clean Air Zone. */
  zoneId?: string;
  sourceUrl: string;
  licenceUrl: string;
  attribution: string;
  checkedAt: string;
  effectiveFrom: string;
  effectiveThrough: string;
  reviewedThrough: string;
}
export interface PreparedChargeZone {
  provenance: ChargeZoneProvenance;
  polygons: ReadonlyArray<PreparedPolygon>;
}
export interface RoutePosition { lat: number; lon: number }
export type ZoneScreenStatus = 'unknown' | 'possible_polygon_contact' | 'no_polygon_contact';
export type ZoneScreenReason = 'missing_or_invalid_data' | 'outside_verified_period'
  | 'route_on_or_inside_polygon' | 'route_intersects_polygon' | 'geometry_does_not_contact_polygon'
  | 'stale_source_review' | 'too_complex';
export interface ZoneScreenResult {
  status: ZoneScreenStatus; reason: ZoneScreenReason; schemeId: ChargingSchemeId; zoneId?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_POLYGONS = 128;
const MAX_VERTICES = 150_000;
const MAX_ROUTE_POINTS = 10_000;
const MAX_GEOMETRY_COMPARISONS = 3_000_000;
const SCHEMES = new Set<ChargingSchemeId>([
  'london_congestion', 'london_ulez', 'london_lez',
  'blackwall_silvertown', 'dart_charge', 'uk_caz', 'oxford_zez',
]);
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function httpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
function isValidPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length >= 2 && value.length <= 3
    && value.every(v => typeof v === 'number' && Number.isFinite(v))
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}
function boxForRing(ring: Ring): BoundingBox {
  let minLon = Infinity; let maxLon = -Infinity; let minLat = Infinity; let maxLat = -Infinity;
  for (const point of ring) {
    minLon = Math.min(minLon, point[0]!); maxLon = Math.max(maxLon, point[0]!);
    minLat = Math.min(minLat, point[1]!); maxLat = Math.max(maxLat, point[1]!);
  }
  return { minLon, maxLon, minLat, maxLat };
}
function overlaps(a: BoundingBox, b: BoundingBox): boolean {
  return a.minLon <= b.maxLon && b.minLon <= a.maxLon && a.minLat <= b.maxLat && b.minLat <= a.maxLat;
}
function rejectsCoordinateOverride(geojson: unknown): boolean {
  if (!geojson || typeof geojson !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(geojson, 'crs')) return true;
  const obj = geojson as { type?: unknown; geometry?: unknown; features?: unknown };
  if (obj.type === 'Feature') return rejectsCoordinateOverride(obj.geometry);
  return obj.type === 'FeatureCollection' && Array.isArray(obj.features)
    && obj.features.some((feature: unknown) => rejectsCoordinateOverride(feature));
}

function validRing(value: unknown, budget: { remaining: number }): value is Ring {
  if (!Array.isArray(value) || value.length < 4 || value.length > MAX_VERTICES) return false;
  if (!value.every(isValidPosition)) return false;
  const first = value[0] as Position, last = value[value.length - 1] as Position;
  if (first[0] !== last[0] || first[1] !== last[1]) return false;
  for (let i = 1; i < value.length; i++) {
    const a = value[i - 1] as Position, b = value[i] as Position;
    if (a[0] === b[0] && a[1] === b[1]) return false;
    // Antimeridian polygons require geographic unwrapping. Fail closed.
    if (Math.abs(a[0]! - b[0]!) > 180) return false;
  }
  const box = boxForRing(value);
  if (box.maxLon <= box.minLon || box.maxLat <= box.minLat) return false;
  // Catch folded/zero-area loops without an expensive O(n²) topology pass.
  // Full topology must still be verified during the offline data review.
  let twiceArea = 0;
  for (let i = 1; i < value.length; i++) {
    const a = value[i - 1] as Position;
    const b = value[i] as Position;
    twiceArea += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  if (!Number.isFinite(twiceArea) || twiceArea === 0) return false;
  // Non-zero signed area does not exclude a self-intersecting ring.
  // Bound the quadratic topology check; oversized rings require offline
  // simplification/review rather than silently accepting invalid geometry.
  const segments = value.length - 1;
  budget.remaining -= segments * (segments - 3) / 2;
  if (budget.remaining < 0) return false;
  for (let i = 0; i < segments; i++) {
    for (let j = i + 2; j < segments; j++) {
      if (i === 0 && j === segments - 1) continue; // shared closing vertex
      if (segmentIntersects(value[i]!, value[i + 1]!, value[j]!, value[j + 1]!)) return false;
    }
  }
  return true;
}

/** Prepare an authority-reviewed local GeoJSON dataset just once. */
export function compileChargeZoneGeoJson(geojson: unknown, provenance: ChargeZoneProvenance): PreparedChargeZone | null {
  if (!provenance || !SCHEMES.has(provenance.schemeId)
    || !validChargingZoneId(provenance.schemeId, provenance.zoneId) || !httpsUrl(provenance.sourceUrl) || !httpsUrl(provenance.licenceUrl)
    || typeof provenance.attribution !== 'string' || !provenance.attribution.trim()
    || !validDate(provenance.effectiveFrom) || !validDate(provenance.effectiveThrough)
    || !validDate(provenance.reviewedThrough) || provenance.effectiveFrom > provenance.effectiveThrough
    || provenance.reviewedThrough < provenance.effectiveFrom
    || parseChargeInstant(provenance.checkedAt) === null) return null;
  if (!geojson || typeof geojson !== 'object' || rejectsCoordinateOverride(geojson)) return null;
  const obj = geojson as { type?: unknown; features?: unknown; geometry?: unknown; coordinates?: unknown };
  const geometries: unknown[] = obj.type === 'FeatureCollection' && Array.isArray(obj.features)
    ? obj.features.map((item: unknown) => item && typeof item === 'object'
      && (item as { type?: unknown }).type === 'Feature' ? (item as { geometry?: unknown }).geometry : null)
    : obj.type === 'Feature' ? [obj.geometry] : [geojson];
  if (!geometries.length || geometries.length > MAX_POLYGONS) return null;
  const polygons: PreparedPolygon[] = [];
  let totalVertices = 0;
  const budget = { remaining: MAX_GEOMETRY_COMPARISONS };
  for (const geometry of geometries) {
    if (!geometry || typeof geometry !== 'object') return null;
    const g = geometry as { type?: unknown; coordinates?: unknown };
    const sets = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
    if (!Array.isArray(sets)) return null;
    for (const candidate of sets) {
      if (!Array.isArray(candidate) || !candidate.length || !candidate.every(ring => validRing(ring, budget))) return null;
      const rings = candidate as Polygon;
      const vertices = rings.reduce((sum, ring) => sum + ring.length, 0);
      totalVertices += vertices;
      if (totalVertices > MAX_VERTICES || polygons.length >= MAX_POLYGONS) return null;
      if (!validHoles(rings, budget)) return null;
      // Snapshot the validated coordinates. External GeoJSON must not be able
      // to mutate the compiled zone after its integrity checks have passed.
      const snapshot: Polygon = Object.freeze(rings.map(ring =>
        Object.freeze(ring.map(point => Object.freeze([point[0]!, point[1]!]))),
      ));
      polygons.push(Object.freeze({ rings: snapshot, bounds: Object.freeze(boxForRing(snapshot[0]!)), vertices }));
    }
  }
  return polygons.length ? Object.freeze({
    provenance: Object.freeze({ ...provenance }), polygons: Object.freeze(polygons),
  }) : null;
}
function cross(a: Position, b: Position, c: Position): number {
  return (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
}
function onEdge(p: Position, a: Position, b: Position): boolean {
  return Math.abs(cross(a, b, p)) <= 1e-10
    && p[0]! >= Math.min(a[0]!, b[0]!) - 1e-10
    && p[0]! <= Math.max(a[0]!, b[0]!) + 1e-10
    && p[1]! >= Math.min(a[1]!, b[1]!) - 1e-10
    && p[1]! <= Math.max(a[1]!, b[1]!) + 1e-10;
}
function segmentIntersects(a: Position, b: Position, c: Position, d: Position): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (onEdge(c, a, b) || onEdge(d, a, b) || onEdge(a, c, d) || onEdge(b, c, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}
function insideRing(point: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i]!;
    if ((a[1]! > point[1]!) !== (b[1]! > point[1]!)
      && point[0]! < (b[0]! - a[0]!) * (point[1]! - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
}
// Conservatively reject touching or intersecting hole boundaries and nested holes.
function validHoles(rings: Polygon, budget: { remaining: number }): boolean {
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i]!;
    const outer = rings[0]!;
    budget.remaining -= outer.length;
    if (budget.remaining < 0 || !insideRing(hole[0]!, outer)) return false;
    for (let j = 0; j < i; j++) {
      const other = rings[j]!;
      budget.remaining -= (hole.length - 1) * (other.length - 1);
      if (budget.remaining < 0) return false;
      for (let a = 1; a < hole.length; a++) {
        for (let b = 1; b < other.length; b++) {
          if (segmentIntersects(hole[a - 1]!, hole[a]!, other[b - 1]!, other[b]!)) return false;
        }
      }
      if (j > 0) {
        budget.remaining -= hole.length + other.length;
        if (budget.remaining < 0 || insideRing(hole[0]!, other) || insideRing(other[0]!, hole)) return false;
      }
    }
  }
  return true;
}
function insidePolygon(point: Position, rings: Polygon): boolean {
  return insideRing(point, rings[0]!) && !rings.slice(1).some(ring => insideRing(point, ring));
}
function routeBox(points: readonly RoutePosition[]): BoundingBox {
  let minLon = Infinity; let maxLon = -Infinity; let minLat = Infinity; let maxLat = -Infinity;
  for (const p of points) {
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
  }
  return { minLon, maxLon, minLat, maxLat };
}
/** In-memory screening only. Does not authorise routing, pricing or eligibility. */
export function screenRouteAgainstChargeZone(
  route: readonly RoutePosition[], zone: PreparedChargeZone | null, asOfLocalDate: string,
): ZoneScreenResult {
  const schemeId = zone?.provenance.schemeId ?? 'uk_caz';
  const answer = (status: ZoneScreenStatus, reason: ZoneScreenReason): ZoneScreenResult =>
    ({ schemeId, ...(zone?.provenance.zoneId ? { zoneId: zone.provenance.zoneId } : {}), status, reason });
  if (!zone || !validDate(asOfLocalDate) || !Array.isArray(route) || route.length < 2
    || route.length > MAX_ROUTE_POINTS || route.some(p => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)
      || Math.abs(p.lon) > 180 || Math.abs(p.lat) > 90)) return answer('unknown', 'missing_or_invalid_data');
  const { provenance, polygons } = zone;
  if (asOfLocalDate < provenance.effectiveFrom || asOfLocalDate > provenance.effectiveThrough
    || asOfLocalDate > provenance.reviewedThrough) return answer('unknown', 'outside_verified_period');
  // Date-only zone screening cannot rely on months-old geometry merely
  // because a dataset declares a far-future validity end.
  if (reviewChargeEvidenceFreshness('geometry', provenance.checkedAt,
    asOfLocalDate + 'T12:00:00Z').status !== 'fresh')
    return answer('unknown', 'stale_source_review');
  let hasMovement = false;
  for (let i = 1; i < route.length; i++) {
    const previous = route[i - 1]!, current = route[i]!;
    if (Math.abs(current.lon - previous.lon) > 180)
      return answer('unknown', 'missing_or_invalid_data');
    if (current.lon !== previous.lon || current.lat !== previous.lat) hasMovement = true;
  }
  // A repeated GPS fix is not a route. It cannot establish a polygon miss.
  if (!hasMovement) return answer('unknown', 'missing_or_invalid_data');
  const bounds = routeBox(route);
  let comparisons = 0;
  for (const polygon of polygons) {
    if (!overlaps(bounds, polygon.bounds)) continue;
    for (let i = 0; i < route.length - 1; i++) {
      const a: Position = [route[i]!.lon, route[i]!.lat], b: Position = [route[i + 1]!.lon, route[i + 1]!.lat];
      const segmentBounds = { minLon: Math.min(a[0]!, b[0]!), maxLon: Math.max(a[0]!, b[0]!),
        minLat: Math.min(a[1]!, b[1]!), maxLat: Math.max(a[1]!, b[1]!) };
      if (!overlaps(segmentBounds, polygon.bounds)) continue;
      comparisons += polygon.vertices;
      if (comparisons > MAX_GEOMETRY_COMPARISONS) return answer('unknown', 'too_complex');
      // A route can cross the zone even when neither endpoint falls inside.
      for (const ring of polygon.rings) for (let j = 1; j < ring.length; j++) {
        if (segmentIntersects(a, b, ring[j - 1]!, ring[j]!))
          return answer('possible_polygon_contact', 'route_intersects_polygon');
      }
      if (insidePolygon(a, polygon.rings) || insidePolygon(b, polygon.rings))
        return answer('possible_polygon_contact', 'route_on_or_inside_polygon');
    }
  }
  // A sparse path not touching a polygon is NOT a verified charge-free road.
  return answer('no_polygon_contact', 'geometry_does_not_contact_polygon');
}
