/**
 * Where to draw the rider's puck during turn-by-turn navigation.
 *
 * A raw GPS fix is typically 5-15 m off the road and already about a second
 * old when it arrives, so drawing it as-is puts the puck beside the road and
 * behind the rider. Consumer navigation apps do three things instead, and so
 * does this module:
 *
 *  1. Map matching: while the fix is close to the route and moving the same
 *     way, it is projected onto the route line ("snapped").
 *  2. Prediction: the snapped position is advanced along the route by the
 *     rider's speed x the time since the fix was taken, so the puck shows
 *     where the rider is now (or will be when the next fix is due).
 *  3. Continuity: the search for the snapped point starts from where the
 *     previous fix matched, so the puck cannot jump to a parallel road or
 *     the other side of a hairpin.
 *
 * The PWA has a browser port in docs/navigation-puck.js;
 * scripts/check-navigation-puck.mjs runs shared fixtures against both.
 */

export interface PuckCoordinate {
  lat: number;
  lon: number;
}

export interface NavigationPathIndex {
  points: PuckCoordinate[];
  /** Distance from the start of the path to each point, in metres. */
  cumulative: number[];
  totalMeters: number;
}

export interface NavigationPuckFix {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres, when the platform reports it. */
  accuracyMeters?: number | null;
  /** Direction of travel in degrees, when the platform reports it. */
  headingDegrees?: number | null;
  speedMps?: number | null;
}

export interface NavigationPuckMatch {
  lat: number;
  lon: number;
  /** True when the fix was projected onto the route. */
  snapped: boolean;
  /** Distance along the route of the matched point (metres). */
  distanceAlongMeters: number;
  /** How far the raw fix was from the route (metres). */
  offsetMeters: number;
  /** Travel direction at the matched point (degrees). */
  bearingDegrees: number | null;
}

export const PUCK_MIN_SNAP_METERS = 20;
export const PUCK_MAX_SNAP_METERS = 40;
export const PUCK_MAX_HEADING_DIFF_DEGREES = 70;
/** Below this speed, GPS heading is noise and is not used to veto a snap. */
export const PUCK_HEADING_TRUST_SPEED_MPS = 3;
/** Never predict further ahead than this, however stale the fix. */
export const PUCK_MAX_PREDICTION_SECONDS = 2.5;
export const PUCK_MAX_PREDICTION_METERS = 60;

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

function metersBetween(a: PuckCoordinate, b: PuckCoordinate): number {
  const meanLat = ((a.lat + b.lat) / 2) * DEG;
  const x = (b.lon - a.lon) * DEG * Math.cos(meanLat);
  const y = (b.lat - a.lat) * DEG;
  return Math.hypot(x, y) * EARTH_RADIUS_M;
}

function bearingBetween(a: PuckCoordinate, b: PuckCoordinate): number {
  const meanLat = ((a.lat + b.lat) / 2) * DEG;
  const x = (b.lon - a.lon) * Math.cos(meanLat);
  const y = b.lat - a.lat;
  return (Math.atan2(x, y) / DEG + 360) % 360;
}

function angleDifference(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return diff;
}

export function buildNavigationPathIndex(path: readonly PuckCoordinate[]): NavigationPathIndex {
  const points: PuckCoordinate[] = [];
  for (const point of path) {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) continue;
    const previous = points[points.length - 1];
    // Step paths share their joining point; drop exact repeats.
    if (previous && previous.lat === point.lat && previous.lon === point.lon) continue;
    points.push({ lat: point.lat, lon: point.lon });
  }
  const cumulative: number[] = [];
  let total = 0;
  points.forEach((point, index) => {
    if (index > 0) total += metersBetween(points[index - 1]!, point);
    cumulative.push(total);
  });
  return { points, cumulative, totalMeters: total };
}

/** The point and travel direction a given distance along the path. */
export function navigationPathPointAt(
  index: NavigationPathIndex,
  distanceAlongMeters: number,
): { lat: number; lon: number; bearingDegrees: number | null } | null {
  const { points, cumulative, totalMeters } = index;
  if (points.length === 0) return null;
  if (points.length === 1) return { ...points[0]!, bearingDegrees: null };
  const target = Math.max(0, Math.min(totalMeters, distanceAlongMeters));
  let segment = 0;
  while (segment < points.length - 2 && cumulative[segment + 1]! < target) segment += 1;
  const start = points[segment]!;
  const end = points[segment + 1]!;
  const length = cumulative[segment + 1]! - cumulative[segment]!;
  const t = length > 0 ? (target - cumulative[segment]!) / length : 0;
  return {
    lat: start.lat + (end.lat - start.lat) * t,
    lon: start.lon + (end.lon - start.lon) * t,
    bearingDegrees: length > 0 ? bearingBetween(start, end) : null,
  };
}

/**
 * Projects a fix onto the route. `previousDistanceAlongMeters` (from the
 * last match) keeps the search near where the rider already was.
 */
export function matchFixToPath(
  index: NavigationPathIndex,
  fix: NavigationPuckFix,
  previousDistanceAlongMeters: number | null = null,
): NavigationPuckMatch {
  const raw: NavigationPuckMatch = {
    lat: fix.lat,
    lon: fix.lon,
    snapped: false,
    distanceAlongMeters: previousDistanceAlongMeters ?? 0,
    offsetMeters: Number.POSITIVE_INFINITY,
    bearingDegrees: null,
  };
  const { points, cumulative } = index;
  if (points.length < 2 || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return raw;

  const speed = Number.isFinite(fix.speedMps) ? Math.max(0, Number(fix.speedMps)) : 0;
  const hasHistory = previousDistanceAlongMeters !== null && Number.isFinite(previousDistanceAlongMeters);
  // Prefer the stretch of route just after the last match: a candidate that
  // would mean jumping further than the rider could plausibly have gone
  // costs extra, so a parallel road or the other leg of a hairpin loses.
  const jumpSlack = speed * 4 + 40;
  const jumpCost = (along: number) => {
    if (!hasHistory) return 0;
    const jump = along - previousDistanceAlongMeters!;
    // Going backwards is far less likely than a late fix further on.
    const excess = jump < 0 ? -jump - 20 : jump - jumpSlack;
    return Math.max(0, excess) * 0.5;
  };

  const cosLat = Math.cos(fix.lat * DEG);
  const toLocal = (point: PuckCoordinate) => ({
    x: (point.lon - fix.lon) * DEG * cosLat * EARTH_RADIUS_M,
    y: (point.lat - fix.lat) * DEG * EARTH_RADIUS_M,
  });

  let best: { cost: number; distance: number; along: number; segment: number; t: number } | null = null;
  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const a = toLocal(points[segment]!);
    const b = toLocal(points[segment + 1]!);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSq)) : 0;
    const distance = Math.hypot(a.x + dx * t, a.y + dy * t);
    const along = cumulative[segment]! + (cumulative[segment + 1]! - cumulative[segment]!) * t;
    const cost = distance + jumpCost(along);
    if (!best || cost < best.cost) best = { cost, distance, along, segment, t };
  }
  if (!best) return raw;

  const start = points[best.segment]!;
  const end = points[best.segment + 1]!;
  const segmentBearing = bearingBetween(start, end);
  const accuracy = Number.isFinite(fix.accuracyMeters) ? Number(fix.accuracyMeters) : PUCK_MIN_SNAP_METERS;
  const snapRadius = Math.max(PUCK_MIN_SNAP_METERS, Math.min(PUCK_MAX_SNAP_METERS, accuracy * 1.5));
  const heading = Number.isFinite(fix.headingDegrees) && Number(fix.headingDegrees) >= 0
    ? Number(fix.headingDegrees)
    : null;
  const headingAgrees = heading === null
    || speed < PUCK_HEADING_TRUST_SPEED_MPS
    || angleDifference(heading, segmentBearing) <= PUCK_MAX_HEADING_DIFF_DEGREES;

  if (best.distance > snapRadius || !headingAgrees) {
    // After a long gap the rider may be far beyond the last match: look
    // along the whole route before giving up on snapping.
    if (hasHistory && best.distance > snapRadius) return matchFixToPath(index, fix, null);
    return { ...raw, distanceAlongMeters: best.along, offsetMeters: best.distance, bearingDegrees: heading };
  }
  return {
    lat: start.lat + (end.lat - start.lat) * best.t,
    lon: start.lon + (end.lon - start.lon) * best.t,
    snapped: true,
    distanceAlongMeters: best.along,
    offsetMeters: best.distance,
    bearingDegrees: segmentBearing,
  };
}

/**
 * Where the puck should be `secondsAhead` after the fix was taken: along
 * the route when snapped, straight along the GPS heading when not.
 */
export function predictNavigationPuck(
  index: NavigationPathIndex,
  match: NavigationPuckMatch,
  speedMps: number | null | undefined,
  secondsAhead: number,
): { lat: number; lon: number; bearingDegrees: number | null } {
  const speed = Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : 0;
  const seconds = Math.max(0, Math.min(PUCK_MAX_PREDICTION_SECONDS, Number.isFinite(secondsAhead) ? secondsAhead : 0));
  const advance = Math.min(PUCK_MAX_PREDICTION_METERS, speed * seconds);
  if (match.snapped) {
    const point = navigationPathPointAt(index, match.distanceAlongMeters + advance);
    if (point) return { lat: point.lat, lon: point.lon, bearingDegrees: point.bearingDegrees ?? match.bearingDegrees };
  }
  if (advance <= 0 || match.bearingDegrees === null) {
    return { lat: match.lat, lon: match.lon, bearingDegrees: match.bearingDegrees };
  }
  const bearing = match.bearingDegrees * DEG;
  const northMeters = Math.cos(bearing) * advance;
  const eastMeters = Math.sin(bearing) * advance;
  return {
    lat: match.lat + (northMeters / EARTH_RADIUS_M) / DEG,
    lon: match.lon + (eastMeters / (EARTH_RADIUS_M * Math.cos(match.lat * DEG))) / DEG,
    bearingDegrees: match.bearingDegrees,
  };
}

/** How old a fix is when it arrives, clamped to a sane range (seconds). */
export function navigationFixAgeSeconds(fixTimestampMs: number | null | undefined, nowMs: number): number {
  if (!Number.isFinite(fixTimestampMs)) return 0;
  return Math.max(0, Math.min(PUCK_MAX_PREDICTION_SECONDS, (nowMs - Number(fixTimestampMs)) / 1000));
}

/** A fix farther than this from the route (current or next step) is off it. */
export const NAV_OFF_ROUTE_RADIUS_M = 60;
/** A fix less certain than this can't tell on-route from off-route, so it
 * neither starts nor clears the off-route timer (tunnels, urban canyons). */
export const NAV_OFF_ROUTE_MAX_ACCURACY_M = 50;

/**
 * Whether a raw fix shows the rider on the route, off it, or can't say.
 * Distances are to the current step's path and to the next step's, since a
 * rider who has already turned at a junction is on the next step.
 */
export function navigationRouteStatus(
  distanceToStepMeters: number,
  distanceToNextStepMeters: number | null,
  accuracyMeters: number | null | undefined,
): 'on' | 'off' | 'unknown' {
  if (Number.isFinite(accuracyMeters) && Number(accuracyMeters) > NAV_OFF_ROUTE_MAX_ACCURACY_M) return 'unknown';
  const nearest = distanceToNextStepMeters === null || !Number.isFinite(distanceToNextStepMeters)
    ? distanceToStepMeters
    : Math.min(distanceToStepMeters, distanceToNextStepMeters);
  return nearest > NAV_OFF_ROUTE_RADIUS_M ? 'off' : 'on';
}

/** The cone turns in steps this size, so the marker is redrawn only when the
 * change is visible. */
export const PUCK_CONE_STEP_DEGREES = 5;

/**
 * Which way, clockwise from screen-up, the cone on the navigation puck points:
 * the rider's direction of travel less the map's rotation. The avatar itself
 * stays upright; the cone shows where the rider is heading, as Google and
 * Apple Maps do. Null hides the cone (no trustworthy direction yet).
 */
export function navigationPuckConeDegrees(
  travelHeadingDegrees: number | null | undefined,
  mapHeadingDegrees: number | null | undefined,
): number | null {
  if (!Number.isFinite(travelHeadingDegrees) || Number(travelHeadingDegrees) < 0) return null;
  const mapHeading = Number.isFinite(mapHeadingDegrees) ? Number(mapHeadingDegrees) : 0;
  const relative = (((Number(travelHeadingDegrees) - mapHeading) % 360) + 360) % 360;
  return (Math.round(relative / PUCK_CONE_STEP_DEGREES) * PUCK_CONE_STEP_DEGREES) % 360;
}

/** The navigation puck's drawing box (square, points); the avatar sits in the
 * middle at PUCK_AVATAR_SIZE and the cone around it. */
export const PUCK_BOX_SIZE = 96;
export const PUCK_AVATAR_SIZE = 64;
/** A soft beam either side of the direction of travel, drawn pointing up from
 * the centre of the box and rotated by navigationPuckConeDegrees. */
export const PUCK_CONE_BEAM_PATH = 'M48 48 L26.7 6.1 A47 47 0 0 1 69.3 6.1 Z';
/** A solid arrowhead just outside the avatar, readable in sunlight. */
export const PUCK_CONE_ARROW_PATH = 'M48 1.5 L58 15 L48 11 L38 15 Z';
export const PUCK_CONE_COLOR = '#1f8fbf';

/** A ride's elapsed time and distance, for the arrival summary. */
export interface NavigationTrip {
  startedAt: number;
  distanceMeters: number;
  last: PuckCoordinate | null;
}

/** Fixes less certain than this, or moves shorter than this (GPS drift while
 * stopped), don't add to the trip's distance. */
export const TRIP_MAX_ACCURACY_M = 50;
export const TRIP_MIN_STEP_M = 5;

export function startNavigationTrip(nowMs: number): NavigationTrip {
  return { startedAt: nowMs, distanceMeters: 0, last: null };
}

/** Adds a raw GPS fix to the trip (returns a new trip). */
export function recordNavigationTripFix(
  trip: NavigationTrip,
  fix: { lat: number; lon: number; accuracyMeters?: number | null },
): NavigationTrip {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return trip;
  if (Number.isFinite(fix.accuracyMeters) && Number(fix.accuracyMeters) > TRIP_MAX_ACCURACY_M) return trip;
  const here = { lat: fix.lat, lon: fix.lon };
  if (!trip.last) return { ...trip, last: here };
  const step = metersBetween(trip.last, here);
  if (step < TRIP_MIN_STEP_M) return trip;
  return { ...trip, distanceMeters: trip.distanceMeters + step, last: here };
}

/** Whole seconds since the trip started. */
export function navigationTripSeconds(trip: NavigationTrip, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - trip.startedAt) / 1000));
}

/**
 * The direction of travel the puck's cone should show, or null to hide it.
 * Below PUCK_HEADING_TRUST_SPEED_MPS (or with no speed) the phone can't tell
 * which way the rider faces (GPS course is noise when stopped, and the first
 * route segment may point anywhere), so the cone hides rather than guess.
 * Moving: the route's direction when snapped to it, else the GPS course.
 */
export function navigationPuckTravelHeading(
  snapped: boolean,
  routeBearingDegrees: number | null | undefined,
  gpsHeadingDegrees: number | null | undefined,
  speedMps: number | null | undefined,
): number | null {
  if (!Number.isFinite(speedMps) || Number(speedMps) < PUCK_HEADING_TRUST_SPEED_MPS) return null;
  if (snapped && Number.isFinite(routeBearingDegrees)) return Number(routeBearingDegrees);
  if (Number.isFinite(gpsHeadingDegrees) && Number(gpsHeadingDegrees) >= 0) return Number(gpsHeadingDegrees);
  return null;
}

/** A turn arrow drawn on the road at the next maneuver, as Google and Apple
 * Maps do: the last stretch before the turn and the first stretch after it,
 * ending in an arrowhead. `path` is one polyline: the shaft, then the head
 * drawn as left barb → tip → right barb. */
export interface NavigationManeuverArrow {
  path: PuckCoordinate[];
  tip: PuckCoordinate;
}

export const MANEUVER_ARROW_BEFORE_M = 35;
export const MANEUVER_ARROW_AFTER_M = 25;
export const MANEUVER_ARROW_HEAD_M = 9;

function cleanPath(path: readonly PuckCoordinate[]): PuckCoordinate[] {
  return path.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon))
    .map((point) => ({ lat: point.lat, lon: point.lon }));
}

function pointAlong(a: PuckCoordinate, b: PuckCoordinate, fraction: number): PuckCoordinate {
  return { lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction };
}

/** Up to `metres` of `path` from its start, cut part-way through a segment. */
function leadingStretch(path: readonly PuckCoordinate[], metres: number): PuckCoordinate[] {
  const out: PuckCoordinate[] = [];
  let left = metres;
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index]!;
    if (index === 0) { out.push(point); continue; }
    const previous = path[index - 1]!;
    const length = metersBetween(previous, point);
    if (length >= left) {
      if (length > 0) out.push(pointAlong(previous, point, left / length));
      return out;
    }
    out.push(point);
    left -= length;
  }
  return out;
}

function offsetPoint(point: PuckCoordinate, bearingDegrees: number, metres: number): PuckCoordinate {
  const bearing = bearingDegrees * DEG;
  return {
    lat: point.lat + (Math.cos(bearing) * metres / EARTH_RADIUS_M) / DEG,
    lon: point.lon + (Math.sin(bearing) * metres / (EARTH_RADIUS_M * Math.cos(point.lat * DEG))) / DEG,
  };
}

/** The turn arrow from the current step into the next, or null without a next step. */
export function navigationManeuverArrow(
  stepPath: readonly PuckCoordinate[],
  nextStepPath: readonly PuckCoordinate[] | null | undefined,
): NavigationManeuverArrow | null {
  const step = cleanPath(stepPath);
  const next = cleanPath(nextStepPath ?? []);
  if (step.length < 2 || next.length < 2) return null;
  const before = leadingStretch([...step].reverse(), MANEUVER_ARROW_BEFORE_M).reverse();
  const after = leadingStretch(next, MANEUVER_ARROW_AFTER_M);
  const shaft = [...before];
  for (const point of after) {
    const last = shaft[shaft.length - 1]!;
    if (metersBetween(last, point) > 0.5) shaft.push(point);
  }
  if (shaft.length < 2) return null;
  const tip = shaft[shaft.length - 1]!;
  // Aim the head along the last metre or more of the shaft.
  let from = shaft[shaft.length - 2]!;
  for (let index = shaft.length - 2; index >= 0 && metersBetween(shaft[index]!, tip) < 1; index -= 1) from = shaft[index]!;
  const back = (bearingBetween(from, tip) + 180) % 360;
  return {
    path: [...shaft, offsetPoint(tip, back - 35, MANEUVER_ARROW_HEAD_M), tip, offsetPoint(tip, back + 35, MANEUVER_ARROW_HEAD_M)],
    tip,
  };
}
