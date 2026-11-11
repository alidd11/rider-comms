import { ensureMigrated, getPool } from './db.ts';
import { generateVapidKeys, type VapidKeys } from './webPush.ts';

export type PushKind = 'web' | 'expo';

export interface PushSubscriptionRecord {
  riderId: string;
  kind: PushKind;
  /** Web: the push service endpoint URL. Expo: the ExponentPushToken. */
  address: string;
  p256dh: string | null;
  auth: string | null;
  /** The sign-in that registered it; revoking that session removes the device. */
  sessionTokenHash?: string | null;
}

interface SubscriptionRow {
  rider_id: string;
  kind: PushKind;
  address: string;
  p256dh: string | null;
  auth: string | null;
}

const MAX_SUBSCRIPTIONS_PER_RIDER = 10;

/**
 * Where to deliver each rider's notifications: one row per device (a
 * browser's push subscription or a phone's Expo token), plus this server's
 * VAPID key pair, generated once and kept in Postgres so it survives
 * restarts and deploys without any configuration.
 */
export class PushStore {
  private vapid: Promise<VapidKeys> | null = null;

  getVapidKeys(): Promise<VapidKeys> {
    this.vapid ??= (async () => {
      await ensureMigrated();
      const pool = getPool();
      const generated = generateVapidKeys();
      // Two instances starting together: whichever inserts first wins, and
      // both read back the same pair.
      await pool.query(
        `INSERT INTO server_keys (name, value, created_at) VALUES ('vapid', $1, $2) ON CONFLICT (name) DO NOTHING`,
        [JSON.stringify(generated), Date.now()],
      );
      const { rows } = await pool.query<{ value: VapidKeys | string }>(`SELECT value FROM server_keys WHERE name = 'vapid'`);
      const value = rows[0]?.value;
      if (!value) throw new Error('VAPID keys missing');
      return typeof value === 'string' ? JSON.parse(value) as VapidKeys : value;
    })().catch((error) => {
      this.vapid = null;
      throw error;
    });
    return this.vapid;
  }

  /** Saves a device for this rider. A device moving to another account moves with it. */
  async upsert(record: PushSubscriptionRecord, now = Date.now()): Promise<void> {
    await ensureMigrated();
    const pool = getPool();
    await pool.query(
      `INSERT INTO push_subscriptions (rider_id, kind, address, p256dh, auth, session_token_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (address) DO UPDATE SET
         rider_id = EXCLUDED.rider_id, kind = EXCLUDED.kind, p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth, session_token_hash = EXCLUDED.session_token_hash, updated_at = EXCLUDED.updated_at`,
      [record.riderId, record.kind, record.address, record.p256dh, record.auth, record.sessionTokenHash ?? null, now],
    );
    // Keep the newest few devices per rider; old browsers otherwise pile up.
    await pool.query(
      `DELETE FROM push_subscriptions WHERE rider_id = $1 AND address NOT IN (
         SELECT address FROM push_subscriptions WHERE rider_id = $1 ORDER BY updated_at DESC LIMIT $2
       )`,
      [record.riderId, MAX_SUBSCRIPTIONS_PER_RIDER],
    );
  }

  /** Removes one of this rider's devices (signing out, or switching notifications off). */
  async remove(riderId: string, address: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM push_subscriptions WHERE rider_id = $1 AND address = $2', [riderId, address]);
  }

  /** Removes devices the push service says no longer exist. */
  async removeAddresses(addresses: readonly string[]): Promise<void> {
    if (addresses.length === 0) return;
    await ensureMigrated();
    await getPool().query('DELETE FROM push_subscriptions WHERE address = ANY($1::text[])', [addresses]);
  }

  async listForRider(riderId: string): Promise<PushSubscriptionRecord[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<SubscriptionRow>(
      'SELECT rider_id, kind, address, p256dh, auth FROM push_subscriptions WHERE rider_id = $1 ORDER BY updated_at DESC',
      [riderId],
    );
    return rows.map((row) => ({ riderId: row.rider_id, kind: row.kind, address: row.address, p256dh: row.p256dh, auth: row.auth }));
  }
}
