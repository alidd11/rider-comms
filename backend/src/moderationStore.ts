import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ensureMigrated, getPool } from './db.ts';
import { appendSocialEventForRiders } from './socialEventStore.ts';

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

export const REPORT_STATUSES = ['open', 'dismissed', 'actioned'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_RESOLUTIONS = ['dismiss', 'suspend'] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];
export type ModerationActionType = ReportResolution | 'unsuspend';
export const MAX_MODERATION_NOTE_LENGTH = 1000;

export interface QueuedSafetyReport extends SafetyReport {
  status: ReportStatus;
  resolvedAt: number | null;
  resolvedBy: string | null;
  /** All reports ever filed against this rider, including this one. */
  reportsAgainstRider: number;
  reportedRiderSuspended: boolean;
}

export interface ModerationAction {
  id: string;
  moderatorId: string;
  targetRiderId: string;
  reportId: string | null;
  action: ModerationActionType;
  note: string;
  createdAt: number;
}

export type ResolveReportResult =
  | { ok: true; action: ModerationAction; resolvedReportIds: string[] }
  | { ok: false; error: 'not_found' | 'already_resolved' | 'forbidden_target' };

export type UnsuspendResult =
  | { ok: true; action: ModerationAction }
  | { ok: false; error: 'not_found' | 'not_suspended' };

interface QueuedReportRow {
  id: string;
  reporter_id: string;
  reported_rider_id: string;
  reason: ReportReason;
  details: string;
  created_at: string | number;
  status: ReportStatus;
  resolved_at: string | number | null;
  resolved_by: string | null;
  reports_against_rider: string | number;
  reported_rider_suspended: boolean;
}

interface ModerationActionRow {
  id: string;
  moderator_id: string;
  target_rider_id: string;
  report_id: string | null;
  action: ModerationActionType;
  note: string;
  created_at: string | number;
}

function toModerationAction(row: ModerationActionRow): ModerationAction {
  return {
    id: row.id,
    moderatorId: row.moderator_id,
    targetRiderId: row.target_rider_id,
    reportId: row.report_id,
    action: row.action,
    note: row.note,
    createdAt: Number(row.created_at),
  };
}

/** Blocks and safety reports, persisted in Postgres (see db.ts) and routed
 * to a staffed moderation workflow before user content launches. */
export interface BlockedRiderSummary { riderId: string; displayName: string; handle: string; blockedAt: number }

export class ModerationStore {
  private async lockPair(client: PoolClient, a: string, b: string): Promise<void> {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended(LEAST($1::text, $2::text) || ':' || GREATEST($1::text, $2::text), 0)
       )`,
      [a, b],
    );
  }

  /**
   * Blocking is the authoritative relationship teardown for the pair. It
   * shares the same advisory pair lock as friendship creation/removal, so a
   * concurrent friend request or acceptance cannot commit "through" a block.
   */
  async block(riderId: string, blockedRiderId: string): Promise<void> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await this.lockPair(client, riderId, blockedRiderId);
      const blockInserted = await client.query(
        'INSERT INTO rider_blocks (rider_id, blocked_rider_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (rider_id, blocked_rider_id) DO NOTHING',
        [riderId, blockedRiderId, Date.now()]
      );
      const removedFriendships = await client.query(
        `DELETE FROM friendships
         WHERE (rider_id = $1 AND friend_id = $2)
            OR (rider_id = $2 AND friend_id = $1)
         RETURNING rider_id, friend_id`,
        [riderId, blockedRiderId],
      );
      const removedRequests = await client.query<{ id: string }>(
        `DELETE FROM friend_requests
         WHERE status = 'pending'
           AND ((from_rider_id = $1 AND to_rider_id = $2)
             OR (from_rider_id = $2 AND to_rider_id = $1))
         RETURNING id`,
        [riderId, blockedRiderId],
      );
      // Realtime invalidation deliberately stays generic: the affected peer
      // learns only that the relationship/request disappeared, never that a
      // block was the reason.
      if ((removedFriendships.rowCount ?? 0) > 0) {
        await appendSocialEventForRiders(client, [riderId, blockedRiderId], 'friend_removed', riderId, riderId);
      }
      for (const request of removedRequests.rows) {
        await appendSocialEventForRiders(client, [riderId, blockedRiderId], 'friend_request_resolved', riderId, request.id);
      }
      // A direct hideout share is effectively a location-sharing link
      // between its creator and participant. Remove that direct link when
      // either side blocks the other; third-party group hideouts remain
      // intact and are filtered per viewer by the API.
      await client.query(
        `DELETE FROM hideout_participants participant
         USING hideouts hideout
         WHERE participant.hideout_id = hideout.id
           AND ((hideout.created_by = $1 AND participant.rider_id = $2)
             OR (hideout.created_by = $2 AND participant.rider_id = $1))`,
        [riderId, blockedRiderId],
      );
      if ((blockInserted.rowCount ?? 0) > 0) {
        await appendSocialEventForRiders(client, [riderId], 'social_refresh', riderId, 'blocks');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async unblock(riderId: string, blockedRiderId: string): Promise<void> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const removed = await client.query(
        'DELETE FROM rider_blocks WHERE rider_id = $1 AND blocked_rider_id = $2',
        [riderId, blockedRiderId],
      );
      if ((removed.rowCount ?? 0) > 0) {
        await appendSocialEventForRiders(client, [riderId], 'social_refresh', riderId, 'blocks');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getBlocked(riderId: string): Promise<string[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ blocked_rider_id: string }>(
      'SELECT blocked_rider_id FROM rider_blocks WHERE rider_id = $1',
      [riderId]
    );
    return rows.map((row) => row.blocked_rider_id);
  }

  /** The rider's own block list with names, for the "Blocked riders" screen. */
  async getBlockedSummaries(riderId: string): Promise<BlockedRiderSummary[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ rider_id: string; display_name: string | null; handle: string | null; blocked_at: string | number }>(
      `SELECT b.blocked_rider_id AS rider_id, p.display_name, p.handle, b.created_at AS blocked_at
       FROM rider_blocks b
       LEFT JOIN rider_profiles p ON p.rider_id = b.blocked_rider_id
       WHERE b.rider_id = $1
       ORDER BY b.created_at DESC`,
      [riderId]
    );
    return rows.map((row) => ({
      riderId: row.rider_id,
      displayName: row.display_name ?? 'Rider',
      handle: row.handle ?? '',
      blockedAt: Number(row.blocked_at),
    }));
  }

  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    await ensureMigrated();
    const { rows } = await getPool().query(
      'SELECT 1 FROM rider_blocks WHERE (rider_id = $1 AND blocked_rider_id = $2) OR (rider_id = $2 AND blocked_rider_id = $1)',
      [a, b]
    );
    return rows.length > 0;
  }

  /** Whether any listed rider has explicitly blocked this rider. This is
   * directional on purpose: the blocker may stay in a private ride voice room
   * after the blocked participant is ejected, while the blocked participant
   * cannot obtain a fresh token back into that shared room. */
  async isBlockedByAny(riderId: string, possibleBlockerIds: string[]): Promise<boolean> {
    const blockerIds = [...new Set(possibleBlockerIds.filter((id) => id !== riderId))];
    if (blockerIds.length === 0) return false;
    await ensureMigrated();
    const { rows } = await getPool().query(
      `SELECT 1 FROM rider_blocks
       WHERE blocked_rider_id = $1 AND rider_id = ANY($2::text[])
       LIMIT 1`,
      [riderId, blockerIds],
    );
    return rows.length > 0;
  }

  /**
   * Bulk block filtering for presence/voice/group social responses. This
   * avoids an N+1 block lookup for every nearby peer while preserving the
   * caller's input order.
   */
  async filterAllowedPeerIds(riderId: string, peerIds: string[]): Promise<string[]> {
    const uniquePeerIds = [...new Set(peerIds.filter((peerId) => peerId !== riderId))];
    if (uniquePeerIds.length === 0) return [];
    await ensureMigrated();
    const { rows } = await getPool().query<{ peer_id: string }>(
      `SELECT CASE WHEN rider_id = $1 THEN blocked_rider_id ELSE rider_id END AS peer_id
       FROM rider_blocks
       WHERE (rider_id = $1 AND blocked_rider_id = ANY($2::text[]))
          OR (blocked_rider_id = $1 AND rider_id = ANY($2::text[]))`,
      [riderId, uniquePeerIds],
    );
    const blocked = new Set(rows.map((row) => row.peer_id));
    return uniquePeerIds.filter((peerId) => !blocked.has(peerId));
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

  /** The moderation queue: oldest open reports first by default, so reports
   * are handled in the order they arrived. */
  async listReports(status: ReportStatus = 'open', limit = 50): Promise<QueuedSafetyReport[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<QueuedReportRow>(
      `SELECT report.id, report.reporter_id, report.reported_rider_id, report.reason, report.details,
              report.created_at, report.status, report.resolved_at, report.resolved_by,
              (SELECT count(*) FROM safety_reports other WHERE other.reported_rider_id = report.reported_rider_id)
                AS reports_against_rider,
              COALESCE(u.suspended_at IS NOT NULL, FALSE) AS reported_rider_suspended
       FROM safety_reports report
       LEFT JOIN users u ON u.id = report.reported_rider_id
       WHERE report.status = $1
       ORDER BY report.created_at ${status === 'open' ? 'ASC' : 'DESC'}, report.id
       LIMIT $2`,
      [status, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      reporterId: row.reporter_id,
      reportedRiderId: row.reported_rider_id,
      reason: row.reason,
      details: row.details,
      createdAt: Number(row.created_at),
      status: row.status,
      resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
      resolvedBy: row.resolved_by,
      reportsAgainstRider: Number(row.reports_against_rider),
      reportedRiderSuspended: row.reported_rider_suspended,
    }));
  }

  /**
   * Resolves an open report. `suspend` also suspends the reported rider
   * (sign-in refused, every session revoked) and closes every other open
   * report against them as actioned. Moderators cannot act on themselves or
   * on another admin. The decision is recorded in the audit log in the same
   * transaction.
   */
  async resolveReport(
    reportId: string,
    moderatorId: string,
    resolution: ReportResolution,
    note: string,
    now = Date.now(),
  ): Promise<ResolveReportResult> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ reported_rider_id: string; status: ReportStatus }>(
        'SELECT reported_rider_id, status FROM safety_reports WHERE id = $1 FOR UPDATE',
        [reportId],
      );
      const report = rows[0];
      if (!report) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'not_found' };
      }
      if (report.status !== 'open') {
        await client.query('ROLLBACK');
        return { ok: false, error: 'already_resolved' };
      }
      const targetRiderId = report.reported_rider_id;
      if (resolution === 'suspend') {
        const target = await client.query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id = $1 FOR UPDATE', [targetRiderId]);
        if (targetRiderId === moderatorId || target.rows[0]?.is_admin === true) {
          await client.query('ROLLBACK');
          return { ok: false, error: 'forbidden_target' };
        }
        await client.query('UPDATE users SET suspended_at = $2 WHERE id = $1 AND suspended_at IS NULL', [targetRiderId, now]);
        await client.query('DELETE FROM account_sessions WHERE user_id = $1', [targetRiderId]);
      }
      const resolved = await client.query<{ id: string }>(
        resolution === 'suspend'
          ? `UPDATE safety_reports SET status = 'actioned', resolved_at = $2, resolved_by = $3
             WHERE status = 'open' AND (id = $1 OR reported_rider_id = $4) RETURNING id`
          : `UPDATE safety_reports SET status = 'dismissed', resolved_at = $2, resolved_by = $3
             WHERE id = $1 RETURNING id`,
        resolution === 'suspend' ? [reportId, now, moderatorId, targetRiderId] : [reportId, now, moderatorId],
      );
      const action = await this.recordAction(client, moderatorId, targetRiderId, reportId, resolution, note, now);
      await client.query('COMMIT');
      return { ok: true, action, resolvedReportIds: resolved.rows.map((row) => row.id).sort() };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async unsuspend(riderId: string, moderatorId: string, note: string, now = Date.now()): Promise<UnsuspendResult> {
    await ensureMigrated();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ suspended_at: string | number | null }>(
        'SELECT suspended_at FROM users WHERE id = $1 FOR UPDATE',
        [riderId],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'not_found' };
      }
      if (rows[0].suspended_at === null) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'not_suspended' };
      }
      await client.query('UPDATE users SET suspended_at = NULL WHERE id = $1', [riderId]);
      const action = await this.recordAction(client, moderatorId, riderId, null, 'unsuspend', note, now);
      await client.query('COMMIT');
      return { ok: true, action };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** The moderation audit log, newest first, optionally for one rider. */
  async listActions(targetRiderId?: string, limit = 100): Promise<ModerationAction[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<ModerationActionRow>(
      `SELECT id, moderator_id, target_rider_id, report_id, action, note, created_at
       FROM moderation_actions
       WHERE $1::text IS NULL OR target_rider_id = $1
       ORDER BY created_at DESC, id
       LIMIT $2`,
      [targetRiderId ?? null, limit],
    );
    return rows.map(toModerationAction);
  }

  private async recordAction(
    client: PoolClient,
    moderatorId: string,
    targetRiderId: string,
    reportId: string | null,
    action: ModerationActionType,
    note: string,
    now: number,
  ): Promise<ModerationAction> {
    const { rows } = await client.query<ModerationActionRow>(
      `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, moderator_id, target_rider_id, report_id, action, note, created_at`,
      [randomUUID(), moderatorId, targetRiderId, reportId, action, note, now],
    );
    return toModerationAction(rows[0]!);
  }

}
