import { ensureMigrated, getPool } from './db.ts';
import { DEFAULT_PUBLIC_APP_URL, sendOperationalEmail } from './email.ts';
import { roleCan } from './staffRoles.ts';
import type { StaffRole } from './staffRoles.ts';

/**
 * Email alerts for staff, each opt-in from the dashboard:
 * - a morning summary (from 08:00 UTC) of work waiting for that person's role;
 * - a prompt email when a new urgent case is opened.
 * The job runs every 15 minutes on one replica (jobLease). Only staff with a
 * verified email who are not suspended receive anything, and each line is
 * limited to what their role may see. Emails hold counts, never rider details.
 */
export const STAFF_ALERT_INTERVAL_MS = 15 * 60 * 1000;
export const DIGEST_HOUR_UTC = 8;
const REPORT_WAIT_ALERT_MS = 24 * 60 * 60 * 1000;

export interface StaffAlertPrefs { dailyDigest: boolean; urgentAlerts: boolean }

export interface WorkSnapshot {
  openReports: number;
  reportsWaitingOverDay: number;
  activeCases: number;
  unownedCases: number;
  urgentCases: number;
  partnerApplications: number;
}

type Send = (to: string, subject: string, text: string) => Promise<boolean>;

export async function getStaffAlertPrefs(riderId: string): Promise<StaffAlertPrefs> {
  await ensureMigrated();
  const { rows } = await getPool().query<{ daily_digest: boolean; urgent_alerts: boolean }>(
    'SELECT daily_digest, urgent_alerts FROM staff_alert_prefs WHERE rider_id = $1', [riderId]);
  return { dailyDigest: rows[0]?.daily_digest ?? false, urgentAlerts: rows[0]?.urgent_alerts ?? false };
}

export async function setStaffAlertPrefs(riderId: string, prefs: StaffAlertPrefs, now = Date.now()): Promise<StaffAlertPrefs> {
  await ensureMigrated();
  // Turning urgent alerts on starts from now, so it never sends a backlog.
  await getPool().query(
    `INSERT INTO staff_alert_prefs (rider_id, daily_digest, urgent_alerts, last_urgent_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (rider_id) DO UPDATE SET daily_digest = EXCLUDED.daily_digest, urgent_alerts = EXCLUDED.urgent_alerts,
       last_urgent_at = CASE WHEN staff_alert_prefs.urgent_alerts THEN staff_alert_prefs.last_urgent_at ELSE EXCLUDED.last_urgent_at END,
       updated_at = EXCLUDED.updated_at`,
    [riderId, prefs.dailyDigest, prefs.urgentAlerts, now],
  );
  return prefs;
}

export async function workSnapshot(now = Date.now()): Promise<WorkSnapshot> {
  await ensureMigrated();
  const { rows } = await getPool().query<Record<keyof WorkSnapshot, string>>(
    `SELECT
       (SELECT count(*) FROM safety_reports WHERE status = 'open') AS "openReports",
       (SELECT count(*) FROM safety_reports WHERE status = 'open' AND created_at < $1) AS "reportsWaitingOverDay",
       (SELECT count(*) FROM company_cases WHERE status NOT IN ('resolved', 'closed')) AS "activeCases",
       (SELECT count(*) FROM company_cases WHERE status NOT IN ('resolved', 'closed') AND assigned_to IS NULL) AS "unownedCases",
       (SELECT count(*) FROM company_cases WHERE status NOT IN ('resolved', 'closed') AND priority = 'urgent') AS "urgentCases",
       (SELECT count(*) FROM partner_applications WHERE status IN ('submitted', 'in_review')) AS "partnerApplications"`,
    [now - REPORT_WAIT_ALERT_MS],
  );
  const row = rows[0]!;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) as unknown as WorkSnapshot;
}

const plural = (count: number, one: string, many = one + 's') => `${count} ${count === 1 ? one : many}`;

/** The summary lines this role may see; empty when nothing is waiting. */
export function digestLines(role: StaffRole, work: WorkSnapshot): string[] {
  const lines: string[] = [];
  if (roleCan(role, 'moderate') && work.openReports) {
    lines.push(`${plural(work.openReports, 'open rider report')}` +
      (work.reportsWaitingOverDay ? ` (${work.reportsWaitingOverDay} waiting over a day)` : ''));
  }
  if (roleCan(role, 'view_cases') && work.activeCases) {
    lines.push(`${plural(work.activeCases, 'active case')}, ${work.unownedCases} without an owner, ${work.urgentCases} urgent`);
  }
  if (roleCan(role, 'review_partners') && work.partnerApplications) {
    lines.push(plural(work.partnerApplications, 'partner application') + ' awaiting review');
  }
  return lines;
}

const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const hubLink = () => new URL('admin.html', process.env.PUBLIC_APP_URL || DEFAULT_PUBLIC_APP_URL).toString();

type Recipient = {
  rider_id: string; email: string; is_admin: boolean; role: StaffRole | null;
  daily_digest: boolean; urgent_alerts: boolean; last_digest_day: string | null; last_urgent_at: string | null;
};

/** One pass of the alert job. Returns how many emails were sent. */
export async function runStaffAlerts(now = Date.now(), send: Send = sendOperationalEmail): Promise<number> {
  await ensureMigrated();
  const pool = getPool();
  const { rows } = await pool.query<Recipient>(
    `SELECT p.rider_id, u.email, u.is_admin, r.role, p.daily_digest, p.urgent_alerts, p.last_digest_day, p.last_urgent_at
     FROM staff_alert_prefs p
     JOIN users u ON u.id = p.rider_id
     LEFT JOIN staff_roles r ON r.rider_id = u.id
     WHERE (p.daily_digest OR p.urgent_alerts)
       AND u.email IS NOT NULL AND u.email_verified_at IS NOT NULL AND u.suspended_at IS NULL
       AND (u.is_admin OR r.role IS NOT NULL)`,
  );
  if (!rows.length) return 0;
  const today = dayKey(now);
  const digestDue = new Date(now).getUTCHours() >= DIGEST_HOUR_UTC;
  let work: WorkSnapshot | null = null;
  let sent = 0;
  for (const row of rows) {
    const role: StaffRole = row.is_admin ? 'admin' : row.role!;
    if (row.daily_digest && digestDue && row.last_digest_day !== today) {
      work ??= await workSnapshot(now);
      const lines = digestLines(role, work);
      // Mark the day first so a slow or failed send is never repeated within it.
      await pool.query('UPDATE staff_alert_prefs SET last_digest_day = $2 WHERE rider_id = $1', [row.rider_id, today]);
      if (lines.length && await send(row.email, `Rider Comms Staff Hub: ${lines.length === 1 ? lines[0] : 'work waiting'}`,
        ['Waiting in the Staff Hub this morning:', '', ...lines.map((line) => '• ' + line), '', hubLink(), '',
          'You can turn this email off from Email alerts in the Staff Hub.'].join('\n'))) sent += 1;
    }
    if (row.urgent_alerts && roleCan(role, 'view_cases')) {
      const since = row.last_urgent_at === null ? now : Number(row.last_urgent_at);
      const { rows: fresh } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM company_cases WHERE priority = 'urgent' AND status NOT IN ('resolved', 'closed')
         AND created_at > $1 AND created_at <= $2`, [since, now]);
      const count = Number(fresh[0]?.count ?? 0);
      await pool.query('UPDATE staff_alert_prefs SET last_urgent_at = $2 WHERE rider_id = $1', [row.rider_id, now]);
      if (count && await send(row.email, `Rider Comms Staff Hub: ${plural(count, 'new urgent case')}`,
        [`${plural(count, 'urgent case has', 'urgent cases have')} been opened since your last alert.`, '', hubLink() + '#cases', '',
          'You can turn these emails off from Email alerts in the Staff Hub.'].join('\n'))) sent += 1;
    }
  }
  return sent;
}
