import { randomUUID } from 'node:crypto';
import type { Difficulty, RoadType, ScenicRoute, SurfaceQuality, VehicleCategory } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

export interface ScenicRouteFilters {
  vehicleCategory?: VehicleCategory;
  roadType?: RoadType;
  maxDifficulty?: Difficulty;
}

const DIFFICULTY_ORDER: Record<Difficulty, number> = { easy: 0, moderate: 1, challenging: 2 };

interface ScenicRouteRow {
  id: string;
  name: string;
  description: string;
  vehicle_suitability: string[];
  road_type: string;
  distance_miles: number;
  estimated_duration_minutes: number;
  difficulty: string;
  surface_quality: string;
  avoids_tolls: boolean;
  avoids_motorways: boolean;
  scenic_rating: number;
  safety_notices: string[];
  start_lat: number;
  start_lon: number;
  end_lat: number;
  end_lon: number;
  created_by: string;
  created_at: string | number;
}

function rowToRoute(row: ScenicRouteRow): ScenicRoute {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    vehicleSuitability: row.vehicle_suitability as VehicleCategory[],
    roadType: row.road_type as RoadType,
    distanceMiles: row.distance_miles,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    difficulty: row.difficulty as Difficulty,
    surfaceQuality: row.surface_quality as SurfaceQuality,
    avoidsTolls: row.avoids_tolls,
    avoidsMotorways: row.avoids_motorways,
    scenicRating: row.scenic_rating as 1 | 2 | 3 | 4 | 5,
    safetyNotices: row.safety_notices,
    startLat: row.start_lat,
    startLon: row.start_lon,
    endLat: row.end_lat,
    endLon: row.end_lon,
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
  };
}

/**
 * User-submitted scenic routes, persisted in Postgres (see db.ts).
 * Deliberately starts empty — there is no seed data here, because route
 * suitability/safety must never be fabricated for unverified content (see
 * shared/scenicRoutes.ts). Routes only exist once someone has explicitly
 * submitted them through the validated create path.
 *
 * This is unrelated to the static motorbike-first route catalogue added in
 * PR #48 (`mobile/src/routes/curatedRoutes.ts`) — that is client-side
 * reference content bundled with the app, not backend/user data, and this
 * store never reads or writes it.
 */
export class ScenicRouteStore {
  /** Assumes `input` has already been validated by the caller via
   * `validateScenicRouteInput`. */
  async create(input: Omit<ScenicRoute, 'id' | 'createdBy' | 'createdAt'>, createdBy: string): Promise<ScenicRoute> {
    await ensureMigrated();
    const route: ScenicRoute = {
      ...input,
      id: randomUUID(),
      createdBy,
      createdAt: Date.now(),
    };
    await getPool().query(
      `INSERT INTO scenic_routes (
        id, name, description, vehicle_suitability, road_type, distance_miles, estimated_duration_minutes,
        difficulty, surface_quality, avoids_tolls, avoids_motorways, scenic_rating, safety_notices,
        start_lat, start_lon, end_lat, end_lon, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        route.id,
        route.name,
        route.description,
        route.vehicleSuitability,
        route.roadType,
        route.distanceMiles,
        route.estimatedDurationMinutes,
        route.difficulty,
        route.surfaceQuality,
        route.avoidsTolls,
        route.avoidsMotorways,
        route.scenicRating,
        route.safetyNotices,
        route.startLat,
        route.startLon,
        route.endLat,
        route.endLon,
        route.createdBy,
        route.createdAt,
      ]
    );
    return route;
  }

  async list(filters: ScenicRouteFilters = {}): Promise<ScenicRoute[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<ScenicRouteRow>('SELECT * FROM scenic_routes');
    return rows.map(rowToRoute).filter((route) => {
      if (filters.vehicleCategory && !route.vehicleSuitability.includes(filters.vehicleCategory)) return false;
      if (filters.roadType && route.roadType !== filters.roadType) return false;
      if (filters.maxDifficulty && DIFFICULTY_ORDER[route.difficulty] > DIFFICULTY_ORDER[filters.maxDifficulty]) return false;
      return true;
    });
  }

  async get(id: string): Promise<ScenicRoute | undefined> {
    await ensureMigrated();
    const { rows } = await getPool().query<ScenicRouteRow>('SELECT * FROM scenic_routes WHERE id = $1', [id]);
    return rows[0] ? rowToRoute(rows[0]) : undefined;
  }

  /** Only the creator may remove their own route. */
  async remove(id: string, actorId: string): Promise<boolean> {
    await ensureMigrated();
    const { rowCount } = await getPool().query('DELETE FROM scenic_routes WHERE id = $1 AND created_by = $2', [id, actorId]);
    return Boolean(rowCount);
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM scenic_routes WHERE created_by = $1', [riderId]);
  }
}
