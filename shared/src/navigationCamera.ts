export interface NavigationCameraProfileInput {
  speedMps?: number | null;
  maneuverDistanceMeters?: number | null;
  maneuver?: string | null;
}

export interface NavigationCameraProfile {
  zoom: number;
  pitch: number;
  lookAheadMeters: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Maneuvers worth zooming in for as they approach. Straight-on steps,
 * name changes and a missing maneuver keep the cruising view, so the camera
 * doesn't pump in and out at every step boundary on a long straight road. */
function isTurnManeuver(maneuver?: string | null): boolean {
  return Boolean(maneuver && /turn|ramp|keep/.test(maneuver));
}

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
}: NavigationCameraProfileInput): NavigationCameraProfile {
  const speed = Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : 8;

  let profile: NavigationCameraProfile;
  if (speed <= 1.5) {
    profile = { zoom: 18.8, pitch: 52, lookAheadMeters: 90 };
  } else if (speed < 7) {
    profile = { zoom: 18.7, pitch: 58, lookAheadMeters: 120 };
  } else if (speed < 14) {
    profile = { zoom: 18.4, pitch: 60, lookAheadMeters: 165 };
  } else if (speed < 22) {
    profile = { zoom: 18.0, pitch: 58, lookAheadMeters: 230 };
  } else {
    profile = { zoom: 17.6, pitch: 54, lookAheadMeters: 310 };
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
    };
  } else if (maneuverDistance <= 180 && isTurnManeuver(maneuver)) {
    // For an ordinary turn, progressively tighten the view while retaining
    // enough look-ahead to show the road after the junction.
    const proximity = clamp((180 - maneuverDistance) / 160, 0, 1);
    profile = {
      zoom: Math.min(18.9, profile.zoom + 0.35 * proximity),
      pitch: Math.max(52, profile.pitch - 5 * proximity),
      lookAheadMeters: Math.max(140, profile.lookAheadMeters * (1 - 0.2 * proximity)),
    };
  }

  return profile;
}

export interface NavigationCentreInput {
  /** Height of the map view, in screen points. */
  viewportHeight: number;
  /** Points of map hidden under the instruction banner at the top. */
  topOcclusion: number;
  /** Points of map hidden under the trip summary and controls at the bottom. */
  bottomOcclusion: number;
  zoom: number;
  pitch: number;
  latitude: number;
}

// Where the rider sits in the part of the map that isn't covered: 0 is the
// banner's bottom edge, 1 the top of the trip summary and controls.
const RIDER_POSITION_IN_VISIBLE_MAP = 0.7;
// Google's vector map and Apple Maps both draw a tilted map with a camera
// roughly this many viewport heights from the ground. It's an
// approximation, but the screen offset it converts is small (the rider is
// placed near the middle of the clear area), so the error stays a few points.
const CAMERA_DISTANCE_IN_VIEWPORT_HEIGHTS = 1.5;
const METRES_PER_POINT_AT_ZOOM_0 = 156_543.033_92;

/**
 * Where the rider should sit, in points below the centre of the map:
 * 70% of the way down the part the banner and trip summary leave clear.
 */
export function navigationRiderScreenOffset(
  viewportHeight: number,
  topOcclusion: number,
  bottomOcclusion: number,
): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  const top = clamp(Number.isFinite(topOcclusion) ? topOcclusion : 0, 0, viewportHeight);
  const bottom = clamp(Number.isFinite(bottomOcclusion) ? bottomOcclusion : 0, 0, viewportHeight);
  let visibleTop = top;
  let visibleBottom = viewportHeight - bottom;
  // Landscape on a small phone can leave almost nothing clear; fall back to
  // the whole map rather than squeezing the rider into a sliver.
  if (visibleBottom - visibleTop < viewportHeight * 0.2) {
    visibleTop = 0;
    visibleBottom = viewportHeight;
  }
  const riderY = visibleTop + (visibleBottom - visibleTop) * RIDER_POSITION_IN_VISIBLE_MAP;
  return riderY - viewportHeight / 2;
}

/** Metres per map point at a zoom level (256-point tiles). */
export function navigationMetresPerPoint(zoom: number, latitude: number): number {
  const lat = Number.isFinite(latitude) ? clamp(latitude, -85, 85) : 0;
  return (METRES_PER_POINT_AT_ZOOM_0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * How far ahead of the rider, along the camera heading, to centre the map so
 * the rider's marker lands in the clear part of the screen.
 *
 * This used to be a fixed distance in metres. A tilted map magnifies
 * the ground nearest the camera, so a fixed distance pushed the marker
 * down under the trip summary, and further still when the summary and
 * controls were tall. Working from the screen keeps it in view.
 */
export function navigationCentreAheadMeters({
  viewportHeight,
  topOcclusion,
  bottomOcclusion,
  zoom,
  pitch,
  latitude,
}: NavigationCentreInput): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0 || !Number.isFinite(zoom)) return 0;
  const screenOffset = navigationRiderScreenOffset(viewportHeight, topOcclusion, bottomOcclusion);

  const tilt = (clamp(Number.isFinite(pitch) ? pitch : 0, 0, 75) * Math.PI) / 180;
  const cameraDistance = viewportHeight * CAMERA_DISTANCE_IN_VIEWPORT_HEIGHTS;
  // Inverse of the perspective projection: a point d ground-points towards
  // the camera from the centre is drawn at y = D·d·cos(t) / (D − d·sin(t)).
  const denominator = Math.max(
    cameraDistance * 0.25,
    cameraDistance * Math.cos(tilt) + screenOffset * Math.sin(tilt),
  );
  const groundOffset = (screenOffset * cameraDistance) / denominator;
  return groundOffset * navigationMetresPerPoint(zoom, latitude);
}

export interface NavigationCameraFitSample {
  /** Where the rider should be, in points below the map centre. */
  targetOffset: number;
  /** Where the map actually drew the rider, in points below the map centre. */
  measuredOffset: number;
  /** The rider's distance from the centre in flat (untilted) map points. */
  flatOffset: number;
  pitch: number;
}

/**
 * Next multiplier for navigationCentreAheadMeters after measuring where the
 * map actually drew the rider. The camera model is an approximation (each
 * map SDK uses its own field of view), so this nudges the offset until the
 * rider lands where it should, and learns per device.
 *
 * Returns the current value unchanged when the sample can't be trusted:
 * offsets too small to compare, opposite signs, or a projection that
 * ignores tilt (it reports the flat offset even though the map is tilted).
 */
export function nextNavigationCameraCorrection(current: number, sample: NavigationCameraFitSample): number {
  const base = Number.isFinite(current) && current > 0 ? current : 1;
  const { targetOffset, measuredOffset, flatOffset, pitch } = sample;
  if (![targetOffset, measuredOffset, flatOffset, pitch].every(Number.isFinite)) return base;
  if (Math.abs(targetOffset) < 20 || Math.abs(measuredOffset) < 20) return base;
  if (Math.sign(targetOffset) !== Math.sign(measuredOffset)) return base;
  if (pitch > 20 && Math.abs(measuredOffset - flatOffset) <= Math.abs(flatOffset) * 0.03) return base;
  const ratio = clamp(targetOffset / measuredOffset, 0.5, 2);
  // Move half way each time so one noisy frame can't swing the camera.
  return clamp(base * (1 + (ratio - 1) * 0.5), 0.6, 1.8);
}

/**
 * The Apple Maps camera altitude that matches a Google zoom level under the
 * same camera model. react-native-maps ignores `zoom` on Apple Maps and only
 * reads `altitude`, so without this the iPhone nav camera never zoomed.
 */
export function navigationCameraAltitudeMeters({
  viewportHeight,
  zoom,
  pitch,
  latitude,
}: Pick<NavigationCentreInput, 'viewportHeight' | 'zoom' | 'pitch' | 'latitude'>): number {
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 800;
  const metresPerPoint = navigationMetresPerPoint(zoom, latitude);
  const tilt = (clamp(Number.isFinite(pitch) ? pitch : 0, 0, 75) * Math.PI) / 180;
  // Altitude is the camera's height above the ground, not its distance
  // to the centre, so a pitched camera sits lower.
  return height * CAMERA_DISTANCE_IN_VIEWPORT_HEIGHTS * metresPerPoint * Math.cos(tilt);
}

/** The point `meters` from (lat, lng) along `headingDegrees`. Short spans only. */
export function offsetAlongHeading(
  lat: number,
  lng: number,
  headingDegrees: number,
  meters: number,
): { lat: number; lng: number } {
  const heading = (headingDegrees * Math.PI) / 180;
  const metresPerDegreeLat = 111_320;
  const metresPerDegreeLng = 111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return {
    lat: lat + (meters * Math.cos(heading)) / metresPerDegreeLat,
    lng: lng + (meters * Math.sin(heading)) / metresPerDegreeLng,
  };
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
