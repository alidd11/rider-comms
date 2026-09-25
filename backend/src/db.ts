import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { ConnectionOptions } from 'node:tls';
import { MIGRATIONS } from './migrations.ts';

/** Lazily-initialized Postgres pool. Production startup calls
 * `ensureMigrated()` before accepting traffic; lazy initialization remains
 * useful for isolated tests and imported store modules. */
let pool: Pool | undefined;
let migrationsRun: Promise<void> | undefined;

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
