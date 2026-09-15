import type { ProfileUpdate, RiderProfile, UnitSystem, ZoneTier } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

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

interface RiderProfileRow {
  rider_id: string;
  display_name: string;
  handle: string;
  avatar_id: string;
  zone_tier: string;
  unit_system: string;
  notify_nearby: boolean;
  notify_invites: boolean;
  notify_chat: boolean;
  share_location: boolean;
  instagram_username: string;
  instagram_visibility: string;
  tiktok_username: string;
  tiktok_visibility: string;
  updated_at: string | number;
}

function rowToProfile(row: RiderProfileRow): RiderProfile {
  return {
    riderId: row.rider_id,
    displayName: row.display_name,
    handle: row.handle,
    avatarId: row.avatar_id,
    zoneTier: row.zone_tier as ZoneTier,
    unitSystem: row.unit_system as UnitSystem,
    notifyNearby: row.notify_nearby,
    notifyInvites: row.notify_invites,
    notifyChat: row.notify_chat,
    shareLocation: row.share_location,
    instagramUsername: row.instagram_username,
    instagramVisibility: row.instagram_visibility as RiderProfile['instagramVisibility'],
    tiktokUsername: row.tiktok_username,
    tiktokVisibility: row.tiktok_visibility as RiderProfile['tiktokVisibility'],
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Rider-level account settings (there's no separate signup flow in this
 * prototype, so the first read of any riderId lazily creates a default
 * profile — that's effectively account creation), persisted in Postgres
 * (see db.ts).
 */
export class ProfileStore {
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

  private async upsert(profile: RiderProfile): Promise<void> {
    await getPool().query(
      `INSERT INTO rider_profiles (
         rider_id, display_name, handle, avatar_id, zone_tier, unit_system,
         notify_nearby, notify_invites, notify_chat, share_location,
         instagram_username, instagram_visibility, tiktok_username, tiktok_visibility, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (rider_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         handle = EXCLUDED.handle,
         avatar_id = EXCLUDED.avatar_id,
         zone_tier = EXCLUDED.zone_tier,
         unit_system = EXCLUDED.unit_system,
         notify_nearby = EXCLUDED.notify_nearby,
         notify_invites = EXCLUDED.notify_invites,
         notify_chat = EXCLUDED.notify_chat,
         share_location = EXCLUDED.share_location,
         instagram_username = EXCLUDED.instagram_username,
         instagram_visibility = EXCLUDED.instagram_visibility,
         tiktok_username = EXCLUDED.tiktok_username,
         tiktok_visibility = EXCLUDED.tiktok_visibility,
         updated_at = EXCLUDED.updated_at`,
      [
        profile.riderId,
        profile.displayName,
        profile.handle,
        profile.avatarId,
        profile.zoneTier,
        profile.unitSystem,
        profile.notifyNearby,
        profile.notifyInvites,
        profile.notifyChat,
        profile.shareLocation,
        profile.instagramUsername,
        profile.instagramVisibility,
        profile.tiktokUsername,
        profile.tiktokVisibility,
        profile.updatedAt,
      ]
    );
  }

  /** Returns the rider's profile, creating a default one if this riderId
   * has never been seen before. */
  async getOrCreate(riderId: string): Promise<RiderProfile> {
    await ensureMigrated();
    const { rows } = await getPool().query<RiderProfileRow>('SELECT * FROM rider_profiles WHERE rider_id = $1', [riderId]);
    if (rows[0]) return rowToProfile(rows[0]);
    const profile = this.makeDefault(riderId);
    await this.upsert(profile);
    return profile;
  }

  /** Validates `update` and, if valid, merges it into the rider's profile
   * (creating one with defaults first if needed), bumping `updatedAt`. */
  async update(riderId: string, update: ProfileUpdate & Record<string, unknown>): Promise<ProfileUpdateResult> {
    const error = validateProfileUpdate(update);
    if (error) {
      return { ok: false, error };
    }

    const current = await this.getOrCreate(riderId);
    const next: RiderProfile = {
      ...current,
      ...(update as ProfileUpdate),
      riderId,
      updatedAt: Date.now(),
    };
    await this.upsert(next);
    return { ok: true, profile: next };
  }

  async delete(riderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM rider_profiles WHERE rider_id = $1', [riderId]);
  }
}
