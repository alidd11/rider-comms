import { randomUUID } from 'node:crypto';
import {
  HIDE_NET_DENIAL_THRESHOLD,
  ttlMsForType,
} from '@rider-comms/shared';
import type { HazardReport, HazardType } from '@rider-comms/shared';
import { ensureMigrated, getPool, withTransaction } from './db.ts';
import { latLonBoundingBox } from './geoBoundingBox.ts';

export type VoteResult = { ok: true } | { ok: false; reason: 'not_found' };

export const HAZARD_SEARCH_RADIUS_MILES = 40;
const MAX_NEARBY_RESULTS = 500;
/** Another report of the same type this close is the same hazard. */
export const DUPLICATE_RADIUS_METERS = 150;

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
 * Crowdsourced road reports (police, accidents, closures and
 * cameras), persisted in Postgres (see db.ts). `nearby()` uses an
 * indexed latitude/longitude bounding query, then verifies the exact
 * great-circle distance. It never loads the full report table.
 *
 * Voter tracking is kept in a separate `hazard_report_votes` table, apart
 * from the public `HazardReport` shape, so a rider's vote history is never
 * leaked to clients — only the aggregate confirmations/denials counts are.
 */
export class HazardStore {
  /**
   * A new report, or, when an active report of the same type is already
   * within DUPLICATE_RADIUS_METERS, that report: another rider's sighting
   * counts as a confirmation and keeps it alive for a full lifetime from
   * now, instead of putting a second pin on the same spot.
   */
  async create(type: HazardType, lat: number, lon: number, reportedBy: string): Promise<HazardReport> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const now = Date.now();
      const expiresAt = now + ttlMsForType(type);
      // One report of a type at a time, so two riders reporting the same
      // spot at once can't both miss each other's report.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`hazard_create:${type}`]);
      const box = latLonBoundingBox({ lat, lon }, DUPLICATE_RADIUS_METERS / 1609.344, 8);
      const duplicate = await client.query<HazardReportRow>(
        `SELECT id, type, lat, lon, reported_by, created_at, expires_at, confirmations, denials
         FROM hazard_reports
         WHERE type = $1
           AND expires_at > $2
           AND denials - confirmations < $3
           AND lat BETWEEN $4 AND $5
           ${box.longitudeClause}
           AND 2 * 6371008.8 * ASIN(LEAST(1, SQRT(
             POWER(SIN(RADIANS(lat - $6) / 2), 2)
             + COS(RADIANS($6)) * COS(RADIANS(lat))
               * POWER(SIN(RADIANS(lon - $7) / 2), 2)
           ))) <= ${DUPLICATE_RADIUS_METERS}
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [type, now, HIDE_NET_DENIAL_THRESHOLD, box.minLat, box.maxLat, lat, lon, ...box.longitudeParams],
      );
      const existing = duplicate.rows[0];
      if (existing) {
        let confirmationDelta = 0;
        let denialDelta = 0;
        if (existing.reported_by !== reportedBy) {
          const previous = await client.query<{ vote: 'confirm' | 'deny' }>(
            'SELECT vote FROM hazard_report_votes WHERE report_id = $1 AND rider_id = $2',
            [existing.id, reportedBy],
          );
          const previousVote = previous.rows[0]?.vote;
          await client.query(
            `INSERT INTO hazard_report_votes (report_id, rider_id, vote)
             VALUES ($1, $2, 'confirm')
             ON CONFLICT (report_id, rider_id) DO UPDATE SET vote = 'confirm'`,
            [existing.id, reportedBy],
          );
          confirmationDelta = previousVote === 'confirm' ? 0 : 1;
          denialDelta = previousVote === 'deny' ? -1 : 0;
        }
        const updated = await client.query<HazardReportRow>(
          `UPDATE hazard_reports
           SET confirmations = confirmations + $2,
               denials = denials + $3,
               expires_at = GREATEST(expires_at, $4)
           WHERE id = $1
           RETURNING id, type, lat, lon, reported_by, created_at, expires_at, confirmations, denials`,
          [existing.id, confirmationDelta, denialDelta, expiresAt],
        );
        return rowToReport(updated.rows[0]!);
      }
      const report: HazardReport = {
        id: randomUUID(),
        type,
        lat,
        lon,
        reportedBy,
        createdAt: now,
        expiresAt,
        confirmations: 0,
        denials: 0,
      };
      await client.query(
        `INSERT INTO hazard_reports (id, type, lat, lon, reported_by, created_at, expires_at, confirmations, denials)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0)`,
        [report.id, report.type, report.lat, report.lon, report.reportedBy, report.createdAt, report.expiresAt],
      );
      return report;
    });
  }

  /** Return active reports within 40 miles. Expiry is cleaned with one
   * indexed DELETE in the same statement; crowd-hidden reports remain out of
   * results and are removed when their normal TTL expires. */
  async nearby(lat: number, lon: number, nowMs: number): Promise<HazardReport[]> {
    await ensureMigrated();
    const box = latLonBoundingBox({ lat, lon }, HAZARD_SEARCH_RADIUS_MILES, 7);
    const { minLat, maxLat, longitudeClause } = box;
    const values: unknown[] = [nowMs, minLat, maxLat, HIDE_NET_DENIAL_THRESHOLD, lat, lon, ...box.longitudeParams];
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
    return withTransaction(async (client) => {
      const report = await client.query<{ reported_by: string }>(
        'SELECT reported_by FROM hazard_reports WHERE id = $1 AND expires_at > $2 FOR UPDATE',
        [id, Date.now()],
      );
      if (!report.rowCount) {
        return { ok: false, reason: 'not_found' };
      }
      // A reporter's own vote doesn't count: confirming your own report would
      // let one rider outweigh an honest denial. Accepted silently, since the
      // reporter's id is never published and the app can't hide the button.
      if (report.rows[0]?.reported_by === riderId) {
        return { ok: true };
      }

      const existing = await client.query<{ vote: 'confirm' | 'deny' }>(
        'SELECT vote FROM hazard_report_votes WHERE report_id = $1 AND rider_id = $2',
        [id, riderId],
      );
      const previousVote = existing.rows[0]?.vote;
      if (previousVote === vote) {
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
      return { ok: true };
    });
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

}
