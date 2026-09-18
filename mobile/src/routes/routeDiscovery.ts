import { haversineMiles } from '@rider-comms/shared';
import type { CuratedRoute } from './curatedRoutes.ts';

export type RideWindow = 'all' | 'quick' | 'half_day' | 'day_trip';

export const RIDE_WINDOWS: ReadonlyArray<{ value: RideWindow; label: string }> = [
  { value: 'all', label: 'All rides' },
  { value: 'quick', label: 'Under 90 min' },
  { value: 'half_day', label: '90 min–3 hr' },
  { value: 'day_trip', label: '3+ hr' },
];

export interface RiderCoordinate {
  lat: number;
  lon: number;
}

export function routeMatchesRideWindow(route: CuratedRoute, window: RideWindow): boolean {
  if (window === 'quick') return route.estimatedDurationMinutes < 90;
  if (window === 'half_day') return route.estimatedDurationMinutes >= 90 && route.estimatedDurationMinutes <= 180;
  if (window === 'day_trip') return route.estimatedDurationMinutes > 180;
  return true;
}

export function distanceMilesToRouteStart(route: CuratedRoute, rider: RiderCoordinate): number {
  return haversineMiles(rider, route.start);
}

export function sortRoutesForDiscovery(
  routes: readonly CuratedRoute[],
  window: RideWindow,
  rider: RiderCoordinate | null
): CuratedRoute[] {
  const filtered = routes.filter((route) => routeMatchesRideWindow(route, window));
  if (!rider) return filtered;

  return filtered
    .map((route, index) => ({ route, index, distance: distanceMilesToRouteStart(route, rider) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ route }) => route);
}

export function formatApproachDistance(miles: number): string {
  if (miles < 0.1) return 'Start is here';
  if (miles < 10) return `${miles.toFixed(1)} mi from you`;
  return `${Math.round(miles)} mi from you`;
}
