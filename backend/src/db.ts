import { Pool } from 'pg';
import type { PoolClient } from 'pg';

/**
 * Lazily-initialized Postgres pool. Nothing connects at import time — the
 * pool (and the one-time migration run) is created on first use, so a
 * backend without DATABASE_URL set keeps working for every route that
 * doesn't touch persistent storage (guest auth, all the in-memory stores).
 */
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

function buildPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set; account signup/login requires Postgres to be configured.');
  }
  // Railway's private networking (service.railway.internal) doesn't speak
  // TLS at all -- the Postgres server rejects an SSL negotiation outright.
  // Only request TLS when the connection string explicitly asks for it
  // (a hosted/external Postgres with sslmode=require), never by default.
  const wantsSsl = /sslmode=require/.test(connectionString);
  return new Pool({
    connectionString,
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
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

/** Test-only: drop the cached pool/migration state so a fresh DATABASE_URL takes effect. */
export async function resetDbForTests(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
  migrationsRun = undefined;
}
