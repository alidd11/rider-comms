import type { PoolClient, QueryResult } from 'pg';
import { getPool } from '../src/db.ts';

/**
 * Test-only fault injection for transactional store code. While armed, every
 * client checked out of the shared pool is wrapped so the first query inside
 * a transaction that matches `when` either throws (simulating a lost
 * connection or constraint failure) or returns `result` instead of running.
 * Queries issued through pool.query() are left alone. Returns the SQL each
 * wrapped client saw, and a disarm function that must be called.
 */
export function injectTransactionFault(options: {
  when?: (sql: string) => boolean;
  result?: Partial<QueryResult>;
  times?: number;
}): { statements: string[]; disarm: () => void } {
  const pool = getPool();
  const statements: string[] = [];
  const originalConnect = pool.connect;
  let remaining = options.times ?? 1;
  const when = options.when ?? ((sql: string) => !sql.startsWith('BEGIN') && sql !== 'ROLLBACK');
  const wrap = (client: PoolClient): PoolClient => {
    const originalQuery = client.query;
    const originalRelease = client.release;
    let inTransaction = false;
    client.query = (async (text: unknown, ...rest: unknown[]) => {
      const sql = typeof text === 'string' ? text.trim() : String((text as { text?: string }).text ?? '');
      statements.push(sql);
      if (sql.startsWith('BEGIN')) { inTransaction = true; return (originalQuery as (...args: unknown[]) => unknown).call(client, text, ...rest); }
      if (inTransaction && remaining > 0 && when(sql)) {
        remaining -= 1;
        if (options.result) return { rows: [], rowCount: 0, ...options.result };
        throw new Error('injected database failure');
      }
      return (originalQuery as (...args: unknown[]) => unknown).call(client, text, ...rest);
    }) as PoolClient['query'];
    client.release = ((...args: unknown[]) => {
      client.query = originalQuery;
      client.release = originalRelease;
      return (originalRelease as (...a: unknown[]) => void).apply(client, args);
    }) as PoolClient['release'];
    return client;
  };
  pool.connect = (async (...args: unknown[]) => {
    // pool.query() checks clients out through the callback form: leave it alone.
    if (typeof args[0] === 'function') return (originalConnect as (...a: unknown[]) => unknown).apply(pool, args);
    return wrap(await originalConnect.call(pool));
  }) as typeof pool.connect;
  return { statements, disarm: () => { pool.connect = originalConnect; } };
}
