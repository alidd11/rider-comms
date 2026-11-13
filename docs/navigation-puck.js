(function (root) {
  'use strict';

  // Generated from shared/src/navigationPuck.ts by
  // scripts/build-navigation-puck.mjs; edit the shared module, not this file.
  // scripts/check-navigation-puck.mjs runs shared fixtures against both.

  const PUCK_MIN_SNAP_METERS = 20;
  const PUCK_MAX_SNAP_METERS = 40;
  const PUCK_MAX_HEADING_DIFF_DEGREES = 70;
  /** Below this speed, GPS heading is noise and is not used to veto a snap. */
  const PUCK_HEADING_TRUST_SPEED_MPS = 3;
  /** Never predict further ahead than this, however stale the fix. */
  const PUCK_MAX_PREDICTION_SECONDS = 2.5;
  const PUCK_MAX_PREDICTION_METERS = 60;

  const EARTH_RADIUS_M = 6_371_000;
  const DEG = Math.PI / 180;

  function metersBetween(a, b) {
    const meanLat = ((a.lat + b.lat) / 2) * DEG;
    const x = (b.lon - a.lon) * DEG * Math.cos(meanLat);
    const y = (b.lat - a.lat) * DEG;
    return Math.hypot(x, y) * EARTH_RADIUS_M;
  }

  function bearingBetween(a, b) {
    const meanLat = ((a.lat + b.lat) / 2) * DEG;
    const x = (b.lon - a.lon) * Math.cos(meanLat);
    const y = b.lat - a.lat;
    return (Math.atan2(x, y) / DEG + 360) % 360;
  }

  function angleDifference(a, b) {
    const diff = Math.abs(((a - b) % 360 + 540) % 360 - 180);
    return diff;
  }

  function buildNavigationPathIndex(path) {
    const points = [];
    for (const point of path) {
      if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) continue;
      const previous = points[points.length - 1];
      // Step paths share their joining point; drop exact repeats.
      if (previous && previous.lat === point.lat && previous.lon === point.lon) continue;
      points.push({ lat: point.lat, lon: point.lon });
    }
    const cumulative = [];
    let total = 0;
    points.forEach((point, index) => {
      if (index > 0) total += metersBetween(points[index - 1], point);
      cumulative.push(total);
    });
    return { points, cumulative, totalMeters: total };
  }

  /** The point and travel direction a given distance along the path. */
  function navigationPathPointAt(
    index,
    distanceAlongMeters,
  ) {
    const { points, cumulative, totalMeters } = index;
    if (points.length === 0) return null;
    if (points.length === 1) return { ...points[0], bearingDegrees: null };
    const target = Math.max(0, Math.min(totalMeters, distanceAlongMeters));
    let segment = 0;
    while (segment < points.length - 2 && cumulative[segment + 1] < target) segment += 1;
    const start = points[segment];
    const end = points[segment + 1];
    const length = cumulative[segment + 1] - cumulative[segment];
    const t = length > 0 ? (target - cumulative[segment]) / length : 0;
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
  function matchFixToPath(
    index,
    fix,
    previousDistanceAlongMeters = null,
  ) {
    const raw = {
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
    const jumpCost = (along) => {
      if (!hasHistory) return 0;
      const jump = along - previousDistanceAlongMeters;
      // Going backwards is far less likely than a late fix further on.
      const excess = jump < 0 ? -jump - 20 : jump - jumpSlack;
      return Math.max(0, excess) * 0.5;
    };

    const cosLat = Math.cos(fix.lat * DEG);
    const toLocal = (point) => ({
      x: (point.lon - fix.lon) * DEG * cosLat * EARTH_RADIUS_M,
      y: (point.lat - fix.lat) * DEG * EARTH_RADIUS_M,
    });

    let best = null;
    for (let segment = 0; segment < points.length - 1; segment += 1) {
      const a = toLocal(points[segment]);
      const b = toLocal(points[segment + 1]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSq)) : 0;
      const distance = Math.hypot(a.x + dx * t, a.y + dy * t);
      const along = cumulative[segment] + (cumulative[segment + 1] - cumulative[segment]) * t;
      const cost = distance + jumpCost(along);
      if (!best || cost < best.cost) best = { cost, distance, along, segment, t };
    }
    if (!best) return raw;

    const start = points[best.segment];
    const end = points[best.segment + 1];
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
  function predictNavigationPuck(
    index,
    match,
    speedMps,
    secondsAhead,
  ) {
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
  function navigationFixAgeSeconds(fixTimestampMs, nowMs) {
    if (!Number.isFinite(fixTimestampMs)) return 0;
    return Math.max(0, Math.min(PUCK_MAX_PREDICTION_SECONDS, (nowMs - Number(fixTimestampMs)) / 1000));
  }

  /** A fix farther than this from the route (current or next step) is off it. */
  const NAV_OFF_ROUTE_RADIUS_M = 60;
  /** A fix less certain than this can't tell on-route from off-route, so it
   * neither starts nor clears the off-route timer (tunnels, urban canyons). */
  const NAV_OFF_ROUTE_MAX_ACCURACY_M = 50;

  /**
   * Whether a raw fix shows the rider on the route, off it, or can't say.
   * Distances are to the current step's path and to the next step's, since a
   * rider who has already turned at a junction is on the next step.
   */
  function navigationRouteStatus(
    distanceToStepMeters,
    distanceToNextStepMeters,
    accuracyMeters,
  ) {
    if (Number.isFinite(accuracyMeters) && Number(accuracyMeters) > NAV_OFF_ROUTE_MAX_ACCURACY_M) return 'unknown';
    const nearest = distanceToNextStepMeters === null || !Number.isFinite(distanceToNextStepMeters)
      ? distanceToStepMeters
      : Math.min(distanceToStepMeters, distanceToNextStepMeters);
    return nearest > NAV_OFF_ROUTE_RADIUS_M ? 'off' : 'on';
  }

  /** The cone turns in steps this size, so the marker is redrawn only when the
   * change is visible. */
  const PUCK_CONE_STEP_DEGREES = 5;

  /**
   * Which way, clockwise from screen-up, the cone on the navigation puck points:
   * the rider's direction of travel less the map's rotation. The avatar itself
   * stays upright; the cone shows where the rider is heading, as Google and
   * Apple Maps do. Null hides the cone (no trustworthy direction yet).
   */
  function navigationPuckConeDegrees(
    travelHeadingDegrees,
    mapHeadingDegrees,
  ) {
    if (!Number.isFinite(travelHeadingDegrees) || Number(travelHeadingDegrees) < 0) return null;
    const mapHeading = Number.isFinite(mapHeadingDegrees) ? Number(mapHeadingDegrees) : 0;
    const relative = (((Number(travelHeadingDegrees) - mapHeading) % 360) + 360) % 360;
    return (Math.round(relative / PUCK_CONE_STEP_DEGREES) * PUCK_CONE_STEP_DEGREES) % 360;
  }

  /** The navigation puck's drawing box (square, points); the avatar sits in the
   * middle at PUCK_AVATAR_SIZE and the cone around it. */
  const PUCK_BOX_SIZE = 96;
  const PUCK_AVATAR_SIZE = 64;
  /** A soft beam either side of the direction of travel, drawn pointing up from
   * the centre of the box and rotated by navigationPuckConeDegrees. */
  const PUCK_CONE_BEAM_PATH = 'M48 48 L26.7 6.1 A47 47 0 0 1 69.3 6.1 Z';
  /** A solid arrowhead just outside the avatar, readable in sunlight. */
  const PUCK_CONE_ARROW_PATH = 'M48 1.5 L58 15 L48 11 L38 15 Z';
  const PUCK_CONE_COLOR = '#1f8fbf';

  root.RiderNavigationPuck = Object.freeze({
    PUCK_MIN_SNAP_METERS,
    PUCK_MAX_SNAP_METERS,
    PUCK_MAX_HEADING_DIFF_DEGREES,
    PUCK_HEADING_TRUST_SPEED_MPS,
    PUCK_MAX_PREDICTION_SECONDS,
    PUCK_MAX_PREDICTION_METERS,
    buildNavigationPathIndex,
    navigationPathPointAt,
    matchFixToPath,
    predictNavigationPuck,
    navigationFixAgeSeconds,
    NAV_OFF_ROUTE_RADIUS_M,
    NAV_OFF_ROUTE_MAX_ACCURACY_M,
    navigationRouteStatus,
    PUCK_CONE_STEP_DEGREES,
    navigationPuckConeDegrees,
    PUCK_BOX_SIZE,
    PUCK_AVATAR_SIZE,
    PUCK_CONE_BEAM_PATH,
    PUCK_CONE_ARROW_PATH,
    PUCK_CONE_COLOR,
  });
})(typeof window !== 'undefined' ? window : globalThis);
