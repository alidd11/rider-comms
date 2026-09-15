/**
 * Curated scenic routes. This is explicitly NOT user-generated content: the
 * store this backs (`ScenicRouteStore`) starts empty and is meant to be
 * populated by the product/curation team, because route suitability and
 * safety claims must never be fabricated or inferred for unverified data.
 * What lives here is the honest plumbing (types + strict validation) for
 * that future curation workflow.
 */
export type VehicleCategory = 'motorcycle_small' | 'motorcycle_large' | 'scooter' | 'car';
export type RoadType = 'rural' | 'mountain' | 'coastal' | 'urban' | 'mixed';
export type Difficulty = 'easy' | 'moderate' | 'challenging';
export type SurfaceQuality = 'excellent' | 'good' | 'fair' | 'poor';

export interface ScenicRoute {
  id: string;
  name: string;
  description: string;
  vehicleSuitability: VehicleCategory[];
  roadType: RoadType;
  distanceMiles: number;
  estimatedDurationMinutes: number;
  difficulty: Difficulty;
  surfaceQuality: SurfaceQuality;
  avoidsTolls: boolean;
  avoidsMotorways: boolean;
  scenicRating: 1 | 2 | 3 | 4 | 5;
  safetyNotices: string[];
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  createdBy: string;
  createdAt: number;
}

const VEHICLE_CATEGORIES: readonly VehicleCategory[] = ['motorcycle_small', 'motorcycle_large', 'scooter', 'car'];
const ROAD_TYPES: readonly RoadType[] = ['rural', 'mountain', 'coastal', 'urban', 'mixed'];
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'moderate', 'challenging'];
const SURFACE_QUALITIES: readonly SurfaceQuality[] = ['excellent', 'good', 'fair', 'poor'];

const NAME_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 500;
const SAFETY_NOTICE_MAX_LENGTH = 200;

function isCoordinate(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
  );
}

function isNonEmptyStringWithinLength(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export type ValidateScenicRouteInputResult =
  | { ok: true; value: Omit<ScenicRoute, 'id' | 'createdBy' | 'createdAt'> }
  | { ok: false; error: string };

/**
 * Thorough field-by-field validation — this is the "never fabricate, always
 * validate" boundary for scenic route content. Nothing here infers or
 * defaults a safety-relevant field; every value must be explicitly supplied
 * and in range.
 */
export function validateScenicRouteInput(input: unknown): ValidateScenicRouteInputResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'input must be an object' };
  }
  const body = input as Record<string, unknown>;

  if (!isNonEmptyStringWithinLength(body.name, NAME_MAX_LENGTH)) {
    return { ok: false, error: `name must be a non-empty string of at most ${NAME_MAX_LENGTH} characters` };
  }
  if (!isNonEmptyStringWithinLength(body.description, DESCRIPTION_MAX_LENGTH)) {
    return { ok: false, error: `description must be a non-empty string of at most ${DESCRIPTION_MAX_LENGTH} characters` };
  }
  if (
    !Array.isArray(body.vehicleSuitability) ||
    body.vehicleSuitability.length === 0 ||
    !body.vehicleSuitability.every((v) => VEHICLE_CATEGORIES.includes(v as VehicleCategory))
  ) {
    return { ok: false, error: 'vehicleSuitability must be a non-empty array of valid vehicle categories' };
  }
  if (typeof body.roadType !== 'string' || !ROAD_TYPES.includes(body.roadType as RoadType)) {
    return { ok: false, error: 'roadType must be a valid road type' };
  }
  if (typeof body.distanceMiles !== 'number' || !Number.isFinite(body.distanceMiles) || body.distanceMiles <= 0) {
    return { ok: false, error: 'distanceMiles must be a positive number' };
  }
  if (
    typeof body.estimatedDurationMinutes !== 'number' ||
    !Number.isFinite(body.estimatedDurationMinutes) ||
    body.estimatedDurationMinutes <= 0
  ) {
    return { ok: false, error: 'estimatedDurationMinutes must be a positive number' };
  }
  if (typeof body.difficulty !== 'string' || !DIFFICULTIES.includes(body.difficulty as Difficulty)) {
    return { ok: false, error: 'difficulty must be a valid difficulty' };
  }
  if (typeof body.surfaceQuality !== 'string' || !SURFACE_QUALITIES.includes(body.surfaceQuality as SurfaceQuality)) {
    return { ok: false, error: 'surfaceQuality must be a valid surface quality' };
  }
  if (typeof body.avoidsTolls !== 'boolean') {
    return { ok: false, error: 'avoidsTolls must be a boolean' };
  }
  if (typeof body.avoidsMotorways !== 'boolean') {
    return { ok: false, error: 'avoidsMotorways must be a boolean' };
  }
  if (
    typeof body.scenicRating !== 'number' ||
    !Number.isInteger(body.scenicRating) ||
    body.scenicRating < 1 ||
    body.scenicRating > 5
  ) {
    return { ok: false, error: 'scenicRating must be an integer from 1 to 5' };
  }
  if (
    !Array.isArray(body.safetyNotices) ||
    !body.safetyNotices.every((n) => typeof n === 'string' && n.length <= SAFETY_NOTICE_MAX_LENGTH)
  ) {
    return { ok: false, error: `safetyNotices must be an array of strings of at most ${SAFETY_NOTICE_MAX_LENGTH} characters each` };
  }
  if (!isCoordinate(body.startLat, body.startLon)) {
    return { ok: false, error: 'startLat and startLon must be valid coordinates' };
  }
  if (!isCoordinate(body.endLat, body.endLon)) {
    return { ok: false, error: 'endLat and endLon must be valid coordinates' };
  }

  return {
    ok: true,
    value: {
      name: (body.name as string).trim(),
      description: (body.description as string).trim(),
      vehicleSuitability: [...(body.vehicleSuitability as VehicleCategory[])],
      roadType: body.roadType as RoadType,
      distanceMiles: body.distanceMiles as number,
      estimatedDurationMinutes: body.estimatedDurationMinutes as number,
      difficulty: body.difficulty as Difficulty,
      surfaceQuality: body.surfaceQuality as SurfaceQuality,
      avoidsTolls: body.avoidsTolls as boolean,
      avoidsMotorways: body.avoidsMotorways as boolean,
      scenicRating: body.scenicRating as 1 | 2 | 3 | 4 | 5,
      safetyNotices: [...(body.safetyNotices as string[])],
      startLat: body.startLat as number,
      startLon: body.startLon as number,
      endLat: body.endLat as number,
      endLon: body.endLon as number,
    },
  };
}
