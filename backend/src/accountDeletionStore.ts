import type { Pool, PoolClient } from 'pg';
import { ensureMigrated, getPool } from './db.ts';

type DeletionClient = Pick<PoolClient, 'query' | 'release'>;
type DeletionPool = Pick<Pool, 'connect'>;

interface AccountDeletionDependencies {
  ensureMigrated: () => Promise<void>;
  getPool: () => DeletionPool;
}

const defaultDependencies: AccountDeletionDependencies = {
  ensureMigrated,
  getPool,
};

/**
 * Deletes every durable row associated with a rider in one transaction.
 *
 * The schema deliberately supports guest riders that do not have a `users`
 * row, so most rider-owned tables cannot currently use a foreign key to
 * `users`. Keep the complete deletion set here rather than spreading it
 * across store methods: either every delete commits, or none of them do.
 */
export class AccountDeletionStore {
  private readonly dependencies: AccountDeletionDependencies;

  constructor(dependencies: AccountDeletionDependencies = defaultDependencies) {
    this.dependencies = dependencies;
  }

  async deleteRider(riderId: string): Promise<void> {
    await this.dependencies.ensureMigrated();
    const client = await this.dependencies.getPool().connect() as DeletionClient;
    try {
      await client.query('BEGIN');

      // Remove dependent rows before their owners. The ride-location and
      // hideout-participant foreign keys handle their respective cascades.
      await client.query('DELETE FROM ride_members WHERE rider_id = $1', [riderId]);
      await client.query('DELETE FROM rides WHERE created_by = $1', [riderId]);
      await client.query('DELETE FROM friendships WHERE rider_id = $1 OR friend_id = $1', [riderId]);
      await client.query('DELETE FROM friend_requests WHERE from_rider_id = $1 OR to_rider_id = $1', [riderId]);
      await client.query('DELETE FROM direct_messages WHERE from_rider_id = $1 OR to_rider_id = $1', [riderId]);
      await client.query('DELETE FROM hideout_participants WHERE rider_id = $1', [riderId]);
      await client.query('DELETE FROM hideouts WHERE created_by = $1', [riderId]);
      await client.query('DELETE FROM rider_presence WHERE rider_id = $1', [riderId]);
      await client.query('DELETE FROM rider_profiles WHERE rider_id = $1', [riderId]);
      await client.query('DELETE FROM rider_blocks WHERE rider_id = $1 OR blocked_rider_id = $1', [riderId]);
      await client.query('DELETE FROM safety_reports WHERE reporter_id = $1 OR reported_rider_id = $1', [riderId]);
      await client.query(
        'DELETE FROM hazard_report_votes WHERE rider_id = $1 OR report_id IN (SELECT id FROM hazard_reports WHERE reported_by = $1)',
        [riderId],
      );
      await client.query('DELETE FROM hazard_reports WHERE reported_by = $1', [riderId]);
      await client.query('DELETE FROM scenic_routes WHERE created_by = $1', [riderId]);

      // Sessions and email-verification tokens cascade from a persistent
      // account. Guest riders have no users row, which is an intentional no-op.
      await client.query('DELETE FROM users WHERE id = $1', [riderId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
