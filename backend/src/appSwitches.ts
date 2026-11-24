import { randomUUID } from 'node:crypto';
import { ensureMigrated, getPool, withTransaction } from './db.ts';

/**
 * Switches an admin can flip in the Staff Hub to pause a feature for every
 * rider at once, without a deploy: new sign-ups, Social posting and Nearby
 * Voice. Every switch starts on. A paused switch only takes a feature away;
 * it never turns on something the server isn't set up for. Each change needs
 * a note and is written to the audit log.
 */
export const APP_SWITCHES = ['signups', 'social_posting', 'nearby_voice'] as const;
export type AppSwitch = (typeof APP_SWITCHES)[number];

export interface AppSwitchState {
  key: AppSwitch;
  on: boolean;
  changedBy: string | null;
  changedAt: number | null;
  note: string | null;
}

/** How long a replica trusts what it last read; a change on another replica shows within this. */
export const APP_SWITCH_CACHE_MS = 10_000;

export const isAppSwitch = (value: unknown): value is AppSwitch => (APP_SWITCHES as readonly unknown[]).includes(value);

type Row = { key: AppSwitch; enabled: boolean; changed_by: string; changed_at: string; note: string };

export class AppSwitchStore {
  private cache: { at: number; paused: Set<AppSwitch> } | null = null;

  /** Whether a feature is on. Without a database nothing can be paused. */
  async isOn(key: AppSwitch, now = Date.now()): Promise<boolean> {
    if (!process.env.DATABASE_URL) return true;
    if (!this.cache || now - this.cache.at >= APP_SWITCH_CACHE_MS) {
      await ensureMigrated();
      const { rows } = await getPool().query<{ key: AppSwitch }>('SELECT key FROM app_switches WHERE NOT enabled');
      this.cache = { at: now, paused: new Set(rows.map((row) => row.key)) };
    }
    return !this.cache.paused.has(key);
  }

  async list(): Promise<AppSwitchState[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<Row>('SELECT key, enabled, changed_by, changed_at, note FROM app_switches');
    return APP_SWITCHES.map((key) => {
      const row = rows.find((candidate) => candidate.key === key);
      return row
        ? { key, on: row.enabled, changedBy: row.changed_by, changedAt: Number(row.changed_at), note: row.note }
        : { key, on: true, changedBy: null, changedAt: null, note: null };
    });
  }

  /** Turns a switch on or off and records it in the audit log, in one transaction. */
  async set(key: AppSwitch, on: boolean, staffId: string, note: string, now = Date.now()): Promise<AppSwitchState> {
    await ensureMigrated();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO app_switches (key, enabled, changed_by, changed_at, note) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, changed_by = EXCLUDED.changed_by,
           changed_at = EXCLUDED.changed_at, note = EXCLUDED.note`,
        [key, on, staffId, now, note],
      );
      await client.query(
        `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at, content_ref)
         VALUES ($1, $2, $2, NULL, $3, $4, $5, $6)`,
        [randomUUID(), staffId, on ? 'app_switch_on' : 'app_switch_off', note, now, key],
      );
    });
    this.cache = null;
    return { key, on, changedBy: staffId, changedAt: now, note };
  }

  /** Tests only: forget what was read. */
  clearCache(): void { this.cache = null; }
}

export const appSwitches = new AppSwitchStore();
