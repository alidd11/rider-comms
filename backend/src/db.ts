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
    name: '0002_create_friend_tables',
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
    name: '0003_create_hazard_reports',
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
    name: '0004_create_messages',
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
    name: '0005_create_moderation_tables',
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
    name: '0006_create_hideouts',
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
    name: '0007_create_scenic_routes',
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
];

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

async function runMigrations(client: PoolClient): Promise<void> {
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
}

/** Runs migrations exactly once per process, no matter how many callers race for it. */
export function ensureMigrated(): Promise<void> {
  if (!migrationsRun) {
    migrationsRun = (async () => {
      const client = await getPool().connect();
      try {
        await runMigrations(client);
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
