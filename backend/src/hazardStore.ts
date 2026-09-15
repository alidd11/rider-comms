import { randomUUID } from 'node:crypto';
import {
  bucketId,
  getBucketCoord,
  getNeighboringBucketIds,
  isExpired,
  shouldHide,
  ttlMsForType,
} from '@rider-comms/shared';
import type { HazardReport, HazardType } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

export type VoteResult = { ok: true } | { ok: false; reason: 'not_found' };

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
 * closures, cameras), persisted in Postgres (see db.ts). Geo-bucketed the
 * same way `PresenceStore` shards riders, so `nearby()` never scans every
 * report in the system — only the reporting rider's bucket plus its 8
 * neighbors (see shared/geoBucket.ts) are fetched and filtered in memory.
 *
 * Voter tracking is kept in a separate `hazard_report_votes` table, apart
 * from the public `HazardReport` shape, so a rider's vote history is never
 * leaked to clients — only the aggregate confirmations/denials counts are.
 */
export class HazardStore {
  /** Deletes a report that's expired or been voted away, wherever it's
   * encountered — mirrors `PresenceStore.pruneStale`'s "prune as you go"
   * pattern rather than running a separate sweep. Returns true if deleted. */
  private async pruneIfDead(report: HazardReport, nowMs: number): Promise<boolean> {
    if (isExpired(report, nowMs) || shouldHide(report)) {
      const pool = getPool();
      await pool.query('DELETE FROM hazard_reports WHERE id = $1', [report.id]);
      await pool.query('DELETE FROM hazard_report_votes WHERE report_id = $1', [report.id]);
      return true;
    }
    return false;
  }

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

  /** Reports sharing this point's geo-bucket or an adjacent one, excluding
   * anything expired or hidden by crowd denial — lazily pruning those from
   * the table as they're found, same as `PresenceStore.pruneStale`. */
  async nearby(lat: number, lon: number, nowMs: number): Promise<HazardReport[]> {
    await ensureMigrated();
    const neighborIds = new Set(getNeighboringBucketIds({ lat, lon }));
    const { rows } = await getPool().query<HazardReportRow>('SELECT * FROM hazard_reports');
    const result: HazardReport[] = [];
    for (const row of rows) {
      const report = rowToReport(row);
      if (await this.pruneIfDead(report, nowMs)) continue;
      const reportBucket = bucketId(getBucketCoord({ lat: report.lat, lon: report.lon }));
      if (neighborIds.has(reportBucket)) result.push(report);
    }
    return result;
  }

  async confirm(id: string, riderId: string): Promise<VoteResult> {
    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<HazardReportRow>('SELECT * FROM hazard_reports WHERE id = $1', [id]);
    if (!rows[0]) return { ok: false, reason: 'not_found' };
    const { rowCount } = await pool.query(
      `INSERT INTO hazard_report_votes (report_id, rider_id, vote) VALUES ($1, $2, 'confirm') ON CONFLICT DO NOTHING`,
      [id, riderId]
    );
    if (rowCount) await pool.query('UPDATE hazard_reports SET confirmations = confirmations + 1 WHERE id = $1', [id]);
    return { ok: true };
  }

  async deny(id: string, riderId: string): Promise<VoteResult> {
    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<HazardReportRow>('SELECT * FROM hazard_reports WHERE id = $1', [id]);
    if (!rows[0]) return { ok: false, reason: 'not_found' };
    const { rowCount } = await pool.query(
      `INSERT INTO hazard_report_votes (report_id, rider_id, vote) VALUES ($1, $2, 'deny') ON CONFLICT DO NOTHING`,
      [id, riderId]
    );
    if (rowCount) await pool.query('UPDATE hazard_reports SET denials = denials + 1 WHERE id = $1', [id]);
    return { ok: true };
  }

  /** Only the reporter may remove their own report. */
  async remove(id: string, actorId: string): Promise<boolean> {
    await ensureMigrated();
    const pool = getPool();
    const { rowCount } = await pool.query('DELETE FROM hazard_reports WHERE id = $1 AND reported_by = $2', [id, actorId]);
    if (!rowCount) return false;
    await pool.query('DELETE FROM hazard_report_votes WHERE report_id = $1', [id]);
    return true;
  }

  async get(id: string): Promise<HazardReport | undefined> {
    await ensureMigrated();
    const { rows } = await getPool().query<HazardReportRow>('SELECT * FROM hazard_reports WHERE id = $1', [id]);
    return rows[0] ? rowToReport(rows[0]) : undefined;
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM hazard_reports WHERE reported_by = $1', [riderId]);
    for (const row of rows) {
      await pool.query('DELETE FROM hazard_reports WHERE id = $1', [row.id]);
      await pool.query('DELETE FROM hazard_report_votes WHERE report_id = $1', [row.id]);
    }
    await pool.query('DELETE FROM hazard_report_votes WHERE rider_id = $1', [riderId]);
  }
}
