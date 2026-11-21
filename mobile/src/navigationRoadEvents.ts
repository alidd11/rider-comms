import { HIDE_NET_DENIAL_THRESHOLD } from '@rider-comms/shared';
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
export const NAVIGATION_ALERT_MAX_LOCATION_ACCURACY_METERS = 75;
export const NAVIGATION_ALERT_DUPLICATE_ROUTE_GAP_METERS = 80;

const HAZARD_TYPES = new Set<HazardType>(['police', 'accident', 'road_closure', 'camera', 'hidden_police', 'police_checkpoint']);
const SAFETY_IMPACTING_TYPES = new Set<HazardType>(['road_closure', 'accident']);

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
  nowMs?: number;
  currentAccuracyMeters?: number | null;
  duplicateRouteGapMeters?: number;
}

const HAZARD_TIE_BREAK_PRIORITY: Record<HazardType, number> = {
  road_closure: 0,
  accident: 1,
  camera: 2,
  police: 3,
  police_checkpoint: 4,
  hidden_police: 5,
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

function activeHazardReport(hazard: HazardReport, nowMs: number): boolean {
  return HAZARD_TYPES.has(hazard.type)
    && Number.isFinite(hazard.expiresAt)
    && hazard.expiresAt > nowMs
    && Number.isFinite(hazard.confirmations)
    && Number.isFinite(hazard.denials)
    && hazard.denials - hazard.confirmations < HIDE_NET_DENIAL_THRESHOLD;
}

function dedupeNearbyAlerts(
  sortedAlerts: NavigationRouteHazard[],
  duplicateRouteGapMeters: number,
): NavigationRouteHazard[] {
  const deduped: NavigationRouteHazard[] = [];
  for (const alert of sortedAlerts) {
    const duplicate = deduped.some((existing) =>
      existing.hazard.type === alert.hazard.type
      && Math.abs(existing.distanceAheadMeters - alert.distanceAheadMeters) <= duplicateRouteGapMeters
    );
    if (!duplicate) deduped.push(alert);
  }
  return deduped;
}

function selectVisibleAlerts(
  sortedAlerts: NavigationRouteHazard[],
  maxVisible: number,
): NavigationRouteHazard[] {
  if (sortedAlerts.length <= maxVisible) return sortedAlerts;
  const nearest = sortedAlerts[0]!;
  const selected = [nearest];

  // Keep the nearest report as the primary glance target. If that report is
  // informational (camera/police), reserve one remaining slot for the nearest
  // safety-impacting condition so a closure/accident is not hidden by
  // two enforcement reports farther down the same route.
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
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const currentAccuracyMeters = options.currentAccuracyMeters;
  const duplicateRouteGapMeters = Math.max(0, options.duplicateRouteGapMeters ?? NAVIGATION_ALERT_DUPLICATE_ROUTE_GAP_METERS);
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
    .map((hazard): NavigationRouteHazard | null => {
      if (!activeHazardReport(hazard, nowMs)) return null;
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
    });

  return selectVisibleAlerts(dedupeNearbyAlerts(eligibleAlerts, duplicateRouteGapMeters), maxVisible);
}

/**
 * Every hazard riders have reported along a whole route, from its start, for
 * choosing a way before Start (PWA: routeHazards in navigation-road-events.js).
 * The same corridor, freshness and crowd-hiding rules as the alerts ahead.
 */
export function routeHazards(
  routeCoordinates: readonly RouteCoordinate[],
  hazards: readonly HazardReport[],
  options: { nowMs?: number } = {},
): NavigationRouteHazard[] {
  const start = routeCoordinates[0];
  if (!start) return [];
  return navigationHazardsAhead(start, routeCoordinates, hazards, {
    nowMs: options.nowMs,
    currentAccuracyMeters: 0,
    lookAheadMeters: Number.MAX_SAFE_INTEGER,
    passedGraceMeters: 0,
    maxVisible: Number.MAX_SAFE_INTEGER,
  });
}

/** What each report is called when read out: one, then several. */
const ROUTE_HAZARD_NAMES: Record<HazardType, [string, string]> = {
  road_closure: ['road closure', 'road closures'],
  accident: ['accident', 'accidents'],
  camera: ['speed camera', 'speed cameras'],
  police: ['police', 'police reports'],
  hidden_police: ['hidden police', 'hidden police reports'],
  police_checkpoint: ['police check', 'police checks'],
};

export interface RouteHazardGroup { type: HazardType; count: number; serious: boolean }

/**
 * What riders reported on a way, for icons as in Waze and TomTom: one group
 * per kind with how many, most serious first. `label` reads the same for a
 * screen reader ("Reported on the way: road closure, 2 speed cameras");
 * `serious` when a closure or accident is among them. Null when none.
 */
export function routeHazardsSummary(list: readonly NavigationRouteHazard[]): { groups: RouteHazardGroup[]; label: string; serious: boolean } | null {
  if (!list.length) return null;
  const counts = new Map<HazardType, number>();
  list.forEach(({ hazard }) => counts.set(hazard.type, (counts.get(hazard.type) ?? 0) + 1));
  const groups = [...counts]
    .sort(([a], [b]) => HAZARD_TIE_BREAK_PRIORITY[a] - HAZARD_TIE_BREAK_PRIORITY[b])
    .map(([type, count]) => ({ type, count, serious: SAFETY_IMPACTING_TYPES.has(type) }));
  const names = groups.map(({ type, count }) => (count > 1 ? `${count} ${ROUTE_HAZARD_NAMES[type][1]}` : ROUTE_HAZARD_NAMES[type][0]));
  return {
    groups,
    label: `Reported on the way: ${names.join(', ')}`,
    serious: groups.some((group) => group.serious),
  };
}

export interface RouteHazardMarker {
  /** How far along the way, 0 (start) to 1 (destination). */
  at: number;
  /** The most serious kind here: the icon shown. */
  type: HazardType;
  /** Reports at this point (several close together share one icon). */
  count: number;
  serious: boolean;
}

/** Reports nearer than this share of the line share one icon. */
export const ROUTE_HAZARD_STRIP_GAP = 0.1;

/**
 * The reports on a way as points along a straight line from start to
 * destination, as in Waze's trip overview: where each is, with reports close
 * together merged into one icon (the most serious kind) with a count.
 */
export function routeHazardStrip(
  list: readonly NavigationRouteHazard[],
  routeCoordinates: readonly RouteCoordinate[],
  gap: number = ROUTE_HAZARD_STRIP_GAP,
): RouteHazardMarker[] {
  // Measured along the same line the reports were placed on.
  const routeMeters = routeCoordinates[0] ? remainingDistanceOnPathMeters(routeCoordinates[0], routeCoordinates) : 0;
  if (!list.length || !Number.isFinite(routeMeters) || routeMeters <= 0) return [];
  const points = list
    .map(({ hazard, distanceAheadMeters }) => ({ type: hazard.type, at: Math.min(1, Math.max(0, distanceAheadMeters / routeMeters)) }))
    .sort((a, b) => a.at - b.at);
  const markers: Array<RouteHazardMarker & { first: number; total: number }> = [];
  for (const point of points) {
    const last = markers[markers.length - 1];
    if (last && point.at - last.first <= gap) {
      last.count += 1;
      last.total += point.at;
      last.at = last.total / last.count;
      if (HAZARD_TIE_BREAK_PRIORITY[point.type] < HAZARD_TIE_BREAK_PRIORITY[last.type]) last.type = point.type;
      last.serious = last.serious || SAFETY_IMPACTING_TYPES.has(point.type);
    } else {
      markers.push({ at: point.at, first: point.at, total: point.at, type: point.type, count: 1, serious: SAFETY_IMPACTING_TYPES.has(point.type) });
    }
  }
  return markers.map(({ at, type, count, serious }) => ({ at, type, count, serious }));
}


/** The most points a route line may have when sent to the server. */
export const ROUTE_PATH_MAX_POINTS = 400;

/**
 * A route's line cut down to at most `maxPoints` for sending to the server
 * (POST /hazards/along-route), keeping its shape: Douglas-Peucker, starting
 * at 10 m and loosening only as far as the limit needs, so a bendy road
 * isn't straightened beyond the server's 100 m corridor.
 */
export function simplifyRoutePath(points: readonly RouteCoordinate[], maxPoints: number = ROUTE_PATH_MAX_POINTS): RouteCoordinate[] {
  const valid = points.filter(finiteCoordinate);
  if (valid.length <= maxPoints) return valid;
  const origin = valid[0]!;
  const xScale = 111_320 * Math.cos(origin.lat * Math.PI / 180);
  const xy = valid.map((p) => ({ x: (p.lon - origin.lon) * xScale, y: (p.lat - origin.lat) * 111_320 }));
  const offset = (i: number, a: number, b: number): number => {
    const dx = xy[b]!.x - xy[a]!.x;
    const dy = xy[b]!.y - xy[a]!.y;
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((xy[i]!.x - xy[a]!.x) * dx + (xy[i]!.y - xy[a]!.y) * dy) / length)) : 0;
    return Math.hypot(xy[i]!.x - xy[a]!.x - t * dx, xy[i]!.y - xy[a]!.y - t * dy);
  };
  for (let tolerance = 10; ; tolerance *= 1.5) {
    const keep = new Uint8Array(valid.length);
    keep[0] = 1;
    keep[valid.length - 1] = 1;
    const stack: Array<[number, number]> = [[0, valid.length - 1]];
    let kept = 2;
    while (stack.length && kept <= maxPoints) {
      const [a, b] = stack.pop()!;
      let worst = -1;
      let at = -1;
      for (let i = a + 1; i < b; i += 1) {
        const d = offset(i, a, b);
        if (d > worst) { worst = d; at = i; }
      }
      if (at >= 0 && worst > tolerance) {
        keep[at] = 1;
        kept += 1;
        stack.push([a, at], [at, b]);
      }
    }
    if (kept <= maxPoints) return valid.filter((_, i) => keep[i]);
  }
}

export function navigationHazardLabel(type: HazardType): string {
  switch (type) {
    case 'camera': return 'Mobile speed camera reported';
    case 'police': return 'Police reported';
    case 'hidden_police': return 'Hidden police reported';
    case 'police_checkpoint': return 'Police checkpoint reported';
    case 'accident': return 'Accident reported';
    case 'road_closure': return 'Road closure reported';
  }
}
