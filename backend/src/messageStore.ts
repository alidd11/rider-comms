import { randomUUID } from 'node:crypto';
import type { DirectMessage } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

interface DirectMessageRow {
  id: string;
  from_rider_id: string;
  to_rider_id: string;
  text: string;
  created_at: string | number;
}

function rowToMessage(row: DirectMessageRow): DirectMessage {
  return {
    id: row.id,
    fromRiderId: row.from_rider_id,
    toRiderId: row.to_rider_id,
    text: row.text,
    createdAt: Number(row.created_at),
  };
}

/**
 * Direct messages between friends, persisted in Postgres (see db.ts).
 * Poll-based, same as presence (see presenceStore.ts) — there's no
 * websocket/push infra in this prototype, so a thread's history is fetched
 * with GET /messages and the client is expected to poll it, same as it
 * polls /presence.
 */
export class MessageStore {
  async create(fromRiderId: string, toRiderId: string, text: string): Promise<DirectMessage> {
    await ensureMigrated();
    const message: DirectMessage = {
      id: randomUUID(),
      fromRiderId,
      toRiderId,
      text,
      createdAt: Date.now(),
    };
    await getPool().query(
      'INSERT INTO direct_messages (id, from_rider_id, to_rider_id, text, created_at) VALUES ($1, $2, $3, $4, $5)',
      [message.id, message.fromRiderId, message.toRiderId, message.text, message.createdAt]
    );
    return message;
  }

  async getThread(riderId: string, withRiderId: string, limit = 100): Promise<DirectMessage[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<DirectMessageRow>(
      `SELECT * FROM direct_messages
       WHERE (from_rider_id = $1 AND to_rider_id = $2) OR (from_rider_id = $2 AND to_rider_id = $1)
       ORDER BY created_at ASC, seq ASC`,
      [riderId, withRiderId]
    );
    const thread = rows.map(rowToMessage);
    return thread.slice(-Math.max(1, limit));
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM direct_messages WHERE from_rider_id = $1 OR to_rider_id = $1', [riderId]);
  }
}
