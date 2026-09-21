import type { HazardReport, HazardType } from '@rider-comms/shared';
import {
  distanceToPathMeters,
  remainingDistanceOnPathMeters,
  type RouteCoordinate,
} from './api/directions.ts';

export const NAVIGATION_ALERT_ROUTE_CORRIDOR_METERS = 70;
export const NAVIGATION_ALERT_LOOKAHEAD_METERS = 3_000;
export const NAVIGATION_ALERT_PASSED_GRACE_METERS = 25;
export const NAVIGATION_ALERT_CURRENT_ROUTE_TOLERANCE_METERS = 120;
export const NAVIGATION_ALERT_MAX_VISIBLE = 2;

export interface NavigationRouteHazard {
  hazard: HazardReport;
  distanceAheadMeters: number;
  distanceFromRouteMeters: number;
}

export interface NavigationRouteHazardOptions {
  routeCorridorMeters?: number;
  lookAheadMeters?: number;
  passedGraceMeters?: number;
  currentRouteToleranceMeters?: number;
  maxVisible?: number;
}

const HAZARD_TIE_BREAK_PRIORITY: Record<HazardType, number> = {
  road_closure: 0,
  accident: 1,
  camera: 2,
  police: 3,
  hazard: 4,
};

function finiteCoordinate(point: RouteCoordinate | null | undefined): point is RouteCoordinate {
  return Boolean(
    point
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lon)
    && point.lat >= -90
    && point.lat <= 90
    && point.lon >= -180
    && point.lon <= 180
  );
}

/**
 * Returns only crowdsourced hazards that are actually on the active route and
 * still ahead of the rider. This deliberately works from Rider Comms' own
 * hazard feed, so PWA/native can share the same product behaviour without
 * pretending Google Directions exposes incident/camera data that it does not.
 *
 * The distance ahead is derived from remaining path distance rather than
 * straight-line distance. That matters on bends, loops and parallel roads:
 * alerts follow route progress instead of "as the crow flies".
 */
export function navigationHazardsAhead(
  currentLocation: RouteCoordinate | null | undefined,
  routeCoordinates: readonly RouteCoordinate[],
  hazards: readonly HazardReport[],
  options: NavigationRouteHazardOptions = {},
): NavigationRouteHazard[] {
  if (!finiteCoordinate(currentLocation) || routeCoordinates.length < 2 || hazards.length === 0) return [];

  const routeCorridorMeters = Math.max(1, options.routeCorridorMeters ?? NAVIGATION_ALERT_ROUTE_CORRIDOR_METERS);
  const lookAheadMeters = Math.max(0, options.lookAheadMeters ?? NAVIGATION_ALERT_LOOKAHEAD_METERS);
  const passedGraceMeters = Math.max(0, options.passedGraceMeters ?? NAVIGATION_ALERT_PASSED_GRACE_METERS);
  const currentRouteToleranceMeters = Math.max(
    routeCorridorMeters,
    options.currentRouteToleranceMeters ?? NAVIGATION_ALERT_CURRENT_ROUTE_TOLERANCE_METERS,
  );
  const maxVisible = Math.max(0, Math.floor(options.maxVisible ?? NAVIGATION_ALERT_MAX_VISIBLE));
  if (maxVisible === 0) return [];

  const currentDistanceFromRoute = distanceToPathMeters(currentLocation, routeCoordinates);
  if (!Number.isFinite(currentDistanceFromRoute) || currentDistanceFromRoute > currentRouteToleranceMeters) return [];

  const riderRemainingMeters = remainingDistanceOnPathMeters(currentLocation, routeCoordinates);
  if (!Number.isFinite(riderRemainingMeters)) return [];

  return hazards
    .map((hazard): NavigationRouteHazard | null => {
      const point = { lat: hazard.lat, lon: hazard.lon };
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
    .filter((value): value is NavigationRouteHazard => value !== null)
    .sort((a, b) => {
      const distanceDelta = a.distanceAheadMeters - b.distanceAheadMeters;
      if (Math.abs(distanceDelta) > 1) return distanceDelta;
      return HAZARD_TIE_BREAK_PRIORITY[a.hazard.type] - HAZARD_TIE_BREAK_PRIORITY[b.hazard.type];
    })
    .slice(0, maxVisible);
}

export function navigationHazardLabel(type: HazardType): string {
  switch (type) {
    case 'camera': return 'Speed camera reported';
    case 'police': return 'Police reported';
    case 'accident': return 'Accident reported';
    case 'road_closure': return 'Road closure reported';
    case 'hazard': return 'Road hazard reported';
  }
}
