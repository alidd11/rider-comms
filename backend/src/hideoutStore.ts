import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Hideout } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

export type DeleteHideoutResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'forbidden' };

interface HideoutRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  created_by: string;
  created_at: string | number;
}

type HideoutClient = Pick<PoolClient, 'query' | 'release'>;
type HideoutPool = Pick<Pool, 'query' | 'connect'>;

interface HideoutDependencies {
  ensureMigrated: () => Promise<void>;
  getPool: () => HideoutPool;
}

const defaultDependencies: HideoutDependencies = {
  ensureMigrated,
  getPool,
};

function rowToHideout(row: HideoutRow, participantIds: string[]): Hideout {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    createdBy: row.created_by,
    participantIds,
    createdAt: Number(row.created_at),
  };
}

/** Saved meeting points a group of friends is planning around, persisted in
 * Postgres (see db.ts). Participants live in a separate junction table
 * (`hideout_participants`) since a hideout has a variable-length list of
 * them. */
export class HideoutStore {
  private readonly dependencies: HideoutDependencies;

  constructor(dependencies: HideoutDependencies = defaultDependencies) {
    this.dependencies = dependencies;
  }

  private async participantsFor(hideoutIds: string[]): Promise<Map<string, string[]>> {
    const byHideout = new Map<string, string[]>();
    if (hideoutIds.length === 0) return byHideout;
    const { rows } = await this.dependencies.getPool().query<{ hideout_id: string; rider_id: string }>(
      'SELECT hideout_id, rider_id FROM hideout_participants WHERE hideout_id = ANY($1)',
      [hideoutIds]
    );
    for (const row of rows) {
      const list = byHideout.get(row.hideout_id) ?? [];
      list.push(row.rider_id);
      byHideout.set(row.hideout_id, list);
    }
    return byHideout;
  }

  async create(input: {
    name: string;
    lat: number;
    lon: number;
    createdBy: string;
    participantIds: string[];
  }): Promise<Hideout> {
    await this.dependencies.ensureMigrated();
    const client = await this.dependencies.getPool().connect() as HideoutClient;
    const hideout: Hideout = {
      id: randomUUID(),
      name: input.name,
      lat: input.lat,
      lon: input.lon,
      createdBy: input.createdBy,
      participantIds: input.participantIds,
      createdAt: Date.now(),
    };
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO hideouts (id, name, lat, lon, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [hideout.id, hideout.name, hideout.lat, hideout.lon, hideout.createdBy, hideout.createdAt]
      );
      for (const participantId of input.participantIds) {
        await client.query('INSERT INTO hideout_participants (hideout_id, rider_id) VALUES ($1, $2)', [hideout.id, participantId]);
      }
      await client.query('COMMIT');
      return hideout;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getForRider(riderId: string): Promise<Hideout[]> {
    await this.dependencies.ensureMigrated();
    const pool = this.dependencies.getPool();
    const { rows } = await pool.query<HideoutRow>(
      `SELECT DISTINCT h.* FROM hideouts h
       LEFT JOIN hideout_participants p ON p.hideout_id = h.id
       WHERE h.created_by = $1 OR p.rider_id = $1`,
      [riderId]
    );
    const participantsByHideout = await this.participantsFor(rows.map((row) => row.id));
    return rows.map((row) => rowToHideout(row, participantsByHideout.get(row.id) ?? []));
  }

  async delete(hideoutId: string, riderId: string): Promise<DeleteHideoutResult> {
    await this.dependencies.ensureMigrated();
    const pool = this.dependencies.getPool();
    const { rows } = await pool.query<HideoutRow>('SELECT * FROM hideouts WHERE id = $1', [hideoutId]);
    const hideout = rows[0];
    if (!hideout) {
      return { ok: false, error: 'not_found' };
    }
    if (hideout.created_by !== riderId) {
      return { ok: false, error: 'forbidden' };
    }
    await pool.query('DELETE FROM hideouts WHERE id = $1', [hideoutId]);
    return { ok: true };
  }

  async deleteRider(riderId: string): Promise<void> {
    await this.dependencies.ensureMigrated();
    const pool = this.dependencies.getPool();
    await pool.query('DELETE FROM hideouts WHERE created_by = $1', [riderId]);
    await pool.query('DELETE FROM hideout_participants WHERE rider_id = $1', [riderId]);
  }
}
