/**
 * Future-only road-topology corroboration for ENGLISH toll infrastructure.
 *
 * A GPS trace, 2D geometric crossing or a community toll=yes map tag is not
 * evidence that the rider used the actual tolled carriageway. Even a matching
 * reviewed way/layer/direction is only a CANDIDATE: this module never creates
 * a confirmed charge event, quotes a tariff or asserts toll-free travel.
 *
 * It makes no network requests and contains no production road geometries.
 */
import { findEnglishTollInfrastructure } from './ukTollInfrastructure.ts';

export type MatchedRoadSource = 'reviewed_graph' | 'osm_tag_only' | 'gps_geometry_only';
export type WayTravelDirection = 'forward' | 'backward' | 'unknown';
export type ReviewedTollDirection = 'forward' | 'backward' | 'both';
export interface RouteTollWayObservation {
  /** Stable ID of this candidate contact, distinct from map way or toll ID. */
  contactId: string;
  infrastructureId: string;
  routeSegmentIndex: number;
  wayId: string;
  layer: number | null;
  direction: WayTravelDirection;
  source: MatchedRoadSource;
  /** SHA-256 of a legally reviewed and pinned source road graph. */
  graphSha256: string;
}
export interface ReviewedTollRoadLink {
  infrastructureId: string;
  wayId: string;
  layer: number | null;
  chargeDirection: ReviewedTollDirection;
  /** The corresponding source graph, not a similar version of it. */
  graphSha256: string;
  /** Independently checked with the operator; not inferred from a toll=yes tag. */
  authorityCorroborated: boolean;
  authoritySourceUrl: string;
  reviewedOn: string;
  reviewedThrough: string;
  /** Source-level commercial reuse must have been separately approved. */
  commercialReuseApproved: boolean;
  licenceUrl: string;
  attribution: string;
  approvalReference: string;
}

export type TollRoadContactReason =
  | 'topology_reviewed_candidate'
  | 'no_reviewed_way_link'
  | 'unreliable_map_match'
  | 'source_version_mismatch'
  | 'different_road'
  | 'grade_separated'
  | 'direction_not_verified'
  | 'opposite_direction'
  | 'source_stale'
  | 'licence_not_approved'
  | 'authority_not_verified';
export interface TollRoadContactReview {
  contactId: string;
  infrastructureId: string;
  status: 'possible_road_contact' | 'unknown';
  reason: TollRoadContactReason;
}
export interface TollRoadTopologyReview {
  status: 'screened' | 'unknown';
  possibleRoadContacts: number;
  results: TollRoadContactReview[];
  reason?: 'invalid_input' | 'no_observations';
  requiresOperatorReview: true;
  routeCoverageComplete: false;
}
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,95}$/;
const MAX_CONTACTS = 256;
const MAX_LINKS = 256;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function parseDay(value: unknown): number | null {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value
    ? ms / 86400000 : null;
}
function validHttps(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname;
  } catch { return false; }
}
function validLayer(value: unknown): value is number | null {
  // null is explicitly unknown, not equivalent to a road on ground level.
  return value === null || (typeof value === 'number' && Number.isInteger(value)
    && value >= -10 && value <= 10);
}
function validObservation(value: RouteTollWayObservation): boolean {
  return !!value && ID.test(value.contactId) && ID.test(value.infrastructureId)
    && !!findEnglishTollInfrastructure(value.infrastructureId)
    && Number.isInteger(value.routeSegmentIndex)
    && value.routeSegmentIndex >= 0 && value.routeSegmentIndex <= 9999
    && ID.test(value.wayId) && validLayer(value.layer)
    && ['forward', 'backward', 'unknown'].includes(value.direction)
    && ['reviewed_graph', 'osm_tag_only', 'gps_geometry_only'].includes(value.source)
    && SHA256.test(value.graphSha256);
}
function validLink(value: ReviewedTollRoadLink): boolean {
  return !!value && ID.test(value.infrastructureId)
    && !!findEnglishTollInfrastructure(value.infrastructureId)
    && ID.test(value.wayId) && validLayer(value.layer)
    && ['forward', 'backward', 'both'].includes(value.chargeDirection)
    && SHA256.test(value.graphSha256)
    && typeof value.authorityCorroborated === 'boolean'
    && validHttps(value.authoritySourceUrl)
    && parseDay(value.reviewedOn) !== null
    && parseDay(value.reviewedThrough) !== null
    && typeof value.commercialReuseApproved === 'boolean'
    && validHttps(value.licenceUrl)
    && typeof value.attribution === 'string' && value.attribution.trim().length > 0
    && value.attribution.length <= 250
    && typeof value.approvalReference === 'string'
    && value.approvalReference.trim().length >= 4
    && value.approvalReference.length <= 128;
}
/**
 * A matching link is deliberately not enough for a confirmed crossing.
 * Requires matching pinned graph version, same road identity, same stacked
 * road layer, compatible travel direction, fresh authority review and an
 * explicit commercial data rights approval.
 */
export function reviewTollRoadTopology(
  observations: readonly RouteTollWayObservation[],
  links: readonly ReviewedTollRoadLink[],
  asOfLocalDate: string,
): TollRoadTopologyReview {
  const empty = (reason: TollRoadTopologyReview['reason']): TollRoadTopologyReview => ({
    status: 'unknown', reason, possibleRoadContacts: 0, results: [],
    requiresOperatorReview: true, routeCoverageComplete: false,
  });
  const day = parseDay(asOfLocalDate);
  if (day === null || !Array.isArray(observations) || !Array.isArray(links)
    || observations.length > MAX_CONTACTS || links.length > MAX_LINKS
    || observations.some(o => !validObservation(o)) || links.some(l => !validLink(l)))
    return empty('invalid_input');
  const ids = observations.map(o => o.contactId);
  const linkIds = links.map(l => JSON.stringify([l.infrastructureId, l.wayId]));
  if (new Set(ids).size !== ids.length || new Set(linkIds).size !== linkIds.length)
    return empty('invalid_input');
  if (observations.length === 0) return empty('no_observations');
  const results: TollRoadContactReview[] = [];
  for (const item of observations) {
    const link = links.find(l => l.infrastructureId === item.infrastructureId
      && l.wayId === item.wayId);
    let reason: TollRoadContactReason = 'topology_reviewed_candidate';
    if (!link) reason = 'no_reviewed_way_link';
    else if (item.source !== 'reviewed_graph') reason = 'unreliable_map_match';
    else if (link.graphSha256 !== item.graphSha256) reason = 'source_version_mismatch';
    else if (link.wayId !== item.wayId || link.infrastructureId !== item.infrastructureId)
      reason = 'different_road';
    else if (link.layer === null || item.layer === null || link.layer !== item.layer)
      reason = 'grade_separated';
    else if (item.direction === 'unknown') reason = 'direction_not_verified';
    else if (link.chargeDirection !== 'both' && item.direction !== link.chargeDirection)
      reason = 'opposite_direction';
    else if (parseDay(link.reviewedOn)! > day || parseDay(link.reviewedThrough)! < day
      || day - parseDay(link.reviewedOn)! > 30) reason = 'source_stale';
    else if (!link.commercialReuseApproved) reason = 'licence_not_approved';
    else if (!link.authorityCorroborated) reason = 'authority_not_verified';
    results.push({
      contactId: item.contactId, infrastructureId: item.infrastructureId,
      status: reason === 'topology_reviewed_candidate' ? 'possible_road_contact' : 'unknown',
      reason,
    });
  }
  return {
    // A single uncertain observation means no complete screened result.
    status: results.every(r => r.status === 'possible_road_contact') ? 'screened' : 'unknown',
    possibleRoadContacts: results.filter(r => r.status === 'possible_road_contact').length,
    results, requiresOperatorReview: true, routeCoverageComplete: false,
  };
}
