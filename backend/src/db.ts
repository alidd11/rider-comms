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
