import type { LocationFix } from '@rider-comms/shared';

export type ExpoLocationLike = {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    speed: number | null;
  };
};

/** Convert Expo's platform location shape into the shared safety model. */
export function toMovementFix(position: ExpoLocationLike): LocationFix {
  return {
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    timestampMs: position.timestamp,
    accuracyMeters: position.coords.accuracy ?? Number.POSITIVE_INFINITY,
    ...(position.coords.speed == null ? {} : { speedMps: position.coords.speed }),
  };
}
