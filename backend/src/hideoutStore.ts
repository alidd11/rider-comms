import { randomUUID } from 'node:crypto';
import type { Hideout } from '@rider-comms/shared';

export type DeleteHideoutResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'forbidden' };

/** Saved meeting points a group of friends is planning around. */
export class HideoutStore {
  private hideouts = new Map<string, Hideout>();

  create(input: {
    name: string;
    lat: number;
    lon: number;
    createdBy: string;
    participantIds: string[];
  }): Hideout {
    const hideout: Hideout = {
      id: randomUUID(),
      name: input.name,
      lat: input.lat,
      lon: input.lon,
      createdBy: input.createdBy,
      participantIds: input.participantIds,
      createdAt: Date.now(),
    };
    this.hideouts.set(hideout.id, hideout);
    return hideout;
  }

  getForRider(riderId: string): Hideout[] {
    return [...this.hideouts.values()].filter(
      (h) => h.createdBy === riderId || h.participantIds.includes(riderId)
    );
  }

  delete(hideoutId: string, riderId: string): DeleteHideoutResult {
    const hideout = this.hideouts.get(hideoutId);
    if (!hideout) {
      return { ok: false, error: 'not_found' };
    }
    if (hideout.createdBy !== riderId) {
      return { ok: false, error: 'forbidden' };
    }
    this.hideouts.delete(hideoutId);
    return { ok: true };
  }
}
