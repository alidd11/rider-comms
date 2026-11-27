import type { PlaceResult } from '../api/places';

/**
 * The place a press and hold on the map picks: a pin with its coordinates
 * as the address, so the destination card, route preview and Start route
 * all work without place search (web: dropPin in docs/app/15-destination.js).
 */
export function droppedPinPlace(lat: number, lon: number): PlaceResult {
  const coordinates = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return { id: `pin:${coordinates}`, name: 'Dropped pin', address: coordinates, lat, lon, distanceMeters: 0 };
}

/** A pin can be dropped only on a parked map: never while riding or navigating. */
export function canDropPin(lockedForSafety: boolean, navigating: boolean): boolean {
  return !lockedForSafety && !navigating;
}
