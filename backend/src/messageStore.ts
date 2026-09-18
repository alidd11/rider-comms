import { randomUUID } from 'node:crypto';
import type { DirectMessage } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';
import { appendSocialEvent } from './socialEventStore.ts';

interface DirectMessageRow {
  id: string;
  from_rider_id: string;
  to_rider_id: string;
  text: string;
  created_at: string | number;
  seq: string | number;
}

interface ConversationRow extends DirectMessageRow {
  friend_rider_id: string;
  display_name: string | null;
  handle: string | null;
  avatar_id: string | null;
  unread_count: string | number;
}

export interface MessagePage {
  messages: DirectMessage[];
  nextCursor: string | null;
}

export interface ConversationSummary {
  friend: {
    riderId: string;
    displayName: string;
    handle: string;
    avatarId: string;
  };
  lastMessage: DirectMessage;
  unreadCount: number;
}

export interface ConversationPage {
  conversations: ConversationSummary[];
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

function rowToConversation(row: ConversationRow): ConversationSummary {
  return {
    friend: {
      riderId: row.friend_rider_id,
      displayName: row.display_name ?? 'Rider',
      handle: row.handle ?? `@${row.friend_rider_id.replace(/^rider_/, '')}`,
      avatarId: row.avatar_id ?? 'ember',
    },
    lastMessage: rowToMessage(row),
    unreadCount: Number(row.unread_count),
  };
}

/**
 * Direct messages between friends, persisted in Postgres (see db.ts).
 * Thread history, conversation summaries and per-rider read state all use
 * insertion-order sequence numbers so pagination and unread counts remain
 * stable even when several messages share the same millisecond timestamp.
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
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO direct_messages (id, from_rider_id, to_rider_id, text, created_at, conversation_key) VALUES ($1, $2, $3, $4, $5, $6)',
        [message.id, message.fromRiderId, message.toRiderId, message.text, message.createdAt, conversationKey(message.fromRiderId, message.toRiderId)]
      );
      await appendSocialEvent(client, toRiderId, 'message', fromRiderId, message.id, message.createdAt);
      await client.query('COMMIT');
      return message;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

  /**
   * Returns only conversations with current friends. A lateral lookup uses
   * the conversation cursor index to fetch one latest message per friendship;
   * unread counts include only messages addressed to the requesting rider.
   */
  async getConversationPage(riderId: string, limit = 50, before?: string): Promise<ConversationPage> {
    await ensureMigrated();
    const beforeSeq = decodeMessageCursor(before);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const { rows } = await getPool().query<ConversationRow>(
      `SELECT friendship.friend_id AS friend_rider_id,
              profile.display_name, profile.handle, profile.avatar_id,
              latest.id, latest.from_rider_id, latest.to_rider_id, latest.text,
              latest.created_at, latest.seq,
              (
                SELECT COUNT(*)
                FROM direct_messages unread
                WHERE unread.conversation_key = latest.conversation_key
                  AND unread.to_rider_id = $1
                  AND unread.seq > COALESCE((
                    SELECT read_state.last_read_seq
                    FROM direct_message_reads read_state
                    WHERE read_state.rider_id = $1
                      AND read_state.conversation_key = latest.conversation_key
                  ), 0)
              ) AS unread_count
       FROM friendships friendship
       JOIN LATERAL (
         SELECT id, from_rider_id, to_rider_id, text, created_at, seq, conversation_key
         FROM direct_messages
         WHERE conversation_key = LEAST($1::text, friendship.friend_id)
           || ':' || GREATEST($1::text, friendship.friend_id)
         ORDER BY seq DESC
         LIMIT 1
       ) latest ON TRUE
       LEFT JOIN rider_profiles profile ON profile.rider_id = friendship.friend_id
       WHERE friendship.rider_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM rider_blocks block
           WHERE (block.rider_id = $1 AND block.blocked_rider_id = friendship.friend_id)
              OR (block.rider_id = friendship.friend_id AND block.blocked_rider_id = $1)
         )
         AND ($2::bigint IS NULL OR latest.seq < $2::bigint)
       ORDER BY latest.seq DESC
       LIMIT $3`,
      [riderId, beforeSeq ?? null, boundedLimit + 1]
    );
    const hasMore = rows.length > boundedLimit;
    const selected = rows.slice(0, boundedLimit);
    return {
      conversations: selected.map(rowToConversation),
      nextCursor: hasMore && selected.length > 0 ? encodeMessageCursor(selected[selected.length - 1].seq) : null,
    };
  }

  /**
   * Marks every currently received message in one thread as read. The
   * monotonic GREATEST guard prevents an older/racing request from moving a
   * rider's read cursor backwards.
   */
  async markThreadRead(riderId: string, withRiderId: string): Promise<number> {
    await ensureMigrated();
    const key = conversationKey(riderId, withRiderId);
    const { rows } = await getPool().query<{ last_read_seq: string | number }>(
      `INSERT INTO direct_message_reads (rider_id, conversation_key, last_read_seq, updated_at)
       SELECT $1, $2, COALESCE(MAX(seq), 0), $3
       FROM direct_messages
       WHERE conversation_key = $2 AND to_rider_id = $1
       ON CONFLICT (rider_id, conversation_key) DO UPDATE SET
         last_read_seq = GREATEST(direct_message_reads.last_read_seq, EXCLUDED.last_read_seq),
         updated_at = EXCLUDED.updated_at
       RETURNING last_read_seq`,
      [riderId, key, Date.now()]
    );
    return Number(rows[0]?.last_read_seq ?? 0);
  }

  async getUnreadCount(riderId: string): Promise<number> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ unread_count: string | number }>(
      `SELECT COUNT(*) AS unread_count
       FROM direct_messages message
       WHERE message.to_rider_id = $1
         AND EXISTS (
           SELECT 1
           FROM friendships friendship
           WHERE friendship.rider_id = $1
             AND friendship.friend_id = message.from_rider_id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM rider_blocks block
           WHERE (block.rider_id = $1 AND block.blocked_rider_id = message.from_rider_id)
              OR (block.rider_id = message.from_rider_id AND block.blocked_rider_id = $1)
         )
         AND message.seq > COALESCE((
           SELECT read_state.last_read_seq
           FROM direct_message_reads read_state
           WHERE read_state.rider_id = $1
             AND read_state.conversation_key = message.conversation_key
         ), 0)`,
      [riderId]
    );
    return Number(rows[0]?.unread_count ?? 0);
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    const pool = getPool();
    await pool.query(
      `DELETE FROM direct_message_reads
       WHERE rider_id = $1
          OR conversation_key IN (
            SELECT DISTINCT conversation_key
            FROM direct_messages
            WHERE from_rider_id = $1 OR to_rider_id = $1
          )`,
      [riderId]
    );
    await pool.query('DELETE FROM direct_messages WHERE from_rider_id = $1 OR to_rider_id = $1', [riderId]);
  }
}
