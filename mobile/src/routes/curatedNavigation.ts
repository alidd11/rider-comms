import { haversineMiles } from '@rider-comms/shared';
import type { CuratedRoute } from './curatedRoutes.ts';

/** A planned scenic-route checkpoint. Stored locally only for the navigation session. */
export interface CuratedNavigationStop { lat: number; lon: number; label: string }

export const CURATED_STOP_REACHED_METERS = 140;
export const CURATED_STOP_MAX_GPS_ACCURACY_METERS = 80;

function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return haversineMiles(a, b) * 1609.344;
}

/** Start is an actual checkpoint unless the rider is already there. Never drop
 * the scenic waypoints just because the current GPS fix is nearer the finish. */
export function initialCuratedStops(
  route: Pick<CuratedRoute, 'start' | 'waypoints'>,
  origin: { lat: number; lon: number },
): CuratedNavigationStop[] {
  const stops = [route.start, ...route.waypoints];
  return metresBetween(origin, route.start) <= CURATED_STOP_REACHED_METERS ? stops.slice(1) : stops;
}

/** Advance only the *next* checkpoint on a trustworthy GPS fix. We never
 * silently skip or reorder stops after rerouting or a GPS outage. */
export function advanceCuratedStops(
  remaining: readonly CuratedNavigationStop[],
  fix: { lat: number; lon: number },
  accuracyMeters: number | null | undefined,
): { remaining: CuratedNavigationStop[]; reached: CuratedNavigationStop | null } {
  const next = remaining[0];
  if (!next || !Number.isFinite(accuracyMeters) || accuracyMeters == null
    || accuracyMeters < 0 || accuracyMeters > CURATED_STOP_MAX_GPS_ACCURACY_METERS
    || metresBetween(fix, next) > CURATED_STOP_REACHED_METERS) {
    return { remaining: [...remaining], reached: null };
  }
  return { remaining: remaining.slice(1), reached: next };
}
