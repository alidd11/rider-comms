import { randomUUID } from 'node:crypto';

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

/** In-memory prototype moderation state. Production must persist reports and
 * route them to a staffed moderation workflow before user content launches. */
export class ModerationStore {
  private blockedByRider = new Map<string, Set<string>>();
  private reports: SafetyReport[] = [];

  block(riderId: string, blockedRiderId: string): void {
    const blocked = this.blockedByRider.get(riderId) ?? new Set<string>();
    blocked.add(blockedRiderId);
    this.blockedByRider.set(riderId, blocked);
  }

  unblock(riderId: string, blockedRiderId: string): void {
    this.blockedByRider.get(riderId)?.delete(blockedRiderId);
  }

  getBlocked(riderId: string): string[] {
    return [...(this.blockedByRider.get(riderId) ?? [])];
  }

  isBlockedBetween(a: string, b: string): boolean {
    return (this.blockedByRider.get(a)?.has(b) ?? false) ||
      (this.blockedByRider.get(b)?.has(a) ?? false);
  }

  report(reporterId: string, reportedRiderId: string, reason: ReportReason, details: string): SafetyReport {
    const report = { id: randomUUID(), reporterId, reportedRiderId, reason, details, createdAt: Date.now() };
    this.reports.push(report);
    return report;
  }

  deleteRider(riderId: string): void {
    this.blockedByRider.delete(riderId);
    for (const blocked of this.blockedByRider.values()) blocked.delete(riderId);
    this.reports = this.reports.filter((report) => report.reporterId !== riderId && report.reportedRiderId !== riderId);
  }
}
