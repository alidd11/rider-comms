(function (root) {
  'use strict';

  // Browser port of shared/src/navigationCamera.ts. The PWA intentionally
  // ships as plain static files, so scripts/check-navigation-camera.mjs runs
  // shared golden fixtures against both implementations to prevent drift.
  // combineNavigationCameraPaths stays in app.js: it operates on this
  // client's {lat, lng} Google Maps coordinate shape, which native's
  // {lat, lon} route-coordinate shape does not share.
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isTurnManeuver(maneuver) {
    return Boolean(maneuver && /turn|ramp|keep/.test(maneuver));
  }

  function isComplexManeuver(maneuver) {
    return Boolean(maneuver && (
      maneuver.includes('roundabout')
      || maneuver.includes('uturn')
      || maneuver.includes('fork')
    ));
  }

  function navigationCameraProfile({
    speedMps,
    maneuverDistanceMeters,
    maneuver,
  }) {
    const speed = Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : 8;

    let profile;
    if (speed <= 1.5) profile = { zoom: 18.8, pitch: 52, lookAheadMeters: 90 };
    else if (speed < 7) profile = { zoom: 18.7, pitch: 58, lookAheadMeters: 120 };
    else if (speed < 14) profile = { zoom: 18.4, pitch: 60, lookAheadMeters: 165 };
    else if (speed < 22) profile = { zoom: 18.0, pitch: 58, lookAheadMeters: 230 };
    else profile = { zoom: 17.6, pitch: 54, lookAheadMeters: 310 };

    const maneuverDistance = Number.isFinite(maneuverDistanceMeters)
      ? Math.max(0, Number(maneuverDistanceMeters))
      : Number.POSITIVE_INFINITY;

    if (isComplexManeuver(maneuver) && maneuverDistance <= 260) {
      profile = {
        zoom: Math.min(profile.zoom, 18.0),
        pitch: Math.min(profile.pitch, 50),
        lookAheadMeters: Math.max(profile.lookAheadMeters, 220),
      };
    } else if (maneuverDistance <= 180 && isTurnManeuver(maneuver)) {
      const proximity = clamp((180 - maneuverDistance) / 160, 0, 1);
      profile = {
        zoom: Math.min(18.9, profile.zoom + 0.35 * proximity),
        pitch: Math.max(52, profile.pitch - 5 * proximity),
        lookAheadMeters: Math.max(140, profile.lookAheadMeters * (1 - 0.2 * proximity)),
      };
    }

    return profile;
  }

  const RIDER_POSITION_IN_VISIBLE_MAP = 0.7;
  const CAMERA_DISTANCE_IN_VIEWPORT_HEIGHTS = 1.5;
  const METRES_PER_POINT_AT_ZOOM_0 = 156543.03392;

  function navigationRiderScreenOffset(viewportHeight, topOcclusion, bottomOcclusion) {
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
    const top = clamp(Number.isFinite(topOcclusion) ? topOcclusion : 0, 0, viewportHeight);
    const bottom = clamp(Number.isFinite(bottomOcclusion) ? bottomOcclusion : 0, 0, viewportHeight);
    let visibleTop = top;
    let visibleBottom = viewportHeight - bottom;
    if (visibleBottom - visibleTop < viewportHeight * 0.2) {
      visibleTop = 0;
      visibleBottom = viewportHeight;
    }
    const riderY = visibleTop + (visibleBottom - visibleTop) * RIDER_POSITION_IN_VISIBLE_MAP;
    return riderY - viewportHeight / 2;
  }

  function navigationMetresPerPoint(zoom, latitude) {
    const lat = Number.isFinite(latitude) ? clamp(latitude, -85, 85) : 0;
    return (METRES_PER_POINT_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  }

  function navigationCentreAheadMeters({
    viewportHeight,
    topOcclusion,
    bottomOcclusion,
    zoom,
    pitch,
    latitude,
  }) {
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0 || !Number.isFinite(zoom)) return 0;
    const screenOffset = navigationRiderScreenOffset(viewportHeight, topOcclusion, bottomOcclusion);

    const tilt = (clamp(Number.isFinite(pitch) ? pitch : 0, 0, 75) * Math.PI) / 180;
    const cameraDistance = viewportHeight * CAMERA_DISTANCE_IN_VIEWPORT_HEIGHTS;
    const denominator = Math.max(
      cameraDistance * 0.25,
      cameraDistance * Math.cos(tilt) + screenOffset * Math.sin(tilt),
    );
    const groundOffset = (screenOffset * cameraDistance) / denominator;
    return groundOffset * navigationMetresPerPoint(zoom, latitude);
  }

  function nextNavigationCameraCorrection(current, sample) {
    const base = Number.isFinite(current) && current > 0 ? current : 1;
    const { targetOffset, measuredOffset, flatOffset, pitch } = sample;
    if (![targetOffset, measuredOffset, flatOffset, pitch].every(Number.isFinite)) return base;
    if (Math.abs(targetOffset) < 20 || Math.abs(measuredOffset) < 20) return base;
    if (Math.sign(targetOffset) !== Math.sign(measuredOffset)) return base;
    if (pitch > 20 && Math.abs(measuredOffset - flatOffset) <= Math.abs(flatOffset) * 0.03) return base;
    const ratio = clamp(targetOffset / measuredOffset, 0.5, 2);
    return clamp(base * (1 + (ratio - 1) * 0.5), 0.6, 1.8);
  }

  function offsetAlongHeading(lat, lng, headingDegrees, meters) {
    const heading = (headingDegrees * Math.PI) / 180;
    const metresPerDegreeLat = 111320;
    const metresPerDegreeLng = 111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180));
    return {
      lat: lat + (meters * Math.cos(heading)) / metresPerDegreeLat,
      lng: lng + (meters * Math.sin(heading)) / metresPerDegreeLng,
    };
  }

  function normaliseHeading(value) {
    return ((value % 360) + 360) % 360;
  }

  function stabilizeNavigationHeading(previousHeading, candidateHeading, speedMps) {
    const candidate = normaliseHeading(candidateHeading);
    if (!Number.isFinite(previousHeading)) return candidate;
    const previous = normaliseHeading(Number(previousHeading));
    const speed = Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : 8;
    if (speed <= 1.5) return previous;
    const delta = ((candidate - previous + 540) % 360) - 180;
    const alpha = speed < 5 ? 0.22 : speed < 12 ? 0.34 : speed < 22 ? 0.46 : 0.56;
    return normaliseHeading(previous + delta * alpha);
  }

  root.RiderNavigationCamera = Object.freeze({
    navigationCameraProfile,
    navigationCentreAheadMeters,
    navigationMetresPerPoint,
    navigationRiderScreenOffset,
    nextNavigationCameraCorrection,
    offsetAlongHeading,
    stabilizeNavigationHeading,
  });
})(typeof window === 'undefined' ? globalThis : window);
