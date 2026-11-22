import type { QueuedSafetyReport } from './moderationStore.ts';
import type { SocialPost } from './socialPostStore.ts';

/** A bounded, permission-checked summary for the staff action inbox.
 * No report details, user emails, private messages or post captions are returned.
 * Source identifiers link to the existing authorised moderation workflows.
 */
export type InboxFilter = 'all' | 'rider_report' | 'social_post';
export const INBOX_FILTERS: readonly InboxFilter[] = ['all', 'rider_report', 'social_post'];
export const MAX_INBOX_PAGE_SIZE = 50;
export const INBOX_SAMPLE_SIZE = 100;

export interface InboxRiderReport {
  type: 'rider_report';
  id: string;
  reportId: string;
  riderId: string;
  eventAt: number;
  reason: string;
  claimedBy: string | null;
  assignedTo: string | null;
  reportsAgainstRider: number;
}

export interface InboxSocialPost {
  type: 'social_post';
  id: string;
  postId: string;
  riderId: string;
  eventAt: number;
  kind: SocialPost['kind'];
  reportCount: number;
  reasons: string[];
}

export type ActionInboxItem = InboxRiderReport | InboxSocialPost;
export type InboxReportSource = Pick<QueuedSafetyReport,
  'id' | 'reportedRiderId' | 'createdAt' | 'reason' | 'claimedBy' | 'assignedTo' | 'reportsAgainstRider'>;
export type InboxSocialSource = {
  post: Pick<SocialPost, 'id' | 'authorId' | 'kind'>;
  reports: number;
  reasons: string[];
  hiddenAt: number;
};

export function buildActionInbox(
  reports: readonly InboxReportSource[],
  socialPosts: readonly InboxSocialSource[],
  { limit = 25, filter = 'all', sampleLimit = INBOX_SAMPLE_SIZE, now = Date.now() }:
    { limit?: number; filter?: InboxFilter; sampleLimit?: number; now?: number } = {},
) {
  const items: ActionInboxItem[] = [];

  if (filter !== 'social_post') {
    for (const report of reports) {
      items.push({
        type: 'rider_report',
        id: `rider_report:${report.id}`,
        reportId: report.id,
        riderId: report.reportedRiderId,
        eventAt: report.createdAt,
        reason: report.reason,
        claimedBy: report.claimedBy,
        assignedTo: report.assignedTo,
        reportsAgainstRider: report.reportsAgainstRider,
      });
    }
  }
  if (filter !== 'rider_report') {
    for (const entry of socialPosts) {
      items.push({
        type: 'social_post',
        id: `social_post:${entry.post.id}`,
        postId: entry.post.id,
        riderId: entry.post.authorId,
        eventAt: entry.hiddenAt,
        kind: entry.post.kind,
        reportCount: entry.reports,
        reasons: [...entry.reasons],
      });
    }
  }

  // This order is only within each source's bounded sample. Rider reports
  // are sampled oldest-first, but hidden Social posts are sampled by report
  // count. Do not imply global prioritisation or exact queue totals.
  items.sort((a, b) => a.eventAt - b.eventAt || a.id.localeCompare(b.id));
  return {
    generatedAt: now,
    items: items.slice(0, limit),
    filter,
    limit,
    mayHaveMore: items.length > limit ||
      (filter !== 'social_post' && reports.length >= sampleLimit) ||
      (filter !== 'rider_report' && socialPosts.length >= sampleLimit),
    sourceSampleLimit: sampleLimit,
  };
}
