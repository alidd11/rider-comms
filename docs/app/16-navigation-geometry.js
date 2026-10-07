// Part of docs/app.js. 16 of 20: Navigation camera and route geometry. Edit here, then run `npm run build:pwa-app`.
  /** Plain equirectangular-projection distance — accurate enough over the
   * short (metres-to-low-kilometres) spans between a rider's real position
   * and a route step's endpoints/segment; no need for full geodesic math
   * at this scale, and no extra Maps `geometry` library to load for it. */
  function bearingDegrees(from, to) {
    const toRad = (value) => (value * Math.PI) / 180;
    const toDeg = (value) => (value * 180) / Math.PI;
    const lat1 = toRad(from.lat);
    const lat2 = toRad(to.lat);
    const deltaLon = toRad(to.lng - from.lng);
    const y = Math.sin(deltaLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // The camera maths is shared with the native app through
  // navigation-camera.js (a port of shared/src/navigationCamera.ts).
  const navigationCamera = globalThis.RiderNavigationCamera;

  /** How much of the map the navigation banner and the bottom stack cover. */
  function navigationViewportOcclusion() {
    const mapElement = $('#googleMap');
    if (!mapElement) return null;
    const mapRect = mapElement.getBoundingClientRect();
    if (mapRect.height <= 0) return null;
    const visibleRect = (element) => (element && !element.hidden ? element.getBoundingClientRect() : null);
    const bannerRect = visibleRect($('#navBanner'));
    // The mute/overview dock floats above the summary at the right edge.
    // The rider is centred left-to-right, so the dock never covers them and
    // only the summary's top edge bounds the clear map.
    const summaryRect = visibleRect($('#navSummary'));
    return {
      width: mapRect.width,
      height: mapRect.height,
      top: bannerRect ? Math.max(0, bannerRect.bottom - mapRect.top) : 0,
      bottom: summaryRect?.height ? Math.max(0, mapRect.bottom - summaryRect.top) : 0,
    };
  }

  function combineNavigationCameraPaths(...paths) {
    const combined = [];
    paths.forEach((path) => {
      if (!Array.isArray(path)) return;
      path.forEach((coordinate) => {
        const previous = combined[combined.length - 1];
        if (
          previous
          && Math.abs(previous.lat - coordinate.lat) < 1e-7
          && Math.abs(previous.lng - coordinate.lng) < 1e-7
        ) return;
        combined.push(coordinate);
      });
    });
    return combined;
  }

  function metersBetween(a, b) {
    const R = 6_371_000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Local short-span projection used for route matching. Returning the
   * projection ratio as well as the cross-track distance lets navigation
   * calculate remaining distance along a curved step instead of measuring a
   * straight line to the next junction. */
  function projectToSegment(point, segStart, segEnd) {
    const metersPerDegLat = 111_320;
    const metersPerDegLng = 111_320 * Math.cos((point.lat * Math.PI) / 180);
    const toXY = (p) => ({ x: (p.lng - segStart.lng) * metersPerDegLng, y: (p.lat - segStart.lat) * metersPerDegLat });
    const p = toXY(point);
    const b = toXY(segEnd);
    const lengthSq = b.x * b.x + b.y * b.y;
    const ratio = lengthSq > 0 ? Math.max(0, Math.min(1, (p.x * b.x + p.y * b.y) / lengthSq)) : 0;
    const closest = { x: ratio * b.x, y: ratio * b.y };
    return { distanceMeters: Math.hypot(p.x - closest.x, p.y - closest.y), ratio };
  }

  function navigationStepPath(step) {
    const rawPath = Array.isArray(step?.path)
      ? step.path
      : typeof step?.path?.getArray === 'function'
        ? step.path.getArray()
        : [];
    const coordinates = rawPath.map((point) => ({
      lat: typeof point?.lat === 'function' ? point.lat() : point?.lat,
      lng: typeof point?.lng === 'function' ? point.lng() : point?.lng,
    })).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (coordinates.length >= 2) return coordinates;
    return [
      { lat: step.start_location.lat(), lng: step.start_location.lng() },
      { lat: step.end_location.lat(), lng: step.end_location.lng() },
    ];
  }

  function distanceToPathMeters(point, path) {
    if (!path.length) return Number.POSITIVE_INFINITY;
    if (path.length === 1) return metersBetween(point, path[0]);
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < path.length - 1; index += 1) {
      nearest = Math.min(nearest, projectToSegment(point, path[index], path[index + 1]).distanceMeters);
    }
    return nearest;
  }

  function remainingDistanceOnPathMeters(point, path) {
    if (!path.length) return 0;
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


  function lookAheadCoordinateOnPath(point, path, lookAheadMeters = 120) {
    if (!path.length) return point;
    if (path.length === 1) return path[0];

    let nearestIndex = 0;
    let nearestProjection = projectToSegment(point, path[0], path[1]);
    for (let index = 1; index < path.length - 1; index += 1) {
      const projection = projectToSegment(point, path[index], path[index + 1]);
      if (projection.distanceMeters < nearestProjection.distanceMeters) {
        nearestIndex = index;
        nearestProjection = projection;
      }
    }

    let remainingLookAhead = Math.max(0, lookAheadMeters);
    let segmentIndex = nearestIndex;
    let startRatio = nearestProjection.ratio;

    while (segmentIndex < path.length - 1) {
      const start = path[segmentIndex];
      const end = path[segmentIndex + 1];
      const segmentLength = metersBetween(start, end);
      const available = segmentLength * (1 - startRatio);
      if (segmentLength <= 0) {
        segmentIndex += 1;
        startRatio = 0;
        continue;
      }
      if (remainingLookAhead <= available) {
        const ratio = Math.max(0, Math.min(1, startRatio + remainingLookAhead / segmentLength));
        return {
          lat: start.lat + (end.lat - start.lat) * ratio,
          lng: start.lng + (end.lng - start.lng) * ratio,
        };
      }
      remainingLookAhead -= available;
      segmentIndex += 1;
      startRatio = 0;
    }

    return path[path.length - 1];
  }

  const NAVIGATION_HTML_ENTITIES = Object.freeze({
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  });

