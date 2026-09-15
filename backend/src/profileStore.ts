import type { ProfileUpdate, RiderProfile, UnitSystem, ZoneTier } from '@rider-comms/shared';

const ZONE_TIERS: ZoneTier[] = ['free', 'premium', 'premium_plus'];
const UNIT_SYSTEMS: UnitSystem[] = ['mi', 'km'];
const SOCIAL_VISIBILITIES = ['public', 'friends', 'private'];

export type ProfileUpdateResult =
  | { ok: true; profile: RiderProfile }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const ALLOWED_UPDATE_FIELDS = new Set([
  'displayName', 'handle', 'avatarId', 'zoneTier', 'unitSystem',
  'notifyNearby', 'notifyInvites', 'notifyChat', 'shareLocation',
  'instagramUsername', 'instagramVisibility', 'tiktokUsername', 'tiktokVisibility',
]);

/** Validates a subset of ProfileUpdate fields present on `body`. Returns an
 * error message for the first invalid field found, or null if everything
 * present is valid. Fields not present are not checked (PUT is a partial
 * merge, not a full replace). */
export function validateProfileUpdate(body: Record<string, unknown>): string | null {
  const unknownField = Object.keys(body).find((key) => !ALLOWED_UPDATE_FIELDS.has(key));
  if (unknownField) return `unknown profile field: ${unknownField}`;
  if ('displayName' in body && !isNonEmptyString(body.displayName)) {
    return 'displayName must be a non-empty string';
  }
  if ('handle' in body && !isNonEmptyString(body.handle)) {
    return 'handle must be a non-empty string';
  }
  if ('avatarId' in body && !isNonEmptyString(body.avatarId)) {
    return 'avatarId must be a non-empty string';
  }
  if (typeof body.displayName === 'string' && body.displayName.trim().length > 50) {
    return 'displayName must be at most 50 characters';
  }
  if (typeof body.handle === 'string' && !/^@[a-z0-9_]{3,24}$/i.test(body.handle)) {
    return 'handle must start with @ and contain 3-24 letters, numbers, or underscores';
  }
  if (typeof body.avatarId === 'string' && body.avatarId.length > 40) {
    return 'avatarId must be at most 40 characters';
  }
  for (const key of ['instagramUsername', 'tiktokUsername'] as const) {
    if (key in body && (typeof body[key] !== 'string' || !/^[a-z0-9._]{0,30}$/i.test(body[key] as string))) return `${key} must contain at most 30 letters, numbers, dots, or underscores`;
  }
  for (const key of ['instagramVisibility', 'tiktokVisibility'] as const) {
    if (key in body && !SOCIAL_VISIBILITIES.includes(body[key] as string)) return `${key} must be public, friends, or private`;
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
      shareLocation: false,
      instagramUsername: '',
      instagramVisibility: 'friends',
      tiktokUsername: '',
      tiktokVisibility: 'friends',
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
