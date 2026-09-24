// Keep this compatibility entry point so existing native imports stay stable.
// The pure zoom/pitch/heading math now lives in the shared package (it takes
// plain numbers, no platform-specific coordinate shape). combineNavigationCameraPaths
// stays here because it operates on this app's {lat, lon} route-coordinate
// shape, which the PWA's {lat, lng} Google Maps LatLng literal does not share.
export {
  navigationCameraProfile,
  navigationViewportBias,
  stabilizeNavigationHeading,
} from '@rider-comms/shared';

export type {
  NavigationCameraProfile,
  NavigationCameraProfileInput,
} from '@rider-comms/shared';

export interface NavigationCameraCoordinate {
  lat: number;
  lon: number;
}

export function combineNavigationCameraPaths(
  ...paths: ReadonlyArray<readonly NavigationCameraCoordinate[] | undefined>
): NavigationCameraCoordinate[] {
  const combined: NavigationCameraCoordinate[] = [];
  for (const path of paths) {
    if (!path) continue;
    for (const coordinate of path) {
      const previous = combined[combined.length - 1];
      if (
        previous
        && Math.abs(previous.lat - coordinate.lat) < 1e-7
        && Math.abs(previous.lon - coordinate.lon) < 1e-7
      ) {
        continue;
      }
      combined.push(coordinate);
    }
  }
  return combined;
}
