(() => {
  'use strict';

  const NAVIGATION_ALERT_ROUTE_CORRIDOR_METERS = 70;
  const NAVIGATION_ALERT_LOOKAHEAD_METERS = 3_000;
  const NAVIGATION_ALERT_PASSED_GRACE_METERS = 25;
  const NAVIGATION_ALERT_CURRENT_ROUTE_TOLERANCE_METERS = 120;
  const NAVIGATION_ALERT_MAX_VISIBLE = 2;
  const NAVIGATION_ALERT_MAX_LOCATION_ACCURACY_METERS = 75;
  const HIDE_NET_DENIAL_THRESHOLD = 3;
  const HAZARD_TYPES = new Set(['police', 'accident', 'hazard', 'road_closure', 'camera']);
  const SAFETY_IMPACTING_TYPES = new Set(['road_closure', 'accident', 'hazard']);

  const HAZARD_TIE_BREAK_PRIORITY = {
    road_closure: 0,
    accident: 1,
    camera: 2,
    police: 3,
    hazard: 4,
  };

  function finiteCoordinate(point) {
    return Boolean(
      point
      && Number.isFinite(point.lat)
      && Number.isFinite(point.lng)
      && point.lat >= -90
      && point.lat <= 90
      && point.lng >= -180
      && point.lng <= 180
    );
  }

  function activeHazardReport(hazard, nowMs) {
    return Boolean(
      hazard
      && HAZARD_TYPES.has(hazard.type)
      && Number.isFinite(hazard.expiresAt)
      && hazard.expiresAt > nowMs
      && Number.isFinite(hazard.confirmations)
      && Number.isFinite(hazard.denials)
      && hazard.denials - hazard.confirmations < HIDE_NET_DENIAL_THRESHOLD
    );
  }

  function metersBetween(a, b) {
    const radius = 6_371_000;
    const toRad = (degrees) => degrees * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function projectToSegment(point, segmentStart, segmentEnd) {
    const metresPerDegreeLat = 111_320;
    const metresPerDegreeLng = metresPerDegreeLat * Math.cos(point.lat * Math.PI / 180);
    const project = (coordinate) => ({
      x: (coordinate.lng - segmentStart.lng) * metresPerDegreeLng,
      y: (coordinate.lat - segmentStart.lat) * metresPerDegreeLat,
    });
    const p = project(point);
    const b = project(segmentEnd);
    const lengthSquared = b.x * b.x + b.y * b.y;
    const ratio = lengthSquared > 0
      ? Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / lengthSquared))
      : 0;

    return {
      distanceMeters: Math.hypot(p.x - ratio * b.x, p.y - ratio * b.y),
      ratio,
    };
  }

  function distanceToPathMeters(point, path) {
    if (!Array.isArray(path) || path.length === 0) return Number.POSITIVE_INFINITY;
    if (path.length === 1) return metersBetween(point, path[0]);

    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < path.length - 1; index += 1) {
      nearest = Math.min(
        nearest,
        projectToSegment(point, path[index], path[index + 1]).distanceMeters,
      );
    }
    return nearest;
  }

  function remainingDistanceOnPathMeters(point, path) {
    if (!Array.isArray(path) || path.length === 0) return 0;
    if (path.length === 1) return metersBetween(point, path[0]);

    let nearestIndex = 0;
    let nearestProjection = projectToSegment(point, path[0], path[1]);
    for (let index = 1; index < path.length - 1; index += 1) {
      const projection = projectToSegment(point, path[index], path[index + 1]);
      if (projection.distanceMeters < nearestProjection.distanceMeters) {
        nearestIndex = index;
        nearestProjection = projection;
      }
    }

    let remaining = metersBetween(path[nearestIndex], path[nearestIndex + 1]) * (1 - nearestProjection.ratio);
    for (let index = nearestIndex + 1; index < path.length - 1; index += 1) {
      remaining += metersBetween(path[index], path[index + 1]);
    }
    return remaining;
  }

  function selectVisibleAlerts(sortedAlerts, maxVisible) {
    if (sortedAlerts.length <= maxVisible) return sortedAlerts;
    const nearest = sortedAlerts[0];
    const selected = [nearest];

    if (maxVisible > 1 && !SAFETY_IMPACTING_TYPES.has(nearest.hazard.type)) {
      const safetyAlert = sortedAlerts.slice(1).find((alert) => SAFETY_IMPACTING_TYPES.has(alert.hazard.type));
      if (safetyAlert) selected.push(safetyAlert);
    }

    for (const alert of sortedAlerts) {
      if (selected.length >= maxVisible) break;
      if (!selected.includes(alert)) selected.push(alert);
    }

    return selected.sort((a, b) => a.distanceAheadMeters - b.distanceAheadMeters);
  }

  function navigationHazardsAhead(currentLocation, routeCoordinates, hazards, options = {}) {
    if (!finiteCoordinate(currentLocation)
      || !Array.isArray(routeCoordinates)
      || routeCoordinates.length < 2
      || !Array.isArray(hazards)
      || hazards.length === 0) {
      return [];
    }

    const routeCorridorMeters = Math.max(1, options.routeCorridorMeters ?? NAVIGATION_ALERT_ROUTE_CORRIDOR_METERS);
    const lookAheadMeters = Math.max(0, options.lookAheadMeters ?? NAVIGATION_ALERT_LOOKAHEAD_METERS);
    const passedGraceMeters = Math.max(0, options.passedGraceMeters ?? NAVIGATION_ALERT_PASSED_GRACE_METERS);
    const currentRouteToleranceMeters = Math.max(
      routeCorridorMeters,
      options.currentRouteToleranceMeters ?? NAVIGATION_ALERT_CURRENT_ROUTE_TOLERANCE_METERS,
    );
    const maxVisible = Math.max(0, Math.floor(options.maxVisible ?? NAVIGATION_ALERT_MAX_VISIBLE));
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const currentAccuracyMeters = options.currentAccuracyMeters;
    if (
      maxVisible === 0
      || typeof currentAccuracyMeters !== 'number'
      || !Number.isFinite(currentAccuracyMeters)
      || currentAccuracyMeters < 0
      || currentAccuracyMeters > NAVIGATION_ALERT_MAX_LOCATION_ACCURACY_METERS
    ) return [];

    const currentDistanceFromRoute = distanceToPathMeters(currentLocation, routeCoordinates);
    if (!Number.isFinite(currentDistanceFromRoute) || currentDistanceFromRoute > currentRouteToleranceMeters) return [];

    const riderRemainingMeters = remainingDistanceOnPathMeters(currentLocation, routeCoordinates);
    if (!Number.isFinite(riderRemainingMeters)) return [];

    const eligibleAlerts = hazards
      .map((hazard) => {
        if (!activeHazardReport(hazard, nowMs)) return null;
        const point = { lat: hazard.lat, lng: hazard.lon };
        if (!finiteCoordinate(point)) return null;

        const distanceFromRouteMeters = distanceToPathMeters(point, routeCoordinates);
        if (!Number.isFinite(distanceFromRouteMeters) || distanceFromRouteMeters > routeCorridorMeters) return null;

        const hazardRemainingMeters = remainingDistanceOnPathMeters(point, routeCoordinates);
        if (!Number.isFinite(hazardRemainingMeters)) return null;

        const rawDistanceAheadMeters = riderRemainingMeters - hazardRemainingMeters;
        if (rawDistanceAheadMeters < -passedGraceMeters || rawDistanceAheadMeters > lookAheadMeters) return null;

        return {
          hazard,
          distanceAheadMeters: Math.max(0, rawDistanceAheadMeters),
          distanceFromRouteMeters,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const distanceDelta = a.distanceAheadMeters - b.distanceAheadMeters;
        if (Math.abs(distanceDelta) > 1) return distanceDelta;
        return (HAZARD_TIE_BREAK_PRIORITY[a.hazard.type] ?? 99)
          - (HAZARD_TIE_BREAK_PRIORITY[b.hazard.type] ?? 99);
      });

    return selectVisibleAlerts(eligibleAlerts, maxVisible);
  }

  function navigationHazardLabel(type) {
    switch (type) {
      case 'camera': return 'Speed camera reported';
      case 'police': return 'Police reported';
      case 'accident': return 'Accident reported';
      case 'road_closure': return 'Road closure reported';
      case 'hazard': return 'Road hazard reported';
      default: return 'Road alert';
    }
  }

  globalThis.RiderNavigationRoadEvents = Object.freeze({
    NAVIGATION_ALERT_ROUTE_CORRIDOR_METERS,
    NAVIGATION_ALERT_LOOKAHEAD_METERS,
    NAVIGATION_ALERT_PASSED_GRACE_METERS,
    NAVIGATION_ALERT_CURRENT_ROUTE_TOLERANCE_METERS,
    NAVIGATION_ALERT_MAX_VISIBLE,
    NAVIGATION_ALERT_MAX_LOCATION_ACCURACY_METERS,
    HIDE_NET_DENIAL_THRESHOLD,
    navigationHazardLabel,
    navigationHazardsAhead,
  });
})();
