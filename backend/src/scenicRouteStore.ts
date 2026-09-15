import { randomUUID } from 'node:crypto';
import type { Difficulty, RoadType, ScenicRoute, VehicleCategory } from '@rider-comms/shared';

export interface ScenicRouteFilters {
  vehicleCategory?: VehicleCategory;
  roadType?: RoadType;
  maxDifficulty?: Difficulty;
}

const DIFFICULTY_ORDER: Record<Difficulty, number> = { easy: 0, moderate: 1, challenging: 2 };

/**
 * Curated scenic routes. Deliberately starts empty — there is no seed data
 * here, because route suitability/safety must never be fabricated for
 * unverified content (see shared/scenicRoutes.ts). Routes only exist once
 * someone has explicitly submitted them through the validated create path.
 */
export class ScenicRouteStore {
  private routes = new Map<string, ScenicRoute>();

  /** Assumes `input` has already been validated by the caller via
   * `validateScenicRouteInput`. */
  create(input: Omit<ScenicRoute, 'id' | 'createdBy' | 'createdAt'>, createdBy: string): ScenicRoute {
    const route: ScenicRoute = {
      ...input,
      id: randomUUID(),
      createdBy,
      createdAt: Date.now(),
    };
    this.routes.set(route.id, route);
    return route;
  }

  list(filters: ScenicRouteFilters = {}): ScenicRoute[] {
    return [...this.routes.values()].filter((route) => {
      if (filters.vehicleCategory && !route.vehicleSuitability.includes(filters.vehicleCategory)) return false;
      if (filters.roadType && route.roadType !== filters.roadType) return false;
      if (filters.maxDifficulty && DIFFICULTY_ORDER[route.difficulty] > DIFFICULTY_ORDER[filters.maxDifficulty]) return false;
      return true;
    });
  }

  get(id: string): ScenicRoute | undefined {
    return this.routes.get(id);
  }

  /** Only the creator may remove their own route. */
  remove(id: string, actorId: string): boolean {
    const route = this.routes.get(id);
    if (!route || route.createdBy !== actorId) return false;
    this.routes.delete(id);
    return true;
  }

  deleteRider(riderId: string): void {
    for (const [id, route] of this.routes) {
      if (route.createdBy === riderId) this.routes.delete(id);
    }
  }
}
