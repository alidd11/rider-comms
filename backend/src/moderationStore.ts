import { randomUUID } from 'node:crypto';
import { ensureMigrated, getPool } from './db.ts';

export const REPORT_REASONS = ['harassment', 'unsafe', 'spam', 'sexual', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface SafetyReport {
  id: string;
  reporterId: string;
  reportedRiderId: string;
  reason: ReportReason;
  details: string;
  createdAt: number;
}

/** Blocks and safety reports, persisted in Postgres (see db.ts) and routed
 * to a staffed moderation workflow before user content launches. */
export class ModerationStore {
  async block(riderId: string, blockedRiderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query(
      'INSERT INTO rider_blocks (rider_id, blocked_rider_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (rider_id, blocked_rider_id) DO NOTHING',
      [riderId, blockedRiderId, Date.now()]
    );
  }

  async unblock(riderId: string, blockedRiderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM rider_blocks WHERE rider_id = $1 AND blocked_rider_id = $2', [riderId, blockedRiderId]);
  }

  async getBlocked(riderId: string): Promise<string[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ blocked_rider_id: string }>(
      'SELECT blocked_rider_id FROM rider_blocks WHERE rider_id = $1',
      [riderId]
    );
    return rows.map((row) => row.blocked_rider_id);
  }

  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    await ensureMigrated();
    const { rows } = await getPool().query(
      'SELECT 1 FROM rider_blocks WHERE (rider_id = $1 AND blocked_rider_id = $2) OR (rider_id = $2 AND blocked_rider_id = $1)',
      [a, b]
    );
    return rows.length > 0;
  }

  async report(reporterId: string, reportedRiderId: string, reason: ReportReason, details: string): Promise<SafetyReport> {
    await ensureMigrated();
    const report: SafetyReport = { id: randomUUID(), reporterId, reportedRiderId, reason, details, createdAt: Date.now() };
    await getPool().query(
      'INSERT INTO safety_reports (id, reporter_id, reported_rider_id, reason, details, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [report.id, report.reporterId, report.reportedRiderId, report.reason, report.details, report.createdAt]
    );
    return report;
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    const pool = getPool();
    await pool.query('DELETE FROM rider_blocks WHERE rider_id = $1 OR blocked_rider_id = $1', [riderId]);
    await pool.query('DELETE FROM safety_reports WHERE reporter_id = $1 OR reported_rider_id = $1', [riderId]);
  }
}
