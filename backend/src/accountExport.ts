import { ensureMigrated, getPool } from './db.ts';

/**
 * Everything Rider Comms and Rider Social hold about one rider, as JSON, for
 * a rider's own "download my data" request and for staff answering a data
 * access request (GDPR art. 15). Kept next to accountDeletionStore.ts: a table
 * that holds rider data belongs in both.
 *
 * Left out on purpose: password hashes and session tokens (secrets), who
 * reported the rider and staff notes about them (other people's data), and
 * Social photo and video files, which are served through the app.
 */
export const EXPORT_FORMAT_VERSION = 1;

type Row = Record<string, unknown>;

function ms(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  return Number.isFinite(number) ? number : new Date(String(value)).getTime();
}

/** Turns timestamp columns (anything ending _at) into epoch milliseconds. */
function clean(rows: Row[]): Row[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key.endsWith('_at') ? ms(value) : value])));
}

export async function exportRiderData(riderId: string, now = Date.now()): Promise<Record<string, unknown> | null> {
  await ensureMigrated();
  const pool = getPool();
  const one = async (sql: string) => clean((await pool.query(sql, [riderId])).rows)[0] ?? null;
  const many = async (sql: string) => clean((await pool.query(sql, [riderId])).rows);

  const account = await one(
    `SELECT u.id AS rider_id, u.username, u.email, u.created_at, u.email_verified_at, u.terms_version, u.terms_accepted_at,
            u.suspended_at, u.first_ride_at, u.first_nearby_at,
            CASE WHEN u.is_admin THEN 'admin' ELSE s.role END AS staff_role
     FROM users u LEFT JOIN staff_roles s ON s.rider_id = u.id WHERE u.id = $1`,
  );
  if (!account) return null;

  return {
    format: 'rider-comms-data-export',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: now,
    account,
    profile: await one(
      `SELECT display_name, handle, avatar_id, bio, unit_system, notify_nearby, notify_invites, notify_chat, share_location,
              instagram_username, instagram_visibility, tiktok_username, tiktok_visibility, zone_tier, zone_tier_expires_at, updated_at
       FROM rider_profiles WHERE rider_id = $1`,
    ),
    subscriptions: await many('SELECT platform, product_id, tier, active, will_renew, expires_at, verified_at FROM store_subscriptions WHERE rider_id = $1'),
    friends: await many(
      `SELECT f.friend_id AS rider_id, p.display_name, p.handle, f.created_at
       FROM friendships f LEFT JOIN rider_profiles p ON p.rider_id = f.friend_id WHERE f.rider_id = $1 ORDER BY f.created_at`,
    ),
    friendRequests: await many(
      `SELECT CASE WHEN from_rider_id = $1 THEN 'sent' ELSE 'received' END AS direction,
              CASE WHEN from_rider_id = $1 THEN to_rider_id ELSE from_rider_id END AS other_rider_id, status, created_at
       FROM friend_requests WHERE from_rider_id = $1 OR to_rider_id = $1 ORDER BY created_at`,
    ),
    blockedRiders: await many('SELECT blocked_rider_id AS rider_id, created_at FROM rider_blocks WHERE rider_id = $1 ORDER BY created_at'),
    messages: await many(
      `SELECT CASE WHEN from_rider_id = $1 THEN 'sent' ELSE 'received' END AS direction,
              CASE WHEN from_rider_id = $1 THEN to_rider_id ELSE from_rider_id END AS other_rider_id, text, created_at
       FROM direct_messages WHERE from_rider_id = $1 OR to_rider_id = $1 ORDER BY created_at, seq`,
    ),
    rides: await many(
      `SELECT r.id, r.created_at, r.created_by = $1 AS created_by_you, m.location_sharing_enabled, r.regroup_label, r.regroup_set_at
       FROM rides r JOIN ride_members m ON m.ride_id = r.id AND m.rider_id = $1
       UNION
       SELECT r.id, r.created_at, true, NULL, r.regroup_label, r.regroup_set_at FROM rides r
       WHERE r.created_by = $1 AND NOT EXISTS (SELECT 1 FROM ride_members m WHERE m.ride_id = r.id AND m.rider_id = $1)
       ORDER BY created_at`,
    ),
    hideouts: await many(
      `SELECT h.id, h.name, h.lat, h.lon, h.created_at, h.created_by = $1 AS created_by_you
       FROM hideouts h WHERE h.created_by = $1 OR EXISTS (SELECT 1 FROM hideout_participants p WHERE p.hideout_id = h.id AND p.rider_id = $1)
       ORDER BY h.created_at`,
    ),
    hazardReports: await many('SELECT id, type, lat, lon, created_at, expires_at, confirmations, denials FROM hazard_reports WHERE reported_by = $1 ORDER BY created_at'),
    hazardVotes: await many('SELECT report_id, vote FROM hazard_report_votes WHERE rider_id = $1'),
    scenicRoutes: await many('SELECT id, name, description, distance_miles, created_at FROM scenic_routes WHERE created_by = $1 ORDER BY created_at'),
    socialPosts: await many(
      `SELECT p.id, p.kind, p.caption, p.created_at, p.hidden_at, (SELECT count(*)::int FROM social_post_media m WHERE m.post_id = p.id) AS media_count
       FROM social_posts p WHERE p.author_id = $1 ORDER BY p.created_at`,
    ),
    socialPostReportsFiled: await many('SELECT post_id, reason, created_at FROM social_post_reports WHERE reporter_id = $1 ORDER BY created_at'),
    safetyReportsFiled: await many('SELECT id, reported_rider_id, reason, details, status, created_at, resolved_at FROM safety_reports WHERE reporter_id = $1 ORDER BY created_at'),
    // Reports about the rider: what and when, never who reported them or the reporter's words.
    safetyReportsAboutYou: await many('SELECT reason, status, created_at, resolved_at FROM safety_reports WHERE reported_rider_id = $1 ORDER BY created_at'),
    staffActionsAboutYou: await many(
      `SELECT action, created_at FROM moderation_actions
       WHERE target_rider_id = $1 AND action NOT IN ('data_export') ORDER BY created_at`,
    ),
    devices: await many('SELECT device_name, created_at, last_seen_at, expires_at FROM account_sessions WHERE user_id = $1 ORDER BY created_at'),
    notificationDevices: await many('SELECT kind, created_at, updated_at FROM push_subscriptions WHERE rider_id = $1 ORDER BY created_at'),
    securityHistory: await many('SELECT event, device, created_at FROM security_events WHERE rider_id = $1 ORDER BY created_at'),
    lastSeenAt: (await one('SELECT last_seen_at FROM rider_activity WHERE rider_id = $1'))?.last_seen_at ?? null,
  };
}
