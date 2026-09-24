import type { PlaceCategory, PlaceSearchResult } from './places';

const DEFAULT_TTL_MS = 2 * 60_000;
const DEFAULT_MAX_ENTRIES = 200;
// Place search is biased/restricted to a radius measured in kilometers, so
// rounding `near` to 3 decimal places (~111m) collapses requests from a
// rider who hasn't moved meaningfully -- retyping the same query, toggling a
// category chip off and back on, or the debounce firing twice for the same
// input -- into a single billed upstream call.
const COORDINATE_PRECISION = 3;

function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_PRECISION;
  return Math.round(value * factor) / factor;
}

function nearKey(near: { lat: number; lon: number }): string {
  return `${roundCoordinate(near.lat)},${roundCoordinate(near.lon)}`;
}

interface CacheEntry {
  result: PlaceSearchResult;
  expiresAt: number;
}

/**
 * In-memory, per-instance cache in front of the Places search functions.
 * Only successful searches are cached -- a rate-limited, network, or
 * provider failure should be retried on the next request, not remembered.
 */
export class PlacesCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get(key: string, now = Date.now()): PlaceSearchResult | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }

  set(key: string, result: PlaceSearchResult, now = Date.now()): void {
    if (result.status !== 'ok') return;
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
    this.entries.set(key, { result, expiresAt: now + this.ttlMs });
  }
}

export function textSearchCacheKey(query: string, near: { lat: number; lon: number }): string {
  return `text|${query.trim().toLowerCase()}|${nearKey(near)}`;
}

export function nearbySearchCacheKey(category: PlaceCategory, near: { lat: number; lon: number }): string {
  return `nearby|${category.includedTypes.join(',')}|${nearKey(near)}`;
}

export function wrapPlacesSearchWithCache<Args extends unknown[]>(
  search: (...args: Args) => Promise<PlaceSearchResult>,
  cache: Pick<PlacesCache, 'get' | 'set'>,
  keyFor: (...args: Args) => string,
): (...args: Args) => Promise<PlaceSearchResult> {
  return async (...args: Args) => {
    const key = keyFor(...args);
    const cached = cache.get(key);
    if (cached) return cached;
    const result = await search(...args);
    cache.set(key, result);
    return result;
  };
}
