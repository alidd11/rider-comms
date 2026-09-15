import { randomUUID } from 'node:crypto';
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
  private async participantsFor(hideoutIds: string[]): Promise<Map<string, string[]>> {
    const byHideout = new Map<string, string[]>();
    if (hideoutIds.length === 0) return byHideout;
    const { rows } = await getPool().query<{ hideout_id: string; rider_id: string }>(
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
    await ensureMigrated();
    const pool = getPool();
    const hideout: Hideout = {
      id: randomUUID(),
      name: input.name,
      lat: input.lat,
      lon: input.lon,
      createdBy: input.createdBy,
      participantIds: input.participantIds,
      createdAt: Date.now(),
    };
    await pool.query(
      'INSERT INTO hideouts (id, name, lat, lon, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [hideout.id, hideout.name, hideout.lat, hideout.lon, hideout.createdBy, hideout.createdAt]
    );
    for (const participantId of input.participantIds) {
      await pool.query('INSERT INTO hideout_participants (hideout_id, rider_id) VALUES ($1, $2)', [hideout.id, participantId]);
    }
    return hideout;
  }

  async getForRider(riderId: string): Promise<Hideout[]> {
    await ensureMigrated();
    const pool = getPool();
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
    await ensureMigrated();
    const pool = getPool();
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
    await ensureMigrated();
    const pool = getPool();
    await pool.query('DELETE FROM hideouts WHERE created_by = $1', [riderId]);
    await pool.query('DELETE FROM hideout_participants WHERE rider_id = $1', [riderId]);
  }
}
