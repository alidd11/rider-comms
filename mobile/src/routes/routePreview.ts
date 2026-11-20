import type { InAppNavigationRoute } from '../api/directions';

const METRES_PER_MILE = 1609.344;
const MAX_REVIEWED_DISTANCE_DEVIATION = 0.25;

/** Never show a partial or malformed provider response as a valid road map. */
export function hasUsableRoadPreview(route: InAppNavigationRoute): boolean {
  return Array.isArray(route.coordinates)
    && route.coordinates.length >= 2
    && route.coordinates.every(({ lat, lon }) => Number.isFinite(lat) && lat >= -90 && lat <= 90
      && Number.isFinite(lon) && lon >= -180 && lon <= 180)
    && Number.isFinite(route.distanceMeters) && route.distanceMeters > 0
    && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0;
}

/** A caution, not proof that the correct scenic roads were selected. */
export function roadPreviewDiffersFromReviewedDistance(
  reviewedMiles: number,
  calculatedMetres: number,
): boolean {
  if (!Number.isFinite(reviewedMiles) || reviewedMiles <= 0
    || !Number.isFinite(calculatedMetres) || calculatedMetres <= 0) return false;
  const calculatedMiles = calculatedMetres / METRES_PER_MILE;
  return Math.abs(calculatedMiles - reviewedMiles) / reviewedMiles > MAX_REVIEWED_DISTANCE_DEVIATION;
}
