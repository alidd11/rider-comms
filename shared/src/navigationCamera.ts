export interface NavigationCameraProfileInput {
  speedMps?: number | null;
  maneuverDistanceMeters?: number | null;
  maneuver?: string | null;
  viewportBias?: number;
}

export interface NavigationCameraProfile {
  zoom: number;
  pitch: number;
  lookAheadMeters: number;
  centreAheadMeters: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function isComplexManeuver(maneuver?: string | null): boolean {
  return Boolean(maneuver && (
    maneuver.includes('roundabout')
    || maneuver.includes('uturn')
    || maneuver.includes('fork')
  ));
}

export function navigationCameraProfile({
  speedMps,
  maneuverDistanceMeters,
  maneuver,
  viewportBias = 1,
}: NavigationCameraProfileInput): NavigationCameraProfile {
  const speed = Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : 8;

  let profile: NavigationCameraProfile;
  if (speed <= 1.5) {
    profile = { zoom: 18.8, pitch: 52, lookAheadMeters: 90, centreAheadMeters: 42 };
  } else if (speed < 7) {
    profile = { zoom: 18.7, pitch: 58, lookAheadMeters: 120, centreAheadMeters: 52 };
  } else if (speed < 14) {
    profile = { zoom: 18.4, pitch: 60, lookAheadMeters: 165, centreAheadMeters: 70 };
  } else if (speed < 22) {
    profile = { zoom: 18.0, pitch: 58, lookAheadMeters: 230, centreAheadMeters: 95 };
  } else {
    profile = { zoom: 17.6, pitch: 54, lookAheadMeters: 310, centreAheadMeters: 125 };
  }

  const maneuverDistance = Number.isFinite(maneuverDistanceMeters)
    ? Math.max(0, Number(maneuverDistanceMeters))
    : Number.POSITIVE_INFINITY;

  if (isComplexManeuver(maneuver) && maneuverDistance <= 260) {
    // Roundabouts, U-turns and forks need more route geometry in frame than a
    // normal bend. Pull back and flatten slightly rather than zooming into the
    // centre of a complex junction.
    profile = {
      zoom: Math.min(profile.zoom, 18.0),
      pitch: Math.min(profile.pitch, 50),
      lookAheadMeters: Math.max(profile.lookAheadMeters, 220),
      centreAheadMeters: Math.max(profile.centreAheadMeters, 80),
    };
  } else if (maneuverDistance <= 180) {
    // For an ordinary turn, progressively tighten the view while retaining
    // enough look-ahead to show the road after the junction.
    const proximity = clamp((180 - maneuverDistance) / 160, 0, 1);
    profile = {
      zoom: Math.min(18.9, profile.zoom + 0.35 * proximity),
      pitch: Math.max(52, profile.pitch - 5 * proximity),
      lookAheadMeters: Math.max(140, profile.lookAheadMeters * (1 - 0.2 * proximity)),
      centreAheadMeters: Math.max(55, profile.centreAheadMeters * (1 - 0.08 * proximity)),
    };
  }

  return {
    ...profile,
    centreAheadMeters: profile.centreAheadMeters * clamp(viewportBias, 0.9, 1.3),
  };
}

export function navigationViewportBias(
  viewportHeight: number,
  topOcclusion: number,
  bottomOcclusion: number,
): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 1;
  const top = clamp(Number.isFinite(topOcclusion) ? topOcclusion : 0, 0, viewportHeight);
  const bottom = clamp(Number.isFinite(bottomOcclusion) ? bottomOcclusion : 0, 0, viewportHeight);
  const occludedFraction = clamp((top + bottom) / viewportHeight, 0, 0.7);
  const topDominance = clamp((top - bottom) / viewportHeight, -0.25, 0.25);
  return clamp(1 + occludedFraction * 0.45 + topDominance * 0.35, 0.9, 1.3);
}

function normaliseHeading(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function stabilizeNavigationHeading(
  previousHeading: number | null,
  candidateHeading: number,
  speedMps?: number | null,
): number {
  const candidate = normaliseHeading(candidateHeading);
  if (!Number.isFinite(previousHeading)) return candidate;

  const previous = normaliseHeading(Number(previousHeading));
  const speed = Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : 8;
  if (speed <= 1.5) return previous;

  const delta = ((candidate - previous + 540) % 360) - 180;
  const alpha = speed < 5 ? 0.22 : speed < 12 ? 0.34 : speed < 22 ? 0.46 : 0.56;
  return normaliseHeading(previous + delta * alpha);
}
