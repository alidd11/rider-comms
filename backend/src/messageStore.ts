import { randomUUID } from 'node:crypto';
import type { DirectMessage } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

interface DirectMessageRow {
  id: string;
  from_rider_id: string;
  to_rider_id: string;
  text: string;
  created_at: string | number;
  seq: string | number;
}

export interface MessagePage {
  messages: DirectMessage[];
  nextCursor: string | null;
}

export class InvalidMessageCursorError extends Error {
  constructor() {
    super('invalid message cursor');
    this.name = 'InvalidMessageCursorError';
  }
}

function conversationKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function encodeMessageCursor(seq: string | number): string {
  return Buffer.from(String(seq), 'utf8').toString('base64url');
}

export function decodeMessageCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  if (!cursor || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidMessageCursorError();
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[1-9]\d*$/.test(decoded) || encodeMessageCursor(decoded) !== cursor) throw new InvalidMessageCursorError();
  return decoded;
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
      'INSERT INTO direct_messages (id, from_rider_id, to_rider_id, text, created_at, conversation_key) VALUES ($1, $2, $3, $4, $5, $6)',
      [message.id, message.fromRiderId, message.toRiderId, message.text, message.createdAt, conversationKey(message.fromRiderId, message.toRiderId)]
    );
    return message;
  }

  async getThread(riderId: string, withRiderId: string, limit = 100): Promise<DirectMessage[]> {
    return (await this.getThreadPage(riderId, withRiderId, limit)).messages;
  }

  async getThreadPage(riderId: string, withRiderId: string, limit = 100, before?: string): Promise<MessagePage> {
    await ensureMigrated();
    const beforeSeq = decodeMessageCursor(before);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const { rows } = await getPool().query<DirectMessageRow>(
      `SELECT id, from_rider_id, to_rider_id, text, created_at, seq
       FROM direct_messages
       WHERE conversation_key = $1
         AND ($2::bigint IS NULL OR seq < $2::bigint)
       ORDER BY seq DESC
       LIMIT $3`,
      [conversationKey(riderId, withRiderId), beforeSeq ?? null, boundedLimit + 1]
    );
    const hasMore = rows.length > boundedLimit;
    const selected = rows.slice(0, boundedLimit);
    return {
      messages: selected.map(rowToMessage).reverse(),
      nextCursor: hasMore && selected.length > 0 ? encodeMessageCursor(selected[selected.length - 1].seq) : null,
    };
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query('DELETE FROM direct_messages WHERE from_rider_id = $1 OR to_rider_id = $1', [riderId]);
  }
}
