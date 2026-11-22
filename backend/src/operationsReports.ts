import { getPool } from './db.ts';
import type { CaseKind } from './companyCaseStore.ts';

/**
 * Exact, server-side reporting windows rather than filtering a bounded
 * browser snapshot. Only 7 and 30 rolling 24-hour days are currently
 * supported. An absent parameter selects 7 days.
 */
export type OperationsWindowDays = 7 | 30;
export function parseOperationsWindow(value: string | null): OperationsWindowDays | null {
  if (value === null || value === '7') return 7;
  return value === '30' ? 30 : null;
}
export function reportingBounds(days: OperationsWindowDays, now = Date.now()) {
  return { from: now - days * 86_400_000, to: now };
}

type CaseActivityRow = {
  kind: CaseKind;
  created: string; active: string; resolved_transitions: string;
  notes: string; assignments: string; with_targets: string;
  overdue_targets: string; due_soon: string;
};

/** A complete aggregate of retained internal cases and their case events.
 * Team filtering is applied in SQL, never in the response or browser.
 * Completion transitions are EVENTS, not distinct tickets or reply SLAs.
 * Internal targets are never labelled as statutory/legal deadlines.
 */
export async function caseActivityReport(kinds: CaseKind[], days: OperationsWindowDays) {
  const { from, to } = reportingBounds(days);
  const result = await getPool().query<CaseActivityRow>(`
    WITH case_totals AS (
      SELECT kind,
        COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS created,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed')) AS active,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND due_at IS NOT NULL) AS with_targets,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND due_at < $2) AS overdue_targets,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed') AND due_at >= $2
           AND due_at < $2 + 86400000) AS due_soon
      FROM company_cases WHERE kind = ANY($3::text[]) GROUP BY kind
    ), event_totals AS (
      SELECT c.kind,
        COUNT(*) FILTER (WHERE e.event = 'status'
          AND e.to_value IN ('resolved', 'closed')) AS resolved_transitions,
        COUNT(*) FILTER (WHERE e.event = 'note') AS notes,
        COUNT(*) FILTER (WHERE e.event IN ('assigned', 'released')) AS assignments
      FROM company_case_events e JOIN company_cases c ON c.id = e.case_id
      WHERE c.kind = ANY($3::text[]) AND e.created_at >= $1 AND e.created_at < $2
      GROUP BY c.kind
    )
    SELECT c.kind, c.created, c.active, c.with_targets, c.overdue_targets,
      c.due_soon, COALESCE(e.resolved_transitions, 0) AS resolved_transitions,
      COALESCE(e.notes, 0) AS notes, COALESCE(e.assignments, 0) AS assignments
    FROM case_totals c LEFT JOIN event_totals e ON e.kind = c.kind
  `, [from, to, kinds]);
  const byKind = kinds.map((kind) => {
    const row = result.rows.find((item) => item.kind === kind);
    return {
      kind, created: Number(row?.created ?? 0), active: Number(row?.active ?? 0),
      resolvedTransitions: Number(row?.resolved_transitions ?? 0),
      internalNotes: Number(row?.notes ?? 0),
      assignmentChanges: Number(row?.assignments ?? 0),
      configuredTargets: Number(row?.with_targets ?? 0),
      overdueTargets: Number(row?.overdue_targets ?? 0),
      dueSoonTargets: Number(row?.due_soon ?? 0),
    };
  });
  const totals = byKind.reduce((result, row) => {
    for (const key of ['created', 'active', 'resolvedTransitions', 'internalNotes',
      'assignmentChanges', 'configuredTargets', 'overdueTargets', 'dueSoonTargets'] as const) {
      result[key] += row[key];
    }
    return result;
  }, { created: 0, active: 0, resolvedTransitions: 0, internalNotes: 0,
    assignmentChanges: 0, configuredTargets: 0, overdueTargets: 0, dueSoonTargets: 0 });
  return {
    days, windowStart: from, generatedAt: to, scope: 'permitted_internal_cases',
    completeForRetainedData: true, since: 'company_case_system_launch',
    // Not a public/customer communication SLA or legal/regulatory deadline.
    metricDefinitions: {
      resolvedTransitions: 'Status changes to resolved or closed in the selected window',
      internalTargets: 'Staff-set internal due_at values on active cases only; not legal deadlines',
    },
    totals, byKind,
  };
}

type SocialRow = {
  posts: string; photos: string; reels: string; reports: string;
  reported_posts: string; hidden_now: string; moderation_decisions: string;
};
/** Aggregate-only Social safety reporting for roles authorised to moderate.
 * No media URLs, user identifiers, private captions or rider locations.
 */
export async function socialSafetyActivityReport(days: OperationsWindowDays) {
  const { from, to } = reportingBounds(days);
  const { rows } = await getPool().query<SocialRow>(`
    SELECT
      (SELECT COUNT(*) FROM social_posts WHERE created_at >= $1 AND created_at < $2) AS posts,
      (SELECT COUNT(*) FROM social_posts WHERE kind='photo' AND created_at >= $1 AND created_at < $2) AS photos,
      (SELECT COUNT(*) FROM social_posts WHERE kind='reel' AND created_at >= $1 AND created_at < $2) AS reels,
      (SELECT COUNT(*) FROM social_post_reports WHERE created_at >= $1 AND created_at < $2) AS reports,
      (SELECT COUNT(DISTINCT post_id) FROM social_post_reports WHERE created_at >= $1 AND created_at < $2) AS reported_posts,
      (SELECT COUNT(*) FROM social_posts WHERE hidden_at IS NOT NULL) AS hidden_now,
      (SELECT COUNT(*) FROM moderation_actions WHERE action IN ('social_post_restore','social_post_remove')
         AND created_at >= $1 AND created_at < $2) AS moderation_decisions
  `, [from, to]);
  const row = rows[0]!;
  return {
    days, windowStart: from, generatedAt: to, scope: 'social_content_safety',
    completeForRetainedData: true,
    metrics: {
      posts: Number(row.posts), photos: Number(row.photos), reels: Number(row.reels),
      reports: Number(row.reports), reportedPosts: Number(row.reported_posts),
      hiddenNow: Number(row.hidden_now), moderationDecisions: Number(row.moderation_decisions),
    },
    // No inferred engagement, audience growth, financial or response-SLA claims.
    unavailable: ['social_audience_retention', 'customer_reply_sla', 'financial_reconciliation'],
  };
}
