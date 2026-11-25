import { randomUUID } from 'node:crypto';
import { ensureMigrated, getPool, withTransaction } from './db.ts';

/**
 * Rider-posted map content for the Staff Hub's Map content page: hazards and
 * rider-made scenic routes, which every rider can see. Staff can remove an
 * item with a note; the audit row records which item it was and who posted
 * it. Hideouts are private to their members and aren't listed.
 */
export const CONTENT_KINDS = ['hazards', 'routes'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export const CONTENT_PAGE_SIZE = 50;
/** The same limits riders have when they make a route (shared/src/scenicRoutes.ts). */
export const ROUTE_NAME_MAX = 80;
export const ROUTE_DESCRIPTION_MAX = 500;

export interface HazardItem {
  id: string; type: string; lat: number; lon: number; reportedBy: string;
  createdAt: number; expiresAt: number; confirmations: number; denials: number; active: boolean;
}
export interface RouteItem {
  id: string; name: string; description: string; distanceMiles: number; difficulty: string;
  startLat: number; startLon: number; createdBy: string; createdAt: number;
}

type HazardRow = { id: string; type: string; lat: number; lon: number; reported_by: string; created_at: string; expires_at: string; confirmations: number; denials: number };
type RouteRow = { id: string; name: string; description: string; distance_miles: number; difficulty: string; start_lat: number; start_lon: number; created_by: string; created_at: string };

export class StaffContentStore {
  /** Active hazards first, the most disputed (denials) at the top. `all` adds expired ones. */
  async hazards(options: { includeExpired?: boolean; offset?: number } = {}, now = Date.now()): Promise<{ items: HazardItem[]; nextOffset: number | null }> {
    await ensureMigrated();
    const offset = options.offset ?? 0;
    const { rows } = await getPool().query<HazardRow>(
      `SELECT * FROM hazard_reports WHERE ($1 OR expires_at > $2)
       ORDER BY (expires_at > $2) DESC, denials DESC, created_at DESC, id LIMIT $3 OFFSET $4`,
      [options.includeExpired === true, now, CONTENT_PAGE_SIZE, offset],
    );
    const items = rows.map((row) => ({
      id: row.id, type: row.type, lat: row.lat, lon: row.lon, reportedBy: row.reported_by,
      createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
      confirmations: row.confirmations, denials: row.denials, active: Number(row.expires_at) > now,
    }));
    return { items, nextOffset: items.length === CONTENT_PAGE_SIZE ? offset + CONTENT_PAGE_SIZE : null };
  }

  /** Rider-made scenic routes, newest first, optionally matching a name. */
  async routes(options: { q?: string; offset?: number } = {}): Promise<{ items: RouteItem[]; nextOffset: number | null }> {
    await ensureMigrated();
    const offset = options.offset ?? 0;
    const q = (options.q ?? '').trim();
    const { rows } = await getPool().query<RouteRow>(
      `SELECT id, name, description, distance_miles, difficulty, start_lat, start_lon, created_by, created_at
       FROM scenic_routes WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR description ILIKE '%' || $1 || '%')
       ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [q.replace(/[%_\\]/g, (match) => '\\' + match), CONTENT_PAGE_SIZE, offset],
    );
    const items = rows.map((row) => ({
      id: row.id, name: row.name, description: row.description, distanceMiles: row.distance_miles, difficulty: row.difficulty,
      startLat: row.start_lat, startLon: row.start_lon, createdBy: row.created_by, createdAt: Number(row.created_at),
    }));
    return { items, nextOffset: items.length === CONTENT_PAGE_SIZE ? offset + CONTENT_PAGE_SIZE : null };
  }

  /** Renames or rewords a rider's scenic route (a typo, a misleading or unsafe description). */
  async editRoute(id: string, input: { name: string; description: string }, staffId: string, note: string, now = Date.now()): Promise<RouteItem | null> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const before = await client.query<{ name: string }>('SELECT name FROM scenic_routes WHERE id = $1 FOR UPDATE', [id]);
      if (!before.rows[0]) return null;
      const { rows } = await client.query<RouteRow>(
        `UPDATE scenic_routes SET name = $2, description = $3 WHERE id = $1
         RETURNING id, name, description, distance_miles, difficulty, start_lat, start_lon, created_by, created_at`,
        [id, input.name, input.description],
      );
      const row = { ...rows[0]!, old_name: before.rows[0].name };
      await client.query(
        `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at, content_ref)
         VALUES ($1, $2, $3, NULL, 'scenic_route_edit', $4, $5, $6)`,
        [randomUUID(), staffId, row.created_by, note, now, `route:${id}:${row.old_name}`.slice(0, 200)],
      );
      return {
        id: row.id, name: row.name, description: row.description, distanceMiles: row.distance_miles, difficulty: row.difficulty,
        startLat: row.start_lat, startLon: row.start_lon, createdBy: row.created_by, createdAt: Number(row.created_at),
      };
    });
  }

  /** Takes a hazard off every rider's map now but keeps its record, unlike Remove. */
  async expireHazard(id: string, staffId: string, note: string, now = Date.now()): Promise<boolean> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const { rows } = await client.query<{ owner: string; label: string }>(
        'UPDATE hazard_reports SET expires_at = $2 WHERE id = $1 AND expires_at > $2 RETURNING reported_by AS owner, type AS label',
        [id, now],
      );
      const row = rows[0];
      if (!row) return false;
      await client.query(
        `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at, content_ref)
         VALUES ($1, $2, $3, NULL, 'hazard_expire', $4, $5, $6)`,
        [randomUUID(), staffId, row.owner, note, now, `hazard:${id}:${row.label}`.slice(0, 200)],
      );
      return true;
    });
  }

  /** Deletes the item and records it in the audit log, in one transaction. */
  async remove(kind: ContentKind, id: string, staffId: string, note: string, now = Date.now()): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const deleted = kind === 'hazards'
        ? await client.query<{ owner: string; label: string }>(
          'DELETE FROM hazard_reports WHERE id = $1 RETURNING reported_by AS owner, type AS label', [id])
        : await client.query<{ owner: string; label: string }>(
          'DELETE FROM scenic_routes WHERE id = $1 RETURNING created_by AS owner, name AS label', [id]);
      const row = deleted.rows[0];
      if (!row) return { ok: false, error: 'not_found' } as const;
      await client.query(
        `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at, content_ref)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)`,
        [randomUUID(), staffId, row.owner, kind === 'hazards' ? 'hazard_remove' : 'scenic_route_remove', note, now,
          `${kind === 'hazards' ? 'hazard' : 'route'}:${id}:${row.label}`.slice(0, 200)],
      );
      return { ok: true } as const;
    });
  }
}

export const staffContentStore = new StaffContentStore();
