export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Rider {
  id: string;
  location: GeoPoint;
  /** Rider's current subscription radius in miles (Free=1, Premium=~6, Premium+=~20) */
  radiusMiles: number;
  /** Unix ms timestamp of the last location update */
  updatedAt: number;
}

export type ZoneTier = 'free' | 'premium' | 'premium_plus';

/**
 * Default radius per tier, in miles — locked per the product spec:
 * Free is fixed at 1 mile; Premium/Premium+ are tuning knobs.
 */
export const TIER_RADIUS_MILES: Record<ZoneTier, number> = {
  free: 1,
  premium: 6,
  premium_plus: 20,
};
