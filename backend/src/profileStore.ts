import type { ProfileUpdate, RiderProfile, UnitSystem, ZoneTier } from '@rider-comms/shared';

const ZONE_TIERS: ZoneTier[] = ['free', 'premium', 'premium_plus'];
const UNIT_SYSTEMS: UnitSystem[] = ['mi', 'km'];

export type ProfileUpdateResult =
  | { ok: true; profile: RiderProfile }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Validates a subset of ProfileUpdate fields present on `body`. Returns an
 * error message for the first invalid field found, or null if everything
 * present is valid. Fields not present are not checked (PUT is a partial
 * merge, not a full replace). */
export function validateProfileUpdate(body: Record<string, unknown>): string | null {
  if ('displayName' in body && !isNonEmptyString(body.displayName)) {
    return 'displayName must be a non-empty string';
  }
  if ('handle' in body && !isNonEmptyString(body.handle)) {
    return 'handle must be a non-empty string';
  }
  if ('avatarId' in body && !isNonEmptyString(body.avatarId)) {
    return 'avatarId must be a non-empty string';
  }
  if ('zoneTier' in body && !ZONE_TIERS.includes(body.zoneTier as ZoneTier)) {
    return `zoneTier must be one of: ${ZONE_TIERS.join(', ')}`;
  }
  if ('unitSystem' in body && !UNIT_SYSTEMS.includes(body.unitSystem as UnitSystem)) {
    return `unitSystem must be one of: ${UNIT_SYSTEMS.join(', ')}`;
  }
  for (const key of ['notifyNearby', 'notifyInvites', 'notifyChat', 'shareLocation'] as const) {
    if (key in body && typeof body[key] !== 'boolean') {
      return `${key} must be a boolean`;
    }
  }
  return null;
}

/**
 * Rider-level account settings (there's no separate signup flow in this
 * prototype, so the first read of any riderId lazily creates a default
 * profile — that's effectively account creation).
 */
export class ProfileStore {
  private profiles = new Map<string, RiderProfile>();

  private makeDefault(riderId: string): RiderProfile {
    return {
      riderId,
      displayName: 'Rider',
      handle: '@rider',
      avatarId: 'ember',
      zoneTier: 'free',
      unitSystem: 'mi',
      notifyNearby: true,
      notifyInvites: true,
      notifyChat: true,
      shareLocation: true,
      updatedAt: Date.now(),
    };
  }

  /** Returns the rider's profile, creating a default one if this riderId
   * has never been seen before. */
  getOrCreate(riderId: string): RiderProfile {
    let profile = this.profiles.get(riderId);
    if (!profile) {
      profile = this.makeDefault(riderId);
      this.profiles.set(riderId, profile);
    }
    return profile;
  }

  /** Validates `update` and, if valid, merges it into the rider's profile
   * (creating one with defaults first if needed), bumping `updatedAt`. */
  update(riderId: string, update: ProfileUpdate & Record<string, unknown>): ProfileUpdateResult {
    const error = validateProfileUpdate(update);
    if (error) {
      return { ok: false, error };
    }

    const current = this.getOrCreate(riderId);
    const next: RiderProfile = {
      ...current,
      ...(update as ProfileUpdate),
      riderId,
      updatedAt: Date.now(),
    };
    this.profiles.set(riderId, next);
    return { ok: true, profile: next };
  }
}
