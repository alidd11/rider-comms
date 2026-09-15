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

export type VoteResult = { ok: true } | { ok: false; reason: 'not_found' };

interface VoterRecord {
  confirmedBy: Set<string>;
  deniedBy: Set<string>;
}

/**
 * Crowdsourced hazard/road reports (Waze-style: police, accidents, hazards,
 * closures, cameras). Geo-bucketed the same way `PresenceStore` shards
 * riders, so `nearby()` never scans every report in the system — only the
 * reporting rider's bucket plus its 8 neighbors (see shared/geoBucket.ts).
 *
 * Voter tracking (`confirmedBy`/`deniedBy`) is kept in a parallel map,
 * separate from the public `HazardReport` shape, so a rider's vote history
 * is never leaked to clients — only the aggregate confirmations/denials
 * counts are.
 */
export class HazardStore {
  private reports = new Map<string, HazardReport>();
  private voters = new Map<string, VoterRecord>();

  /** Drops any report that's expired or been voted away, wherever it's
   * encountered — mirrors `PresenceStore.pruneStale`'s "prune as you go"
   * pattern rather than running a separate sweep. */
  private pruneIfDead(report: HazardReport, nowMs: number): boolean {
    if (isExpired(report, nowMs) || shouldHide(report)) {
      this.reports.delete(report.id);
      this.voters.delete(report.id);
      return true;
    }
    return false;
  }

  create(type: HazardType, lat: number, lon: number, reportedBy: string): HazardReport {
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
    this.reports.set(report.id, report);
    this.voters.set(report.id, { confirmedBy: new Set(), deniedBy: new Set() });
    return report;
  }

  /** Reports sharing this point's geo-bucket or an adjacent one, excluding
   * anything expired or hidden by crowd denial — lazily pruning those from
   * the map as they're found, same as `PresenceStore.pruneStale`. */
  nearby(lat: number, lon: number, nowMs: number): HazardReport[] {
    const neighborIds = new Set(getNeighboringBucketIds({ lat, lon }));
    const result: HazardReport[] = [];
    for (const report of [...this.reports.values()]) {
      if (this.pruneIfDead(report, nowMs)) continue;
      const reportBucket = bucketId(getBucketCoord({ lat: report.lat, lon: report.lon }));
      if (neighborIds.has(reportBucket)) result.push(report);
    }
    return result;
  }

  confirm(id: string, riderId: string): VoteResult {
    const report = this.reports.get(id);
    const voterRecord = this.voters.get(id);
    if (!report || !voterRecord) return { ok: false, reason: 'not_found' };
    if (!voterRecord.confirmedBy.has(riderId)) {
      voterRecord.confirmedBy.add(riderId);
      report.confirmations += 1;
    }
    return { ok: true };
  }

  deny(id: string, riderId: string): VoteResult {
    const report = this.reports.get(id);
    const voterRecord = this.voters.get(id);
    if (!report || !voterRecord) return { ok: false, reason: 'not_found' };
    if (!voterRecord.deniedBy.has(riderId)) {
      voterRecord.deniedBy.add(riderId);
      report.denials += 1;
    }
    return { ok: true };
  }

  /** Only the reporter may remove their own report. */
  remove(id: string, actorId: string): boolean {
    const report = this.reports.get(id);
    if (!report || report.reportedBy !== actorId) return false;
    this.reports.delete(id);
    this.voters.delete(id);
    return true;
  }

  get(id: string): HazardReport | undefined {
    return this.reports.get(id);
  }

  deleteRider(riderId: string): void {
    for (const [id, report] of this.reports) {
      if (report.reportedBy === riderId) {
        this.reports.delete(id);
        this.voters.delete(id);
      }
    }
    for (const voterRecord of this.voters.values()) {
      voterRecord.confirmedBy.delete(riderId);
      voterRecord.deniedBy.delete(riderId);
    }
  }
}
