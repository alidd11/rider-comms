import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { ConnectionOptions } from 'node:tls';

/** Lazily-initialized Postgres pool. Production startup calls
 * `ensureMigrated()` before accepting traffic; lazy initialization remains
 * useful for isolated tests and imported store modules. */
let pool: Pool | undefined;
let migrationsRun: Promise<void> | undefined;

/**
 * Ordered, idempotent migrations. Each entry runs once, tracked by name in
 * schema_migrations, inside the same transaction as the tracking insert.
 * This is intentionally not a full migration framework — just enough to
 * grow the schema safely across deploys.
 */
const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '0001_create_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));
    `,
  },
  {
    // Adds email + verification to the existing `users` table (created by
    // 0001, which is already applied in production — so this only ever
    // ADDs, never recreates, and every statement is idempotent). A brand
    // new signup writes both id/username/password_hash and email in one
    // INSERT, but the column has to allow NULL at the ALTER TABLE step so
    // this migration doesn't fail against any pre-existing rows; the
    // application layer (authStore.ts) is what actually requires an email
    // for every *new* signup.
    name: '0002_add_email_verification',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
      CREATE TABLE IF NOT EXISTS email_verifications (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS email_verifications_user_id_idx ON email_verifications (user_id);
    `,
  },
  {
    name: '0003_create_friend_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        from_rider_id TEXT NOT NULL,
        to_rider_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS friend_requests_to_rider_idx ON friend_requests (to_rider_id, status);
      CREATE INDEX IF NOT EXISTS friend_requests_from_rider_idx ON friend_requests (from_rider_id, status);

      -- Symmetric adjacency: an accepted friendship is stored as both
      -- (a, b) and (b, a) rows so lookups from either side are a plain
      -- indexed equality query, same shape as the in-memory Map<Set> it replaces.
      CREATE TABLE IF NOT EXISTS friendships (
        rider_id TEXT NOT NULL,
        friend_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (rider_id, friend_id)
      );
    `,
  },
  {
    name: '0004_create_hazard_reports',
    sql: `
      CREATE TABLE IF NOT EXISTS hazard_reports (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        reported_by TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        confirmations INTEGER NOT NULL DEFAULT 0,
        denials INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS hazard_reports_reported_by_idx ON hazard_reports (reported_by);

      CREATE TABLE IF NOT EXISTS hazard_report_votes (
        report_id TEXT NOT NULL,
        rider_id TEXT NOT NULL,
        vote TEXT NOT NULL,
        PRIMARY KEY (report_id, rider_id, vote)
      );
    `,
  },
  {
    name: '0005_create_messages',
    sql: `
      CREATE TABLE IF NOT EXISTS direct_messages (
        id TEXT PRIMARY KEY,
        from_rider_id TEXT NOT NULL,
        to_rider_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        -- Surrogate insertion-order tiebreaker: createdAt is millisecond
        -- resolution, so two messages sent in the same millisecond need a
        -- stable secondary sort key to preserve send order (matches the
        -- stable Array.sort the in-memory version relied on).
        seq BIGSERIAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS direct_messages_thread_idx ON direct_messages (from_rider_id, to_rider_id, created_at, seq);
    `,
  },
  {
    name: '0006_create_moderation_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS rider_blocks (
        rider_id TEXT NOT NULL,
        blocked_rider_id TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (rider_id, blocked_rider_id)
      );

      CREATE TABLE IF NOT EXISTS safety_reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL,
        reported_rider_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
    `,
  },
  {
    name: '0007_create_hideouts',
    sql: `
      CREATE TABLE IF NOT EXISTS hideouts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hideout_participants (
        hideout_id TEXT NOT NULL REFERENCES hideouts (id) ON DELETE CASCADE,
        rider_id TEXT NOT NULL,
        PRIMARY KEY (hideout_id, rider_id)
      );
      CREATE INDEX IF NOT EXISTS hideout_participants_rider_idx ON hideout_participants (rider_id);
    `,
  },
  {
    name: '0008_create_scenic_routes',
    sql: `
      -- User-submitted scenic routes only (see scenicRouteStore.ts) — the
      -- static motorbike-first route catalogue added in PR #48 is unrelated
      -- client-side reference content in mobile/src/routes/curatedRoutes.ts
      -- and never touches this table.
      CREATE TABLE IF NOT EXISTS scenic_routes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        vehicle_suitability TEXT[] NOT NULL,
        road_type TEXT NOT NULL,
        distance_miles DOUBLE PRECISION NOT NULL,
        estimated_duration_minutes DOUBLE PRECISION NOT NULL,
        difficulty TEXT NOT NULL,
        surface_quality TEXT NOT NULL,
        avoids_tolls BOOLEAN NOT NULL,
        avoids_motorways BOOLEAN NOT NULL,
        scenic_rating INTEGER NOT NULL,
        safety_notices TEXT[] NOT NULL,
        start_lat DOUBLE PRECISION NOT NULL,
        start_lon DOUBLE PRECISION NOT NULL,
        end_lat DOUBLE PRECISION NOT NULL,
        end_lon DOUBLE PRECISION NOT NULL,
        created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS scenic_routes_created_by_idx ON scenic_routes (created_by);
    `,
  },
  {
    name: '0009_create_account_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS account_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS account_sessions_user_id_idx ON account_sessions (user_id);
      CREATE INDEX IF NOT EXISTS account_sessions_expires_at_idx ON account_sessions (expires_at);
    `,
  },
  {
    name: '0010_add_is_admin',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
    `,
  },
  {
    name: '0011_create_rider_profiles',
    sql: `
      CREATE TABLE IF NOT EXISTS rider_profiles (
        rider_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        handle TEXT NOT NULL,
        avatar_id TEXT NOT NULL,
        zone_tier TEXT NOT NULL,
        unit_system TEXT NOT NULL,
        notify_nearby BOOLEAN NOT NULL,
        notify_invites BOOLEAN NOT NULL,
        notify_chat BOOLEAN NOT NULL,
        share_location BOOLEAN NOT NULL,
        instagram_username TEXT NOT NULL,
        instagram_visibility TEXT NOT NULL,
        tiktok_username TEXT NOT NULL,
        tiktok_visibility TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `,
  },
  {
    name: '0012_create_rides',
    sql: `
      CREATE TABLE IF NOT EXISTS rides (
        id TEXT PRIMARY KEY,
        created_by TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rides_created_by_idx ON rides (created_by);

      CREATE TABLE IF NOT EXISTS ride_members (
        ride_id TEXT NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
        rider_id TEXT NOT NULL,
        PRIMARY KEY (ride_id, rider_id)
      );
      CREATE INDEX IF NOT EXISTS ride_members_rider_idx ON ride_members (rider_id);

      CREATE TABLE IF NOT EXISTS ride_codes (
        code TEXT PRIMARY KEY,
        ride_id TEXT NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ride_codes_ride_id_idx ON ride_codes (ride_id);
    `,
  },
  {
    name: '0013_create_rider_presence',
    sql: `
      CREATE TABLE IF NOT EXISTS rider_presence (
        rider_id TEXT PRIMARY KEY,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        radius_miles DOUBLE PRECISION NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `,
  },
  {
    // Deliberately separate from rider_presence above: that table is the
    // *public* nearby-riders channel, gated on profile.share_location and
    // matched by anonymous zone buckets (see presenceStore.ts) — it never
    // exposes a raw coordinate to anyone. A ride is different: its members
    // already know exactly who else is in it (they typed/shared a join
    // code), so sharing real coordinates within that small, explicit group
    // is the whole point, and it has to work regardless of whether the
    // rider has the public toggle on. Reusing rider_presence for this would
    // leak a ride member into public zone-matching even with sharing off.
    name: '0014_create_ride_locations',
    sql: `
      CREATE TABLE IF NOT EXISTS ride_locations (
        ride_id TEXT NOT NULL REFERENCES rides (id) ON DELETE CASCADE,
        rider_id TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (ride_id, rider_id)
      );
    `,
  },
  {
    // Handles were never unique — every profile defaulted to the literal
    // string "@rider" until someone customized it in Settings, so most
    // accounts still collide on it today. Adding a friend by handle (see
    // profileStore.findRiderIdByHandle) needs a handle to resolve to
    // exactly one rider, so this first renames every duplicate but the
    // oldest to `<handle>_<last 4 chars of riderId>` (riderId is already
    // globally unique, so this is guaranteed to be too) before adding the
    // real constraint — a plain CREATE UNIQUE INDEX would just fail
    // outright against the existing duplicate "@rider" rows.
    name: '0015_unique_rider_profile_handles',
    sql: `
      WITH ranked AS (
        SELECT rider_id, ROW_NUMBER() OVER (
          PARTITION BY lower(handle) ORDER BY updated_at ASC, rider_id ASC
        ) AS rn
        FROM rider_profiles
      )
      UPDATE rider_profiles rp
      SET handle = rp.handle || '_' || right(rp.rider_id, 4)
      FROM ranked
      WHERE rp.rider_id = ranked.rider_id AND ranked.rn > 1;
      CREATE UNIQUE INDEX IF NOT EXISTS rider_profiles_handle_lower_idx ON rider_profiles (lower(handle));
    `,
  },
  {
    name: '0016_private_ride_location_consent',
    sql: `
      ALTER TABLE ride_members
        ADD COLUMN IF NOT EXISTS location_sharing_enabled BOOLEAN NOT NULL DEFAULT FALSE;

      -- Existing rows were collected before per-ride consent existed. Do
      -- not grandfather them into the new model: every member starts with
      -- sharing off and must opt in again.
      DELETE FROM ride_locations;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'ride_locations_current_member_fk'
        ) THEN
          ALTER TABLE ride_locations
            ADD CONSTRAINT ride_locations_current_member_fk
            FOREIGN KEY (ride_id, rider_id)
            REFERENCES ride_members (ride_id, rider_id)
            ON DELETE CASCADE;
        END IF;
      END $$;
    `,
  },
  {
    name: '0017_transactional_integrity',
    sql: `
      -- Older builds allowed the same rider to cast one confirmation and one
      -- denial because vote was part of the primary key. Keep one
      -- deterministic vote per rider/report, then rebuild the aggregates so
      -- existing counts match the surviving source-of-truth rows.
      DELETE FROM hazard_report_votes kept
      USING hazard_report_votes duplicate
      WHERE kept.report_id = duplicate.report_id
        AND kept.rider_id = duplicate.rider_id
        AND kept.vote = 'deny'
        AND duplicate.vote = 'confirm';

      ALTER TABLE hazard_report_votes DROP CONSTRAINT IF EXISTS hazard_report_votes_pkey;
      ALTER TABLE hazard_report_votes
        ADD CONSTRAINT hazard_report_votes_pkey PRIMARY KEY (report_id, rider_id);
      ALTER TABLE hazard_report_votes DROP CONSTRAINT IF EXISTS hazard_report_votes_vote_check;
      ALTER TABLE hazard_report_votes
        ADD CONSTRAINT hazard_report_votes_vote_check CHECK (vote IN ('confirm', 'deny'));

      DELETE FROM hazard_report_votes votes
      WHERE NOT EXISTS (SELECT 1 FROM hazard_reports report WHERE report.id = votes.report_id);

      ALTER TABLE hazard_report_votes DROP CONSTRAINT IF EXISTS hazard_report_votes_report_fk;
      ALTER TABLE hazard_report_votes
        ADD CONSTRAINT hazard_report_votes_report_fk
        FOREIGN KEY (report_id) REFERENCES hazard_reports (id) ON DELETE CASCADE;

      UPDATE hazard_reports report
      SET confirmations = (
            SELECT COUNT(*)::integer FROM hazard_report_votes vote
            WHERE vote.report_id = report.id AND vote.vote = 'confirm'
          ),
          denials = (
            SELECT COUNT(*)::integer FROM hazard_report_votes vote
            WHERE vote.report_id = report.id AND vote.vote = 'deny'
          );

      -- Collapse any pre-existing duplicate pending requests before adding
      -- an undirected uniqueness rule for future concurrent inserts.
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY LEAST(from_rider_id, to_rider_id), GREATEST(from_rider_id, to_rider_id)
          ORDER BY created_at ASC, id ASC
        ) AS position
        FROM friend_requests
        WHERE status = 'pending'
      )
      UPDATE friend_requests request
      SET status = 'declined'
      FROM ranked
      WHERE request.id = ranked.id AND ranked.position > 1;

      CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_idx
        ON friend_requests (
          LEAST(from_rider_id, to_rider_id),
          GREATEST(from_rider_id, to_rider_id)
        )
        WHERE status = 'pending';
    `,
  },
  {
    name: '0018_presence_evidence_and_pairs',
    sql: `
      ALTER TABLE rider_presence
        ADD COLUMN IF NOT EXISTS accuracy_meters DOUBLE PRECISION NOT NULL DEFAULT 0;

      ALTER TABLE rider_presence DROP CONSTRAINT IF EXISTS rider_presence_lat_check;
      ALTER TABLE rider_presence
        ADD CONSTRAINT rider_presence_lat_check CHECK (lat BETWEEN -90 AND 90);
      ALTER TABLE rider_presence DROP CONSTRAINT IF EXISTS rider_presence_lon_check;
      ALTER TABLE rider_presence
        ADD CONSTRAINT rider_presence_lon_check CHECK (lon BETWEEN -180 AND 180);
      ALTER TABLE rider_presence DROP CONSTRAINT IF EXISTS rider_presence_accuracy_check;
      ALTER TABLE rider_presence
        ADD CONSTRAINT rider_presence_accuracy_check CHECK (accuracy_meters BETWEEN 0 AND 100);
      ALTER TABLE rider_presence DROP CONSTRAINT IF EXISTS rider_presence_radius_check;
      ALTER TABLE rider_presence
        ADD CONSTRAINT rider_presence_radius_check CHECK (radius_miles > 0 AND radius_miles <= 20);

      CREATE INDEX IF NOT EXISTS rider_presence_lat_lon_idx
        ON rider_presence (lat, lon);
      CREATE INDEX IF NOT EXISTS rider_presence_updated_at_idx
        ON rider_presence (updated_at);

      CREATE TABLE IF NOT EXISTS presence_zone_pairs (
        rider_a TEXT NOT NULL REFERENCES rider_presence (rider_id) ON DELETE CASCADE,
        rider_b TEXT NOT NULL REFERENCES rider_presence (rider_id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (rider_a, rider_b),
        CONSTRAINT presence_zone_pairs_order_check CHECK (rider_a < rider_b)
      );
      CREATE INDEX IF NOT EXISTS presence_zone_pairs_rider_b_idx
        ON presence_zone_pairs (rider_b);
    `,
  },
  {
    name: '0019_account_session_management',
    sql: `
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS password_algorithm TEXT NOT NULL DEFAULT 'scrypt-v1';

      ALTER TABLE account_sessions ADD COLUMN IF NOT EXISTS id TEXT;
      ALTER TABLE account_sessions
        ADD COLUMN IF NOT EXISTS device_name TEXT NOT NULL DEFAULT 'Unknown device';
      ALTER TABLE account_sessions
        ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
      UPDATE account_sessions SET id = md5(token_hash) WHERE id IS NULL;
      ALTER TABLE account_sessions ALTER COLUMN id SET NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS account_sessions_id_idx ON account_sessions (id);
      ALTER TABLE account_sessions DROP CONSTRAINT IF EXISTS account_sessions_device_name_check;
      ALTER TABLE account_sessions
        ADD CONSTRAINT account_sessions_device_name_check CHECK (char_length(device_name) BETWEEN 1 AND 120);
    `,
  },
  {
    name: '0020_password_recovery',
    sql: `
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id);
      CREATE INDEX IF NOT EXISTS password_resets_expires_at_idx ON password_resets (expires_at);
    `,
  },
  {
    name: '0021_hazard_spatial_integrity',
    sql: `
      DELETE FROM hazard_reports
      WHERE NOT (lat BETWEEN -90 AND 90)
         OR NOT (lon BETWEEN -180 AND 180)
         OR type NOT IN ('police', 'accident', 'hazard', 'road_closure', 'camera')
         OR confirmations < 0 OR denials < 0;

      ALTER TABLE hazard_reports DROP CONSTRAINT IF EXISTS hazard_reports_lat_check;
      ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_lat_check CHECK (lat BETWEEN -90 AND 90);
      ALTER TABLE hazard_reports DROP CONSTRAINT IF EXISTS hazard_reports_lon_check;
      ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_lon_check CHECK (lon BETWEEN -180 AND 180);
      ALTER TABLE hazard_reports DROP CONSTRAINT IF EXISTS hazard_reports_type_check;
      ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_type_check
        CHECK (type IN ('police', 'accident', 'hazard', 'road_closure', 'camera'));
      ALTER TABLE hazard_reports DROP CONSTRAINT IF EXISTS hazard_reports_vote_counts_check;
      ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_vote_counts_check
        CHECK (confirmations >= 0 AND denials >= 0);

      CREATE INDEX IF NOT EXISTS hazard_reports_lat_lon_idx ON hazard_reports (lat, lon);
      CREATE INDEX IF NOT EXISTS hazard_reports_expires_at_idx ON hazard_reports (expires_at);
    `,
  },
  {
    name: '0022_message_cursor_pagination',
    sql: `
      ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS conversation_key TEXT;
      UPDATE direct_messages
      SET conversation_key = LEAST(from_rider_id, to_rider_id) || ':' || GREATEST(from_rider_id, to_rider_id)
      WHERE conversation_key IS NULL;
      ALTER TABLE direct_messages ALTER COLUMN conversation_key SET NOT NULL;
      CREATE INDEX IF NOT EXISTS direct_messages_conversation_cursor_idx
        ON direct_messages (conversation_key, seq DESC);
    `,
  },
  {
    name: '0023_friend_cursor_pagination',
    sql: `
      CREATE INDEX IF NOT EXISTS friendships_rider_cursor_idx
        ON friendships (rider_id, created_at DESC, friend_id DESC);
      CREATE INDEX IF NOT EXISTS friend_requests_rider_cursor_idx
        ON friend_requests (created_at DESC, id DESC)
        WHERE status = 'pending';
    `,
  },
  {
    name: '0024_direct_message_read_state',
    sql: `
      CREATE TABLE IF NOT EXISTS direct_message_reads (
        rider_id TEXT NOT NULL,
        conversation_key TEXT NOT NULL,
        last_read_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (rider_id, conversation_key)
      );
      CREATE INDEX IF NOT EXISTS direct_messages_incoming_unread_idx
        ON direct_messages (conversation_key, to_rider_id, seq DESC);
      CREATE INDEX IF NOT EXISTS direct_messages_recipient_unread_idx
        ON direct_messages (to_rider_id, seq DESC);
    `,
  },
  {
    name: '0025_rider_blocks_reverse_lookup',
    sql: `
      CREATE INDEX IF NOT EXISTS rider_blocks_blocked_rider_idx
        ON rider_blocks (blocked_rider_id, rider_id);
    `,
  },
  {
    name: '0026_social_rate_events',
    sql: `
      CREATE TABLE IF NOT EXISTS social_rate_events (
        id BIGSERIAL PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('friend_request', 'direct_message', 'safety_report')),
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS social_rate_events_actor_action_idx
        ON social_rate_events (actor_id, action, created_at);
      CREATE INDEX IF NOT EXISTS social_rate_events_created_at_idx
        ON social_rate_events (created_at);
    `,
  },
  {
    name: '0027_social_activity_realtime',
    sql: `
      CREATE TABLE IF NOT EXISTS rider_activity (
        rider_id TEXT PRIMARY KEY,
        last_seen_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rider_activity_last_seen_idx
        ON rider_activity (last_seen_at);

      CREATE TABLE IF NOT EXISTS social_events (
        seq BIGSERIAL PRIMARY KEY,
        rider_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (
          event_type IN ('message', 'message_read', 'friend_request', 'friend_request_resolved', 'friend_removed')
        ),
        actor_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS social_events_rider_seq_idx
        ON social_events (rider_id, seq);
      CREATE INDEX IF NOT EXISTS social_events_created_at_idx
        ON social_events (created_at);
    `,
  },
  {
    name: '0028_social_refresh_events',
    sql: `
      ALTER TABLE social_events DROP CONSTRAINT IF EXISTS social_events_event_type_check;
      ALTER TABLE social_events ADD CONSTRAINT social_events_event_type_check CHECK (
        event_type IN ('message', 'message_read', 'friend_request', 'friend_request_resolved', 'friend_removed', 'social_refresh')
      );
    `,
  },
  {
    name: '0029_social_event_actor_index',
    sql: `
      CREATE INDEX IF NOT EXISTS social_events_actor_idx
        ON social_events (actor_id);
    `,
  },
  {
    name: '0030_scrypt_v2_default',
    sql: `
      ALTER TABLE users ALTER COLUMN password_algorithm SET DEFAULT 'scrypt-v2';
    `,
  },
  {
    // Adds two new police-presence report types (distinct from the generic
    // `police` type: out-of-sight vs. a staffed roadside checkpoint) without
    // touching any existing row -- this only widens the CHECK constraint
    // from #0021, same DROP/ADD pattern it used.
    name: '0031_widen_hazard_report_types',
    sql: `
      ALTER TABLE hazard_reports DROP CONSTRAINT IF EXISTS hazard_reports_type_check;
      ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_type_check
        CHECK (type IN ('police', 'accident', 'hazard', 'road_closure', 'camera', 'hidden_police', 'police_checkpoint'));
    `,
  },
  {
    name: '0032_durable_api_rate_limits',
    sql: `
      CREATE TABLE IF NOT EXISTS rate_limit_events (
        id BIGSERIAL PRIMARY KEY,
        subject_key TEXT NOT NULL,
        action TEXT NOT NULL CHECK (
          action IN ('auth', 'api', 'ride_join_rider', 'ride_join_ip', 'hazard_create', 'verification_resend', 'password_reset_request')
        ),
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rate_limit_events_subject_action_idx
        ON rate_limit_events (subject_key, action, created_at);
      CREATE INDEX IF NOT EXISTS rate_limit_events_created_at_idx
        ON rate_limit_events (created_at);
    `,
  },
  {
    // The durable API limiter's action column is constrained so unknown
    // limiter buckets fail closed. Widen it explicitly for the authenticated
    // server-side Directions proxy rather than weakening the constraint.
    name: '0033_add_directions_rate_limit_action',
    sql: `
      ALTER TABLE rate_limit_events DROP CONSTRAINT IF EXISTS rate_limit_events_action_check;
      ALTER TABLE rate_limit_events ADD CONSTRAINT rate_limit_events_action_check
        CHECK (
          action IN ('auth', 'api', 'ride_join_rider', 'ride_join_ip', 'hazard_create', 'directions', 'verification_resend', 'password_reset_request')
        );
    `,
  },
  {
    // Potholes are no longer a Rider Comms report category. Reports are
    // short-lived, so remove any remaining legacy rows before tightening the
    // database constraint to the six supported categories.
    name: '0034_remove_pothole_reports',
    sql: `
      DELETE FROM hazard_reports WHERE type = 'hazard';
      ALTER TABLE hazard_reports DROP CONSTRAINT IF EXISTS hazard_reports_type_check;
      ALTER TABLE hazard_reports ADD CONSTRAINT hazard_reports_type_check
        CHECK (type IN ('police', 'accident', 'road_closure', 'camera', 'hidden_police', 'police_checkpoint'));
    `,
  },
];

/**
 * Grants admin on whatever rider IDs are listed in the ADMIN_RIDER_IDS env
 * var (comma-separated). Runs once per process, right after migrations, and
 * is safe to run on every boot: it only ever sets is_admin true for those
 * IDs, never revokes it from anyone else, so removing an ID from the env
 * var later doesn't silently demote them -- that's a deliberate manual
 * step, not something a redeploy should do automatically.
 */
async function bootstrapAdmins(client: PoolClient): Promise<void> {
  const riderIds = (process.env.ADMIN_RIDER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (riderIds.length === 0) return;
  await client.query('UPDATE users SET is_admin = true WHERE id = ANY($1::text[])', [riderIds]);
}

export function databaseSslOptions(connectionString: string, caCertificate = process.env.DATABASE_CA_CERT): ConnectionOptions | undefined {
  const mode = new URL(connectionString).searchParams.get('sslmode');
  if (!mode || mode === 'disable') return undefined;
  if (!['require', 'verify-ca', 'verify-full'].includes(mode)) {
    throw new Error(`Unsupported database sslmode: ${mode}`);
  }
  const ca = caCertificate?.replace(/\\n/g, '\n').trim();
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

function buildPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set; account signup/login requires Postgres to be configured.');
  }
  return new Pool({
    connectionString,
    // Private Railway networking is plaintext and omits sslmode. External
    // TLS connections verify the server certificate against either the
    // system trust store or DATABASE_CA_CERT; unverified TLS is forbidden.
    ssl: databaseSslOptions(connectionString),
    connectionTimeoutMillis: 5_000,
  });
}

export function getPool(): Pool {
  if (!pool) pool = buildPool();
  return pool;
}

// Arbitrary fixed key for the session-level advisory lock below -- any
// int8 works, it just needs to be the same constant every time.
const MIGRATION_LOCK_KEY = 8_218_004_211_733;

async function runMigrations(client: PoolClient): Promise<void> {
  // ensureMigrated()'s in-memory promise only serializes callers within a
  // single process. That's not enough: multiple processes connecting to a
  // genuinely fresh database (every backend test file runs as its own
  // process, and this matters for the real deployed backend too if it's
  // ever run as more than one instance) can each see "table doesn't exist
  // yet" and race to run the same CREATE TABLE IF NOT EXISTS concurrently --
  // which Postgres does not make safe on its own; two transactions racing
  // to create the same relation can genuinely fail with a duplicate catalog
  // key error despite the IF NOT EXISTS guard. A session-level advisory
  // lock serializes every connection across every process against the same
  // key, so only one migration run ever executes DDL at a time; everyone
  // else waits, then finds the migrations already applied and no-ops.
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}

/** Runs migrations exactly once per process, no matter how many callers race for it. */
export function ensureMigrated(): Promise<void> {
  if (!migrationsRun) {
    migrationsRun = (async () => {
      const client = await getPool().connect();
      try {
        await runMigrations(client);
        await bootstrapAdmins(client);
      } finally {
        client.release();
      }
    })();
  }
  return migrationsRun;
}

/** Readiness means both schema compatibility and a live database query. */
export async function checkDatabaseReady(): Promise<void> {
  await ensureMigrated();
  await getPool().query('SELECT 1');
}

/** Drain every database connection during graceful process shutdown. */
export async function closeDatabase(): Promise<void> {
  if (!pool) return;
  const currentPool = pool;
  pool = undefined;
  migrationsRun = undefined;
  await currentPool.end();
}

/** Test-only: drop the cached pool/migration state so a fresh DATABASE_URL takes effect. */
export async function resetDbForTests(): Promise<void> {
  await closeDatabase();
}
