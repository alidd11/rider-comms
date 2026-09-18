import { randomUUID } from 'node:crypto';
import {
  HIDE_NET_DENIAL_THRESHOLD,
  ttlMsForType,
} from '@rider-comms/shared';
import type { HazardReport, HazardType } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

export type VoteResult = { ok: true } | { ok: false; reason: 'not_found' };

export const HAZARD_SEARCH_RADIUS_MILES = 40;
const MILES_PER_DEGREE_LAT = 69;
const MAX_NEARBY_RESULTS = 500;

interface HazardReportRow {
  id: string;
  type: string;
  lat: number;
  lon: number;
  reported_by: string;
  created_at: string | number;
  expires_at: string | number;
  confirmations: number;
  denials: number;
}

function rowToReport(row: HazardReportRow): HazardReport {
  return {
    id: row.id,
    type: row.type as HazardType,
    lat: row.lat,
    lon: row.lon,
    reportedBy: row.reported_by,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    confirmations: row.confirmations,
    denials: row.denials,
  };
}

/**
 * Crowdsourced hazard/road reports (Waze-style: police, accidents, hazards,
 * closures, cameras), persisted in Postgres (see db.ts). `nearby()` uses an
 * indexed latitude/longitude bounding query, then verifies the exact
 * great-circle distance. It never loads the full report table.
 *
 * Voter tracking is kept in a separate `hazard_report_votes` table, apart
 * from the public `HazardReport` shape, so a rider's vote history is never
 * leaked to clients — only the aggregate confirmations/denials counts are.
 */
export class HazardStore {
  async create(type: HazardType, lat: number, lon: number, reportedBy: string): Promise<HazardReport> {
    await ensureMigrated();
    const now = Date.now();
    const report: HazardReport = {
      id: randomUUID(),
      type,
      lat,
      lon,
      reportedBy,
      createdAt: now,
      expiresAt: now + ttlMsForType(type),
      confirmations: 0,
      denials: 0,
    };
    await getPool().query(
      `INSERT INTO hazard_reports (id, type, lat, lon, reported_by, created_at, expires_at, confirmations, denials)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0)`,
      [report.id, report.type, report.lat, report.lon, report.reportedBy, report.createdAt, report.expiresAt]
    );
    return report;
  }

  /** Return active reports within 40 miles. Expiry is cleaned with one
   * indexed DELETE in the same statement; crowd-hidden reports remain out of
   * results and are removed when their normal TTL expires. */
  async nearby(lat: number, lon: number, nowMs: number): Promise<HazardReport[]> {
    await ensureMigrated();
    const latDelta = HAZARD_SEARCH_RADIUS_MILES / MILES_PER_DEGREE_LAT;
    const minLat = Math.max(-90, lat - latDelta);
    const maxLat = Math.min(90, lat + latDelta);
    const longitudeScale = MILES_PER_DEGREE_LAT * Math.abs(Math.cos(lat * Math.PI / 180));
    const lonDelta = longitudeScale < 0.000001
      ? 180
      : Math.min(180, HAZARD_SEARCH_RADIUS_MILES / longitudeScale);
    const values: unknown[] = [nowMs, minLat, maxLat, HIDE_NET_DENIAL_THRESHOLD, lat, lon];
    let longitudeClause = '';
    if (lonDelta < 180) {
      const minLon = lon - lonDelta;
      const maxLon = lon + lonDelta;
      if (minLon < -180) {
        values.push(minLon + 360, maxLon);
        longitudeClause = 'AND (lon >= $7 OR lon <= $8)';
      } else if (maxLon > 180) {
        values.push(minLon, maxLon - 360);
        longitudeClause = 'AND (lon >= $7 OR lon <= $8)';
      } else {
        values.push(minLon, maxLon);
        longitudeClause = 'AND lon BETWEEN $7 AND $8';
      }
    }
    const { rows } = await getPool().query<HazardReportRow>(
      `WITH expired AS (
         DELETE FROM hazard_reports WHERE expires_at <= $1
       )
       SELECT id, type, lat, lon, reported_by, created_at, expires_at, confirmations, denials
       FROM hazard_reports
       WHERE expires_at > $1
         AND denials - confirmations < $4
         AND lat BETWEEN $2 AND $3
         ${longitudeClause}
         AND 2 * 3958.7613 * ASIN(LEAST(1, SQRT(
           POWER(SIN(RADIANS(lat - $5) / 2), 2)
           + COS(RADIANS($5)) * COS(RADIANS(lat))
             * POWER(SIN(RADIANS(lon - $6) / 2), 2)
         ))) <= ${HAZARD_SEARCH_RADIUS_MILES}
       ORDER BY created_at DESC
       LIMIT ${MAX_NEARBY_RESULTS}`,
      values,
    );
    return rows.map(rowToReport);
  }

  async confirm(id: string, riderId: string): Promise<VoteResult> {
    return this.vote(id, riderId, 'confirm');
  }

  async deny(id: string, riderId: string): Promise<VoteResult> {
    return this.vote(id, riderId, 'deny');
  }

  private async vote(id: string, riderId: string, vote: 'confirm' | 'deny'): Promise<VoteResult> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const report = await client.query('SELECT id FROM hazard_reports WHERE id = $1 FOR UPDATE', [id]);
      if (!report.rowCount) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'not_found' };
      }

      const existing = await client.query<{ vote: 'confirm' | 'deny' }>(
        'SELECT vote FROM hazard_report_votes WHERE report_id = $1 AND rider_id = $2',
        [id, riderId],
      );
      const previousVote = existing.rows[0]?.vote;
      if (previousVote === vote) {
        await client.query('COMMIT');
        return { ok: true };
      }

      await client.query(
        `INSERT INTO hazard_report_votes (report_id, rider_id, vote)
         VALUES ($1, $2, $3)
         ON CONFLICT (report_id, rider_id) DO UPDATE SET vote = EXCLUDED.vote`,
        [id, riderId, vote],
      );
      const confirmationDelta = vote === 'confirm' ? 1 : previousVote === 'confirm' ? -1 : 0;
      const denialDelta = vote === 'deny' ? 1 : previousVote === 'deny' ? -1 : 0;
      await client.query(
        `UPDATE hazard_reports
         SET confirmations = confirmations + $2, denials = denials + $3
         WHERE id = $1`,
        [id, confirmationDelta, denialDelta],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Only the reporter may remove their own report. */
  async remove(id: string, actorId: string): Promise<boolean> {
    await ensureMigrated();
    const { rowCount } = await getPool().query('DELETE FROM hazard_reports WHERE id = $1 AND reported_by = $2', [id, actorId]);
    return Boolean(rowCount);
  }

  async get(id: string): Promise<HazardReport | undefined> {
    await ensureMigrated();
    const { rows } = await getPool().query<HazardReportRow>('SELECT * FROM hazard_reports WHERE id = $1', [id]);
    return rows[0] ? rowToReport(rows[0]) : undefined;
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    const pool = getPool();
    await pool.query('DELETE FROM hazard_reports WHERE reported_by = $1', [riderId]);
    await pool.query('DELETE FROM hazard_report_votes WHERE rider_id = $1', [riderId]);
  }
}
