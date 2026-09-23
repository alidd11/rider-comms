import type { NavigationInstruction } from '@rider-comms/shared';

export interface RouteCoordinate {
  lat: number;
  lon: number;
}

export interface NavigationRouteStep extends NavigationInstruction {
  start: RouteCoordinate;
  end: RouteCoordinate;
  coordinates: RouteCoordinate[];
}

export interface InAppNavigationRoute {
  coordinates: RouteCoordinate[];
  steps: NavigationRouteStep[];
  distanceMeters: number;
  durationSeconds: number;
}

export function metersBetween(a: RouteCoordinate, b: RouteCoordinate): number {
  const radius = 6_371_000;
  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function projectToSegment(
  point: RouteCoordinate,
  segmentStart: RouteCoordinate,
  segmentEnd: RouteCoordinate
): { distanceMeters: number; ratio: number } {
  const metresPerDegreeLat = 111_320;
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos(point.lat * Math.PI / 180);
  const project = (coordinate: RouteCoordinate) => ({
    x: (coordinate.lon - segmentStart.lon) * metresPerDegreeLon,
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

export function distanceToSegmentMeters(
  point: RouteCoordinate,
  segmentStart: RouteCoordinate,
  segmentEnd: RouteCoordinate
): number {
  return projectToSegment(point, segmentStart, segmentEnd).distanceMeters;
}

export function distanceToPathMeters(point: RouteCoordinate, path: readonly RouteCoordinate[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return metersBetween(point, path[0]!);

  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < path.length - 1; index += 1) {
    nearest = Math.min(nearest, projectToSegment(point, path[index]!, path[index + 1]!).distanceMeters);
  }
  return nearest;
}

export function remainingDistanceOnPathMeters(
  point: RouteCoordinate,
  path: readonly RouteCoordinate[]
): number {
  if (path.length === 0) return 0;
  if (path.length === 1) return metersBetween(point, path[0]!);

  let nearestIndex = 0;
  let nearestProjection = projectToSegment(point, path[0]!, path[1]!);
  for (let index = 1; index < path.length - 1; index += 1) {
    const projection = projectToSegment(point, path[index]!, path[index + 1]!);
    if (projection.distanceMeters < nearestProjection.distanceMeters) {
      nearestIndex = index;
      nearestProjection = projection;
    }
  }

  let remaining = metersBetween(path[nearestIndex]!, path[nearestIndex + 1]!) * (1 - nearestProjection.ratio);
  for (let index = nearestIndex + 1; index < path.length - 1; index += 1) {
    remaining += metersBetween(path[index]!, path[index + 1]!);
  }
  return remaining;
}


function interpolateCoordinate(
  start: RouteCoordinate,
  end: RouteCoordinate,
  ratio: number
): RouteCoordinate {
  return {
    lat: start.lat + (end.lat - start.lat) * ratio,
    lon: start.lon + (end.lon - start.lon) * ratio,
  };
}

export function lookAheadCoordinateOnPath(
  point: RouteCoordinate,
  path: readonly RouteCoordinate[],
  lookAheadMeters = 120
): RouteCoordinate {
  if (path.length === 0) return point;
  if (path.length === 1) return path[0]!;

  let nearestIndex = 0;
  let nearestProjection = projectToSegment(point, path[0]!, path[1]!);
  for (let index = 1; index < path.length - 1; index += 1) {
    const projection = projectToSegment(point, path[index]!, path[index + 1]!);
    if (projection.distanceMeters < nearestProjection.distanceMeters) {
      nearestIndex = index;
      nearestProjection = projection;
    }
  }

  let remainingLookAhead = Math.max(0, lookAheadMeters);
  let segmentIndex = nearestIndex;
  let startRatio = nearestProjection.ratio;

  while (segmentIndex < path.length - 1) {
    const start = path[segmentIndex]!;
    const end = path[segmentIndex + 1]!;
    const segmentLength = metersBetween(start, end);
    const available = segmentLength * (1 - startRatio);
    if (segmentLength <= 0) {
      segmentIndex += 1;
      startRatio = 0;
      continue;
    }
    if (remainingLookAhead <= available) {
      const ratio = startRatio + remainingLookAhead / segmentLength;
      return interpolateCoordinate(start, end, Math.max(0, Math.min(1, ratio)));
    }
    remainingLookAhead -= available;
    segmentIndex += 1;
    startRatio = 0;
  }

  return path[path.length - 1]!;
}
