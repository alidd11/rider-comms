import { randomUUID } from 'node:crypto';
import { ttlMsForType } from '@rider-comms/shared';
import type { HazardType } from '@rider-comms/shared';
import { ensureMigrated, getPool, withTransaction } from './db.ts';

/**
 * Settings an admin changes in the Staff Hub without a deploy:
 * - how long each kind of hazard stays on the map;
 * - the oldest phone-app version that may still be used, per platform, and
 *   the store page riders on an older one are sent to.
 * A setting nobody changed keeps the built-in default. Each change needs a
 * note and is written to the audit log.
 */
export const HAZARD_TYPES: readonly HazardType[] = ['police', 'hidden_police', 'police_checkpoint', 'camera', 'accident', 'road_closure'];
export const HAZARD_MINUTES_MIN = 15;
export const HAZARD_MINUTES_MAX = 24 * 60;
export const APP_PLATFORMS = ['ios', 'android'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];
/** Only the official stores: a rider is never sent anywhere else. */
const STORE_HOSTS: Record<AppPlatform, string> = { ios: 'apps.apple.com', android: 'play.google.com' };

export interface AppSettings {
  /** Minutes each hazard type stays on the map after its last sighting. */
  hazardMinutes: Record<HazardType, number>;
  /** The oldest version (x.y.z) still allowed; null lets every version in. */
  minAppVersion: Record<AppPlatform, string | null>;
  /** The store page an out-of-date app opens; null shows the store's name only. */
  updateUrl: Record<AppPlatform, string | null>;
}
export type AppSettingKey = keyof AppSettings;
export const APP_SETTING_KEYS: readonly AppSettingKey[] = ['hazardMinutes', 'minAppVersion', 'updateUrl'];
export const isAppSettingKey = (value: unknown): value is AppSettingKey => (APP_SETTING_KEYS as readonly unknown[]).includes(value);

export interface AppSettingChange { changedBy: string; changedAt: number; note: string }

/** How long a replica trusts what it last read; a change on another replica shows within this. */
export const APP_SETTINGS_CACHE_MS = 30_000;

export function defaultAppSettings(): AppSettings {
  return {
    hazardMinutes: Object.fromEntries(HAZARD_TYPES.map((type) => [type, ttlMsForType(type) / 60_000])) as Record<HazardType, number>,
    minAppVersion: { ios: null, android: null },
    updateUrl: { ios: null, android: null },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;

/** The value, or why it can't be saved. */
export function parseAppSetting(key: AppSettingKey, value: unknown): AppSettings[AppSettingKey] | { error: string } {
  if (!isRecord(value)) return { error: 'value must be an object' };
  if (key === 'hazardMinutes') {
    const out: Partial<Record<HazardType, number>> = {};
    for (const type of HAZARD_TYPES) {
      const minutes = value[type];
      if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < HAZARD_MINUTES_MIN || minutes > HAZARD_MINUTES_MAX) {
        return { error: `${type} must be whole minutes from ${HAZARD_MINUTES_MIN} to ${HAZARD_MINUTES_MAX}` };
      }
      out[type] = minutes;
    }
    return out as Record<HazardType, number>;
  }
  const out: Partial<Record<AppPlatform, string | null>> = {};
  for (const platform of APP_PLATFORMS) {
    const raw = value[platform];
    const text = typeof raw === 'string' ? raw.trim() : raw;
    if (text === null || text === '' || text === undefined) { out[platform] = null; continue; }
    if (typeof text !== 'string') return { error: `${platform} must be text or null` };
    if (key === 'minAppVersion') {
      if (!VERSION.test(text)) return { error: `${platform} must be a version like 1.2.0` };
    } else {
      let url: URL;
      try { url = new URL(text); } catch { return { error: `${platform} must be a link` }; }
      if (url.protocol !== 'https:' || url.hostname !== STORE_HOSTS[platform] || text.length > 300) {
        return { error: `${platform} must be an https link on ${STORE_HOSTS[platform]}` };
      }
    }
    out[platform] = text;
  }
  return out as Record<AppPlatform, string | null>;
}

/** -1, 0 or 1, comparing x.y.z versions number by number. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

type Row = { key: AppSettingKey; value: unknown; changed_by: string; changed_at: string; note: string };

export class AppSettingsStore {
  private cache: { at: number; settings: AppSettings } | null = null;

  /** The settings in force. Without a database: the defaults. */
  async current(now = Date.now()): Promise<AppSettings> {
    if (!process.env.DATABASE_URL) return defaultAppSettings();
    if (this.cache && now - this.cache.at < APP_SETTINGS_CACHE_MS) return this.cache.settings;
    const { settings } = await this.read();
    this.cache = { at: now, settings };
    return settings;
  }

  /** How long a new or re-sighted hazard of this type stays on the map. */
  async hazardTtlMs(type: HazardType): Promise<number> {
    const minutes = (await this.current()).hazardMinutes[type];
    // A type added after the setting was saved gets its built-in lifetime.
    return typeof minutes === 'number' ? minutes * 60_000 : ttlMsForType(type);
  }

  /** The settings, and who last changed each, for the Staff Hub. */
  async read(): Promise<{ settings: AppSettings; changes: Partial<Record<AppSettingKey, AppSettingChange>> }> {
    await ensureMigrated();
    const { rows } = await getPool().query<Row>('SELECT key, value, changed_by, changed_at, note FROM app_settings');
    const settings = defaultAppSettings();
    const changes: Partial<Record<AppSettingKey, AppSettingChange>> = {};
    for (const row of rows) {
      if (!isAppSettingKey(row.key)) continue;
      // A stored value that no longer parses (a type renamed) keeps the default.
      const parsed = parseAppSetting(row.key, row.value);
      if (!('error' in parsed)) (settings as unknown as Record<string, unknown>)[row.key] = parsed;
      changes[row.key] = { changedBy: row.changed_by, changedAt: Number(row.changed_at), note: row.note };
    }
    return { settings, changes };
  }

  /** Saves one setting and records it in the audit log, in one transaction. */
  async set<K extends AppSettingKey>(key: K, value: AppSettings[K], staffId: string, note: string, now = Date.now()): Promise<void> {
    await ensureMigrated();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO app_settings (key, value, changed_by, changed_at, note) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, changed_by = EXCLUDED.changed_by,
           changed_at = EXCLUDED.changed_at, note = EXCLUDED.note`,
        [key, JSON.stringify(value), staffId, now, note],
      );
      await client.query(
        `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at, content_ref)
         VALUES ($1, $2, $2, NULL, 'app_setting_change', $3, $4, $5)`,
        [randomUUID(), staffId, note, now, key],
      );
    });
    this.cache = null;
  }

  /** Tests only: forget what was read. */
  clearCache(): void { this.cache = null; }
}

export const appSettings = new AppSettingsStore();
