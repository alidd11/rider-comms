import { ensureMigrated, getPool } from './db.ts';

// Aggregate numbers for the staff dashboard. Everything here is counts; the
// only per-rider data is the staff rider search, which is admin-only.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days of history returned for the dashboard's trend charts: 30 shown plus 30 to compare against. */
export const SERIES_DAYS = 60;
/** A public-presence fix counts as "live now" for this long (the API's own window). */
const LIVE_PRESENCE_MS = 30_000;
export const MAX_RIDER_SEARCH_RESULTS = 50;

export type DailyMetric = 'active_riders' | 'rides_started' | 'filter_rejections';
export type RiderMilestone = 'ride' | 'nearby';

/** Funnel cohort: riders who signed up between these many days ago. Starts at
 * 7 so everyone counted has had a week to come back; ends at 30 so a return
 * after day 7 is always within the 30-day last-seen retention. */
export const FUNNEL_COHORT_MIN_AGE_DAYS = 7;
export const FUNNEL_COHORT_MAX_AGE_DAYS = 30;

export interface GrowthFunnel {
  cohortStart: number;
  cohortEnd: number;
  signedUp: number;
  verified: number;
  /** Joined or started a group ride, or went live on Nearby. */
  firstRide: number;
  /** Seen again at least 7 days after signing up. */
  returned: number;
  /** When first-ride tracking began (null before the migration ran); earlier signups can't show a first ride. */
  rideTrackingSince: number | null;
}

export interface DailySeries {
  /** UTC dates, oldest first, `YYYY-MM-DD`. */
  days: string[];
  signups: number[];
  messages: number[];
  /** null for days before daily tracking started. */
  activeRiders: (number | null)[];
  ridesStarted: (number | null)[];
}

export interface AdminOverview {
  generatedAt: number;
  riders: { total: number; verified: number; suspended: number; admins: number; newToday: number; new7d: number; new30d: number };
  activity: { active24h: number; active7d: number; active30d: number; liveNearbyNow: number; sharingLocation: number; activeRides: number; ridersInRides: number };
  social: { friendships: number; pendingFriendRequests: number; messages24h: number; messages7d: number; messages30d: number };
  content: { activeHazards: number; scenicRoutes: number; hideouts: number };
  /** filterRejections7d: names, messages and hideouts the content filter turned away in the last 7 days. */
  safety: { openReports: number; reports7d: number; moderationActions7d: number; filterRejections7d: number };
  /** The same measures for the period before, so the dashboard can show change. */
  previous: { new7d: number; new30d: number; messages7d: number; messages30d: number; reports7d: number };
  zoneTiers: Record<string, number>;
  series: DailySeries;
  funnel: GrowthFunnel;
}

export interface AdminRiderSummary {
  riderId: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  createdAt: number;
  lastSeenAt: number | null;
  isAdmin: boolean;
  suspended: boolean;
  displayName: string | null;
  handle: string | null;
  friends: number;
  reportsAgainst: number;
  reportsFiled: number;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function count(value: unknown): number {
  return Number(value ?? 0);
}

export class AdminStatsStore {
  // Riders already known to have reached each milestone, so a presence fix
  // every 8 s doesn't cost an UPDATE each time. Per process; a restart only
  // means one more no-op UPDATE per rider.
  private readonly milestonesRecorded: Record<RiderMilestone, Set<string>> = { ride: new Set(), nearby: new Set() };

  /** Records the first time a rider reaches a funnel milestone; later calls are no-ops. */
  async recordMilestone(riderId: string, milestone: RiderMilestone, now = Date.now()): Promise<void> {
    const seen = this.milestonesRecorded[milestone];
    if (seen.has(riderId)) return;
    await ensureMigrated();
    const column = milestone === 'ride' ? 'first_ride_at' : 'first_nearby_at';
    await getPool().query(
      `UPDATE users SET ${column} = to_timestamp($2 / 1000.0) WHERE id = $1 AND ${column} IS NULL`,
      [riderId, now],
    );
    if (seen.size >= 100_000) seen.clear();
    seen.add(riderId);
  }

  private async funnel(now: number): Promise<GrowthFunnel> {
    const pool = getPool();
    const cohortStart = now - FUNNEL_COHORT_MAX_AGE_DAYS * DAY_MS;
    const cohortEnd = now - FUNNEL_COHORT_MIN_AGE_DAYS * DAY_MS;
    const [cohort, tracking] = await Promise.all([
      pool.query(
        `SELECT count(*) AS signed_up,
                count(*) FILTER (WHERE u.email_verified_at IS NOT NULL) AS verified,
                count(*) FILTER (WHERE u.first_ride_at IS NOT NULL OR u.first_nearby_at IS NOT NULL) AS first_ride,
                count(*) FILTER (WHERE act.last_seen_at >= (extract(epoch FROM u.created_at) * 1000) + $3) AS returned
         FROM users u
         LEFT JOIN rider_activity act ON act.rider_id = u.id
         WHERE u.created_at >= to_timestamp($1 / 1000.0) AND u.created_at < to_timestamp($2 / 1000.0)`,
        [cohortStart, cohortEnd, FUNNEL_COHORT_MIN_AGE_DAYS * DAY_MS],
      ),
      pool.query<{ applied_at: Date }>(
        "SELECT applied_at FROM schema_migrations WHERE name = '0041_add_rider_milestones'",
      ),
    ]);
    const row = cohort.rows[0] ?? {};
    const since = tracking.rows[0]?.applied_at;
    return {
      cohortStart,
      cohortEnd,
      signedUp: count(row.signed_up),
      verified: count(row.verified),
      firstRide: count(row.first_ride),
      returned: count(row.returned),
      rideTrackingSince: since ? new Date(since).getTime() : null,
    };
  }

  /**
   * Raises today's active-rider snapshot. Called on a timer: last-seen times
   * only move forward, so the day's count only grows and GREATEST keeps the
   * highest reading.
   */
  async recordActiveRiders(now = Date.now()): Promise<number> {
    await ensureMigrated();
    const startOfDay = Date.parse(`${utcDay(now)}T00:00:00Z`);
    const { rows } = await getPool().query<{ n: string }>(
      'SELECT count(*) AS n FROM rider_activity WHERE last_seen_at >= $1',
      [startOfDay],
    );
    const riders = count(rows[0]?.n);
    await getPool().query(
      `INSERT INTO daily_metrics (day, metric, value) VALUES ($1, 'active_riders', $2)
       ON CONFLICT (day, metric) DO UPDATE SET value = GREATEST(daily_metrics.value, EXCLUDED.value)`,
      [utcDay(now), riders],
    );
    return riders;
  }

  async increment(metric: DailyMetric, now = Date.now()): Promise<void> {
    await ensureMigrated();
    await getPool().query(
      `INSERT INTO daily_metrics (day, metric, value) VALUES ($1, $2, 1)
       ON CONFLICT (day, metric) DO UPDATE SET value = daily_metrics.value + 1`,
      [utcDay(now), metric],
    );
  }

  async overview(now = Date.now()): Promise<AdminOverview> {
    await ensureMigrated();
    const pool = getPool();
    const since = (ms: number) => now - ms;
    // The daily series and funnel don't depend on the totals; run them in
    // the same round of queries instead of afterwards.
    const seriesPromise = this.series(now);
    const funnelPromise = this.funnel(now);
    const [riders, activity, social, content, safety, tiers, previous] = await Promise.all([
      pool.query(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified,
                count(*) FILTER (WHERE suspended_at IS NOT NULL) AS suspended,
                count(*) FILTER (WHERE is_admin) AS admins,
                count(*) FILTER (WHERE created_at >= to_timestamp($1 / 1000.0)) AS new_today,
                count(*) FILTER (WHERE created_at >= to_timestamp($2 / 1000.0)) AS new_7d,
                count(*) FILTER (WHERE created_at >= to_timestamp($3 / 1000.0)) AS new_30d
         FROM users`,
        [Date.parse(`${utcDay(now)}T00:00:00Z`), since(7 * DAY_MS), since(30 * DAY_MS)],
      ),
      pool.query(
        `SELECT
           (SELECT count(*) FROM rider_activity WHERE last_seen_at >= $1) AS active_24h,
           (SELECT count(*) FROM rider_activity WHERE last_seen_at >= $2) AS active_7d,
           (SELECT count(*) FROM rider_activity WHERE last_seen_at >= $3) AS active_30d,
           (SELECT count(*) FROM rider_presence WHERE updated_at >= $4) AS live_nearby,
           (SELECT count(*) FROM rider_profiles WHERE share_location) AS sharing_location,
           (SELECT count(*) FROM rides) AS active_rides,
           (SELECT count(*) FROM ride_members) AS riders_in_rides`,
        [since(DAY_MS), since(7 * DAY_MS), since(30 * DAY_MS), since(LIVE_PRESENCE_MS)],
      ),
      pool.query(
        `SELECT
           (SELECT count(*) FROM friendships) / 2 AS friendships,
           (SELECT count(*) FROM friend_requests WHERE status = 'pending') AS pending_requests,
           (SELECT count(*) FROM direct_messages WHERE created_at >= $1) AS messages_24h,
           (SELECT count(*) FROM direct_messages WHERE created_at >= $2) AS messages_7d,
           (SELECT count(*) FROM direct_messages WHERE created_at >= $3) AS messages_30d`,
        [since(DAY_MS), since(7 * DAY_MS), since(30 * DAY_MS)],
      ),
      pool.query(
        `SELECT
           (SELECT count(*) FROM hazard_reports WHERE expires_at > $1) AS active_hazards,
           (SELECT count(*) FROM scenic_routes) AS scenic_routes,
           (SELECT count(*) FROM hideouts) AS hideouts`,
        [now],
      ),
      pool.query(
        `SELECT
           (SELECT count(*) FROM safety_reports WHERE status = 'open') AS open_reports,
           (SELECT count(*) FROM safety_reports WHERE created_at >= $1) AS reports_7d,
           (SELECT count(*) FROM moderation_actions WHERE created_at >= $1) AS actions_7d,
           (SELECT coalesce(sum(value), 0) FROM daily_metrics WHERE metric = 'filter_rejections' AND day >= $2::date) AS filter_rejections_7d`,
        [since(7 * DAY_MS), utcDay(now - 6 * DAY_MS)],
      ),
      pool.query<{ zone_tier: string; n: string }>('SELECT zone_tier, count(*) AS n FROM rider_profiles GROUP BY zone_tier'),
      pool.query(
        `SELECT
           (SELECT count(*) FROM users WHERE created_at >= to_timestamp($1 / 1000.0) AND created_at < to_timestamp($2 / 1000.0)) AS new_prev_7d,
           (SELECT count(*) FROM users WHERE created_at >= to_timestamp($3 / 1000.0) AND created_at < to_timestamp($4 / 1000.0)) AS new_prev_30d,
           (SELECT count(*) FROM direct_messages WHERE created_at >= $1 AND created_at < $2) AS messages_prev_7d,
           (SELECT count(*) FROM direct_messages WHERE created_at >= $3 AND created_at < $4) AS messages_prev_30d,
           (SELECT count(*) FROM safety_reports WHERE created_at >= $1 AND created_at < $2) AS reports_prev_7d`,
        [since(14 * DAY_MS), since(7 * DAY_MS), since(60 * DAY_MS), since(30 * DAY_MS)],
      ),
    ]);
    const r = riders.rows[0] ?? {};
    const a = activity.rows[0] ?? {};
    const s = social.rows[0] ?? {};
    const c = content.rows[0] ?? {};
    const f = safety.rows[0] ?? {};
    const p = previous.rows[0] ?? {};
    return {
      generatedAt: now,
      riders: {
        total: count(r.total), verified: count(r.verified), suspended: count(r.suspended), admins: count(r.admins),
        newToday: count(r.new_today), new7d: count(r.new_7d), new30d: count(r.new_30d),
      },
      activity: {
        active24h: count(a.active_24h), active7d: count(a.active_7d), active30d: count(a.active_30d),
        liveNearbyNow: count(a.live_nearby), sharingLocation: count(a.sharing_location),
        activeRides: count(a.active_rides), ridersInRides: count(a.riders_in_rides),
      },
      social: {
        friendships: count(s.friendships), pendingFriendRequests: count(s.pending_requests),
        messages24h: count(s.messages_24h), messages7d: count(s.messages_7d), messages30d: count(s.messages_30d),
      },
      content: { activeHazards: count(c.active_hazards), scenicRoutes: count(c.scenic_routes), hideouts: count(c.hideouts) },
      safety: { openReports: count(f.open_reports), reports7d: count(f.reports_7d), moderationActions7d: count(f.actions_7d), filterRejections7d: count(f.filter_rejections_7d) },
      previous: {
        new7d: count(p.new_prev_7d), new30d: count(p.new_prev_30d),
        messages7d: count(p.messages_prev_7d), messages30d: count(p.messages_prev_30d),
        reports7d: count(p.reports_prev_7d),
      },
      zoneTiers: Object.fromEntries(tiers.rows.map((row) => [row.zone_tier, count(row.n)])),
      series: await seriesPromise,
      funnel: await funnelPromise,
    };
  }

  private async series(now: number): Promise<DailySeries> {
    const pool = getPool();
    const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
    const firstDay = today - (SERIES_DAYS - 1) * DAY_MS;
    const days = Array.from({ length: SERIES_DAYS }, (_, i) => utcDay(firstDay + i * DAY_MS));
    const index = new Map(days.map((day, i) => [day, i]));
    const [signups, messages, metrics] = await Promise.all([
      pool.query<{ day: string; n: string }>(
        `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) AS n
         FROM users WHERE created_at >= to_timestamp($1 / 1000.0) GROUP BY 1`,
        [firstDay],
      ),
      pool.query<{ day: string; n: string }>(
        `SELECT to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) AS n
         FROM direct_messages WHERE created_at >= $1 GROUP BY 1`,
        [firstDay],
      ),
      pool.query<{ day: string; metric: DailyMetric; value: number }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, metric, value FROM daily_metrics WHERE day >= $1::date`,
        [utcDay(firstDay)],
      ),
    ]);
    const zeros = () => days.map(() => 0);
    const nulls = (): (number | null)[] => days.map(() => null);
    const result: DailySeries = { days, signups: zeros(), messages: zeros(), activeRiders: nulls(), ridesStarted: nulls() };
    for (const row of signups.rows) {
      const i = index.get(row.day);
      if (i !== undefined) result.signups[i] = count(row.n);
    }
    for (const row of messages.rows) {
      const i = index.get(row.day);
      if (i !== undefined) result.messages[i] = count(row.n);
    }
    for (const row of metrics.rows) {
      const i = index.get(row.day);
      if (i === undefined) continue;
      if (row.metric === 'active_riders') result.activeRiders[i] = count(row.value);
      else if (row.metric === 'rides_started') result.ridesStarted[i] = count(row.value);
    }
    // Once tracking has started, a day with no rides is zero, not missing.
    const firstTracked = result.ridesStarted.findIndex((value) => value !== null);
    const trackingStart = Math.min(...[firstTracked, result.activeRiders.findIndex((v) => v !== null)].filter((i) => i >= 0));
    if (Number.isFinite(trackingStart)) {
      for (let i = trackingStart; i < days.length; i += 1) if (result.ridesStarted[i] === null) result.ridesStarted[i] = 0;
    }
    return result;
  }

  /** Staff rider lookup by username, email, display name or handle (case-insensitive substring) or exact rider ID. */
  async searchRiders(query: string, limit = 20): Promise<AdminRiderSummary[]> {
    await ensureMigrated();
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), MAX_RIDER_SEARCH_RESULTS);
    const trimmed = query.trim();
    const pattern = `%${trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const { rows } = await getPool().query(
      `SELECT u.id, u.username, u.email, u.email_verified_at IS NOT NULL AS email_verified,
              u.created_at, u.is_admin, u.suspended_at IS NOT NULL AS suspended,
              p.display_name, p.handle, act.last_seen_at,
              (SELECT count(*) FROM friendships fr WHERE fr.rider_id = u.id) AS friends,
              (SELECT count(*) FROM safety_reports sr WHERE sr.reported_rider_id = u.id) AS reports_against,
              (SELECT count(*) FROM safety_reports sr WHERE sr.reporter_id = u.id) AS reports_filed
       FROM users u
       LEFT JOIN rider_profiles p ON p.rider_id = u.id
       LEFT JOIN rider_activity act ON act.rider_id = u.id
       WHERE $1 = '' OR u.id = $2
          OR u.username ILIKE $3 OR u.email ILIKE $3 OR p.display_name ILIKE $3 OR p.handle ILIKE $3
       ORDER BY u.created_at DESC
       LIMIT $4`,
      [trimmed, trimmed, pattern, bounded],
    );
    return rows.map((row) => ({
      riderId: row.id,
      username: row.username,
      email: row.email ?? null,
      emailVerified: row.email_verified === true,
      createdAt: new Date(row.created_at).getTime(),
      lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
      isAdmin: row.is_admin === true,
      suspended: row.suspended === true,
      displayName: row.display_name ?? null,
      handle: row.handle ?? null,
      friends: count(row.friends),
      reportsAgainst: count(row.reports_against),
      reportsFiled: count(row.reports_filed),
    }));
  }
}
