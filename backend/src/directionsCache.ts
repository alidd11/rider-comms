import type { DrivingRoute, RouteCoordinate } from './directionsProvider.ts';

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 500;
// Google's Directions API here is called without departure_time, so it
// returns a static (non-traffic-aware) route -- the same origin/destination
// pair doesn't meaningfully change over a few minutes. Rounding to 4 decimal
// places (~11m) collapses repeat requests -- a rider re-tapping the same
// destination, or the ETA preview immediately followed by "Start route" --
// into a single upstream (billed) call.
const COORDINATE_PRECISION = 4;

function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_PRECISION;
  return Math.round(value * factor) / factor;
}

function cacheKey(origin: RouteCoordinate, destination: RouteCoordinate): string {
  return [origin, destination]
    .map((point) => `${roundCoordinate(point.lat)},${roundCoordinate(point.lon)}`)
    .join('|');
}

interface CacheEntry {
  route: DrivingRoute;
  expiresAt: number;
}

/**
 * In-memory, per-instance cache in front of the Directions provider. This
 * exists purely to deduplicate near-identical requests within a short
 * window and reduce billed upstream calls -- not to serve stale data
 * indefinitely, so the TTL stays short.
 */
export class DirectionsCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(origin: RouteCoordinate, destination: RouteCoordinate, now = Date.now()): DrivingRoute | null {
    const key = cacheKey(origin, destination);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    // Re-insert so this key counts as most-recently-used for eviction below.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.route;
  }

  set(origin: RouteCoordinate, destination: RouteCoordinate, route: DrivingRoute, now = Date.now()): void {
    const key = cacheKey(origin, destination);
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, { route, expiresAt: now + this.ttlMs });
  }
}

export function wrapDirectionsProviderWithCache(
  provider: (origin: RouteCoordinate, destination: RouteCoordinate) => Promise<DrivingRoute>,
  cache: Pick<DirectionsCache, 'get' | 'set'>,
): (origin: RouteCoordinate, destination: RouteCoordinate) => Promise<DrivingRoute> {
  return async (origin, destination) => {
    const cached = cache.get(origin, destination);
    if (cached) return cached;
    const route = await provider(origin, destination);
    cache.set(origin, destination, route);
    return route;
  };
}
