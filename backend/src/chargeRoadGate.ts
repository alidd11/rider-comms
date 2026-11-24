/**
 * No-network candidate crossing detector for explicitly reviewed road gates.
 *
 * A 2D polyline crossing is NOT proof of a chargeable road: bridges,
 * underpasses, restricted carriageways, map-matching, vehicle rules and
 * chargeable direction all need separately verified road-level evidence.
 * This module never emits 'confirmed_crossing' or a payable fee.
 */
import { londonChargingDate, validChargingZoneId, type ChargingSchemeId } from './chargingRules.ts';
import type { RoutePosition } from './chargeZoneGeometry.ts';
import { reviewChargeEvidenceFreshness } from './chargeSourceFreshness.ts';

export type GateDirection = 'either' | 'negative_to_positive' | 'positive_to_negative';
export interface ReviewedRoadGate {
  id: string;
  schemeId: ChargingSchemeId;
  zoneId?: string;
  /** Authority/source provenance must be checked before a gate is shipped. */
  sourceUrl: string;
  /** When the operator's road geometry was actually rechecked (offset-bearing instant). */
  checkedAt: string;
  effectiveFrom: string;
  effectiveThrough: string;
  reviewedThrough: string;
  /** WGS84 endpoints of a review-approved crossing line, NOT a boundary polygon. */
  start: RoutePosition;
  end: RoutePosition;
  /** Side of the oriented start->end line; reviewers must validate direction. */
  direction: GateDirection;
}
export interface GateCandidate {
  gateId: string;
  schemeId: ChargingSchemeId;
  zoneId?: string;
  /** Index of the first point of the route segment intersecting the gate. */
  routeSegmentIndex: number;
}
export interface GateScreeningResult {
  /** Candidate contacts are advisory only, never verified charge events. */
  candidates: GateCandidate[];
  possibleGateContacts: number;
  requiresRoadReview: true;
  status: 'unknown' | 'screened';
  reason?: 'invalid_route_or_date' | 'invalid_gate_data' | 'ambiguous_contact' | 'too_many_candidates';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GATE_COUNT = 128;
const MAX_ROUTE_POINTS = 10_000;
const MAX_CANDIDATES = 256;
const SCHEMES = new Set<ChargingSchemeId>([
  'london_congestion', 'london_ulez', 'london_lez',
  'blackwall_silvertown', 'dart_charge', 'uk_caz', 'oxford_zez',
]);
function validHttps(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch { return false; }
}
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
function validPosition(value: unknown): value is RoutePosition {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<RoutePosition>;
  return typeof p.lon === 'number' && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180
    && typeof p.lat === 'number' && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90;
}
function validGate(gate: ReviewedRoadGate, date: string, passageAt: string): boolean {
  if (!gate || typeof gate.id !== 'string' || !/^[a-z][a-z0-9_-]{2,63}$/.test(gate.id)
    || !SCHEMES.has(gate.schemeId) || !validChargingZoneId(gate.schemeId, gate.zoneId)
    || !validHttps(gate.sourceUrl)
    // A declared validity end does not prove that the source was recently checked.
    // This remains advisory: a fresh timestamp is not proof of operator approval.
    || reviewChargeEvidenceFreshness('geometry', gate.checkedAt, passageAt).status !== 'fresh'
    || !validDay(gate.effectiveFrom) || !validDay(gate.effectiveThrough) || !validDay(gate.reviewedThrough)
    || gate.effectiveFrom > gate.effectiveThrough || date < gate.effectiveFrom
    || date > gate.effectiveThrough || date > gate.reviewedThrough
    || !validPosition(gate.start) || !validPosition(gate.end)
    || (gate.start.lon === gate.end.lon && gate.start.lat === gate.end.lat)
    || Math.abs(gate.start.lon - gate.end.lon) > 180
    || !['either', 'negative_to_positive', 'positive_to_negative'].includes(gate.direction)) return false;
  return true;
}
function orientation(a: RoutePosition, b: RoutePosition, c: RoutePosition): number {
  return (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
}
function boxesOverlap(a: RoutePosition, b: RoutePosition, c: RoutePosition, d: RoutePosition): boolean {
  return Math.max(Math.min(a.lon, b.lon), Math.min(c.lon, d.lon))
      <= Math.min(Math.max(a.lon, b.lon), Math.max(c.lon, d.lon))
    && Math.max(Math.min(a.lat, b.lat), Math.min(c.lat, d.lat))
      <= Math.min(Math.max(a.lat, b.lat), Math.max(c.lat, d.lat));
}

/** Screen existing route points without further API calls or legal conclusions. */
export function screenReviewedRoadGates(
  route: readonly RoutePosition[],
  passageAt: string,
  gates: readonly ReviewedRoadGate[],
): GateScreeningResult {
  const unknown = (reason: NonNullable<GateScreeningResult['reason']>): GateScreeningResult =>
    ({ status: 'unknown', reason, candidates: [], possibleGateContacts: 0, requiresRoadReview: true });
  const date = londonChargingDate(passageAt);
  if (!date || !Array.isArray(route) || route.length < 2 || route.length > MAX_ROUTE_POINTS
    || route.some(p => !validPosition(p))) return unknown('invalid_route_or_date');
  let hasMovement = false;
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1]!, to = route[i]!;
    if (Math.abs(to.lon - from.lon) > 180) return unknown('invalid_route_or_date');
    if (to.lon !== from.lon || to.lat !== from.lat) hasMovement = true;
  }
  if (!hasMovement) return unknown('invalid_route_or_date');
  if (!Array.isArray(gates) || gates.length === 0 || gates.length > MAX_GATE_COUNT
    || new Set(gates.map(g => g?.id)).size !== gates.length
    || gates.some(g => !validGate(g, date, passageAt))) return unknown('invalid_gate_data');
  const candidates: GateCandidate[] = [];
  let ambiguous = false;
  for (const gate of gates) {
    for (let index = 1; index < route.length; index++) {
      const from = route[index - 1]!, to = route[index]!;
      // Repeated GPS fixes are not a crossing or an ambiguous touch.
      if (from.lon === to.lon && from.lat === to.lat) continue;
      if (!boxesOverlap(gate.start, gate.end, from, to)) continue;
      const sideFrom = orientation(gate.start, gate.end, from);
      const sideTo = orientation(gate.start, gate.end, to);
      const gateFrom = orientation(from, to, gate.start);
      const gateTo = orientation(from, to, gate.end);
      // Touching, grazing or collinear geometry is not strong route evidence.
      if ([sideFrom, sideTo, gateFrom, gateTo].some(value => Math.abs(value) < 1e-12)) {
        ambiguous = true;
        continue;
      }
      if (sideFrom * sideTo >= 0 || gateFrom * gateTo >= 0) continue;
      if (gate.direction === 'positive_to_negative' && !(sideFrom > 0 && sideTo < 0)) continue;
      if (gate.direction === 'negative_to_positive' && !(sideFrom < 0 && sideTo > 0)) continue;
      if (candidates.length >= MAX_CANDIDATES) return unknown('too_many_candidates');
      candidates.push({ gateId: gate.id, schemeId: gate.schemeId,
        ...(gate.zoneId ? { zoneId: gate.zoneId } : {}), routeSegmentIndex: index - 1 });
    }
  }
  // An uncertain contact means the catalogue cannot safely report a complete
  // candidate list, even if other segments were screened successfully.
  if (ambiguous) return unknown('ambiguous_contact');
  return { status: 'screened', candidates, possibleGateContacts: candidates.length,
    requiresRoadReview: true };
}
