import type { PoolClient } from 'pg';
import type { SocialEvent, SocialEventPage, SocialEventType } from '@rider-comms/shared';
import { ensureMigrated, getPool } from './db.ts';

const SOCIAL_EVENT_CHANNEL = 'rider_social_events';
export const SOCIAL_EVENT_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const MAX_SOCIAL_EVENT_WAIT_MS = 25_000;

interface EventRow {
  seq: string | number;
  event_type: string;
  actor_id: string;
  entity_id: string;
  created_at: string | number;
}

type QueryClient = Pick<PoolClient, 'query'>;

export class InvalidSocialEventCursorError extends Error {
  constructor() {
    super('invalid social event cursor');
    this.name = 'InvalidSocialEventCursorError';
  }
}

export function encodeSocialEventCursor(seq: string | number): string {
  return Buffer.from(String(seq), 'utf8').toString('base64url');
}

export function decodeSocialEventCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  if (!cursor || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidSocialEventCursorError();
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^\d+$/.test(decoded) || encodeSocialEventCursor(decoded) !== cursor) {
    throw new InvalidSocialEventCursorError();
  }
  return decoded;
}

/**
 * Appends one recipient-scoped invalidation event. When called inside an
 * existing transaction, PostgreSQL delivers the NOTIFY only after COMMIT, so
 * a waiting client can never wake up for social state that later rolls back.
 */
export async function appendSocialEvent(
  client: QueryClient,
  riderId: string,
  type: SocialEventType,
  actorRiderId: string,
  entityId: string,
  createdAt = Date.now(),
): Promise<string> {
  const { rows } = await client.query<{ seq: string | number }>(
    `INSERT INTO social_events (rider_id, event_type, actor_id, entity_id, created_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING seq`,
    [riderId, type, actorRiderId, entityId, createdAt],
  );
  await client.query(`SELECT pg_notify('${SOCIAL_EVENT_CHANNEL}', $1)`, [riderId]);
  return encodeSocialEventCursor(rows[0]?.seq ?? 0);
}

function rowToEvent(row: EventRow): SocialEvent {
  return {
    cursor: encodeSocialEventCursor(row.seq),
    type: row.event_type as SocialEventType,
    actorRiderId: row.actor_id,
    entityId: row.entity_id,
    createdAt: Number(row.created_at),
  };
}

/**
 * Durable recipient-scoped event feed with LISTEN/NOTIFY wakeups.
 *
 * Clients establish a baseline cursor, then long-poll with that cursor. The
 * event table provides replay after transient disconnects; NOTIFY only wakes
 * the pending request, so delivery remains correct even if notifications are
 * coalesced or a backend replica restarts.
 */
export class SocialEventStore {
  private listenerClient?: PoolClient;
  private listenerStart?: Promise<PoolClient>;
  private readonly waiters = new Map<string, Set<() => void>>();
  private closed = false;

  private wake(riderId: string): void {
    const riderWaiters = this.waiters.get(riderId);
    if (!riderWaiters) return;
    for (const resolve of [...riderWaiters]) resolve();
  }

  private wakeAll(): void {
    for (const riderWaiters of this.waiters.values()) {
      for (const resolve of [...riderWaiters]) resolve();
    }
  }

  private async ensureListener(): Promise<PoolClient> {
    if (this.closed) throw new Error('social event store is closed');
    if (this.listenerClient) return this.listenerClient;
    if (!this.listenerStart) {
      this.listenerStart = (async () => {
        await ensureMigrated();
        const client = await getPool().connect();
        try {
          await client.query(`LISTEN ${SOCIAL_EVENT_CHANNEL}`);
        } catch (error) {
          client.release();
          throw error;
        }
        client.on('notification', (message) => {
          if (message.channel === SOCIAL_EVENT_CHANNEL && message.payload) this.wake(message.payload);
        });
        client.on('error', () => {
          if (this.listenerClient === client) this.listenerClient = undefined;
          this.wakeAll();
        });
        this.listenerClient = client;
        return client;
      })().finally(() => {
        this.listenerStart = undefined;
      });
    }
    return this.listenerStart;
  }

  private async listAfter(riderId: string, afterSeq: string, limit: number): Promise<SocialEventPage> {
    await ensureMigrated();
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const { rows } = await getPool().query<EventRow>(
      `SELECT seq, event_type, actor_id, entity_id, created_at
       FROM social_events
       WHERE rider_id = $1 AND seq > $2::bigint
       ORDER BY seq ASC
       LIMIT $3`,
      [riderId, afterSeq, boundedLimit + 1],
    );
    const hasMore = rows.length > boundedLimit;
    const selected = rows.slice(0, boundedLimit);
    const events = selected.map(rowToEvent);
    return {
      events,
      cursor: events.at(-1)?.cursor ?? encodeSocialEventCursor(afterSeq),
      hasMore,
    };
  }

  /** Returns an empty page positioned at the recipient's current event tail. */
  async establishCursor(riderId: string): Promise<SocialEventPage> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ seq: string }>(
      `SELECT COALESCE(MAX(seq), 0)::text AS seq
       FROM social_events
       WHERE rider_id = $1`,
      [riderId],
    );
    return { events: [], cursor: encodeSocialEventCursor(rows[0]?.seq ?? '0'), hasMore: false };
  }

  async waitForEvents(
    riderId: string,
    afterCursor: string | undefined,
    limit = 100,
    waitMs = MAX_SOCIAL_EVENT_WAIT_MS,
    signal?: AbortSignal,
  ): Promise<SocialEventPage> {
    const afterSeq = decodeSocialEventCursor(afterCursor);
    if (afterSeq === undefined) return this.establishCursor(riderId);
    const boundedWaitMs = Math.min(Math.max(Math.trunc(waitMs), 0), MAX_SOCIAL_EVENT_WAIT_MS);

    let page = await this.listAfter(riderId, afterSeq, limit);
    if (page.events.length > 0 || page.hasMore || boundedWaitMs === 0 || signal?.aborted) return page;

    await this.ensureListener();

    let settled = false;
    let resolveWake!: () => void;
    const wakePromise = new Promise<void>((resolve) => { resolveWake = resolve; });
    const riderWaiters = this.waiters.get(riderId) ?? new Set<() => void>();
    this.waiters.set(riderId, riderWaiters);

    let timer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      riderWaiters.delete(onWake);
      if (riderWaiters.size === 0) this.waiters.delete(riderId);
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onWake);
      resolveWake();
    };
    const onWake = () => cleanup();

    riderWaiters.add(onWake);
    timer = setTimeout(onWake, boundedWaitMs);
    timer.unref();
    signal?.addEventListener('abort', onWake, { once: true });

    // Re-query after the waiter is registered. This closes the race between
    // the initial SELECT and LISTEN/waiter registration.
    page = await this.listAfter(riderId, afterSeq, limit);
    if (page.events.length > 0 || page.hasMore) {
      cleanup();
      return page;
    }

    await wakePromise;
    if (signal?.aborted) return { events: [], cursor: encodeSocialEventCursor(afterSeq), hasMore: false };
    return this.listAfter(riderId, afterSeq, limit);
  }

  async cleanupExpired(now = Date.now()): Promise<number> {
    await ensureMigrated();
    const result = await getPool().query(
      'DELETE FROM social_events WHERE created_at < $1',
      [now - SOCIAL_EVENT_RETENTION_MS],
    );
    return result.rowCount ?? 0;
  }

  async deleteRider(riderId: string): Promise<void> {
    await ensureMigrated();
    await getPool().query(
      'DELETE FROM social_events WHERE rider_id = $1 OR actor_id = $1',
      [riderId],
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    this.wakeAll();
    const client = this.listenerClient ?? (this.listenerStart ? await this.listenerStart.catch(() => undefined) : undefined);
    this.listenerClient = undefined;
    if (!client) return;
    try {
      await client.query(`UNLISTEN ${SOCIAL_EVENT_CHANNEL}`);
    } finally {
      client.release();
    }
  }
}
