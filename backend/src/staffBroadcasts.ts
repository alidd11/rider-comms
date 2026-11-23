import { randomUUID } from 'node:crypto';
import { ensureMigrated, getPool } from './db.ts';

/**
 * Staff push notifications to riders. A send is recorded before it starts
 * and updated with how many riders and devices it reached; the list on the
 * Staff Hub's Notifications page reads from here.
 */
export const BROADCAST_TITLE_MAX = 60;
export const BROADCAST_BODY_MAX = 180;
/** Where tapping it opens. Only these in-app pages are allowed. */
export const BROADCAST_ROUTES = ['#map', '#friends', '#settings'] as const;
export type BroadcastRoute = (typeof BROADCAST_ROUTES)[number];
/** At most one send to all riders in this window, so a slip can't spam everyone. */
export const BROADCAST_COOLDOWN_MS = 10 * 60 * 1000;

export interface BroadcastInput { title: string; body: string; route: BroadcastRoute }

export interface Broadcast extends BroadcastInput {
  id: string;
  sentBy: string;
  note: string;
  test: boolean;
  riders: number;
  devices: number;
  delivered: number;
  status: 'sending' | 'sent' | 'failed';
  createdAt: number;
  finishedAt: number | null;
}

type Row = {
  id: string; title: string; body: string; route: BroadcastRoute; sent_by: string; note: string; test: boolean;
  riders: number; devices: number; delivered: number; status: Broadcast['status']; created_at: string; finished_at: string | null;
};

const toBroadcast = (row: Row): Broadcast => ({
  id: row.id, title: row.title, body: row.body, route: row.route, sentBy: row.sent_by, note: row.note, test: row.test,
  riders: row.riders, devices: row.devices, delivered: row.delivered, status: row.status,
  createdAt: Number(row.created_at), finishedAt: row.finished_at === null ? null : Number(row.finished_at),
});

const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/** The message, or why it can't be sent. */
export function parseBroadcast(body: Record<string, unknown>): BroadcastInput | { error: string } {
  const title = clean(body.title);
  const text = clean(body.body);
  if (!title || title.length > BROADCAST_TITLE_MAX) return { error: `title must be 1-${BROADCAST_TITLE_MAX} characters` };
  if (!text || text.length > BROADCAST_BODY_MAX) return { error: `body must be 1-${BROADCAST_BODY_MAX} characters` };
  const route = body.route ?? '#map';
  if (!(BROADCAST_ROUTES as readonly unknown[]).includes(route)) return { error: 'route must be one of ' + BROADCAST_ROUTES.join(', ') };
  return { title, body: text, route: route as BroadcastRoute };
}

export class BroadcastStore {
  async start(input: BroadcastInput, sentBy: string, note: string, test: boolean, now = Date.now()): Promise<Broadcast> {
    await ensureMigrated();
    const { rows } = await getPool().query<Row>(
      `INSERT INTO push_broadcasts (id, title, body, route, sent_by, note, test, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [randomUUID(), input.title, input.body, input.route, sentBy, note, test, now],
    );
    return toBroadcast(rows[0]!);
  }

  async finish(id: string, result: { riders: number; devices: number; delivered: number } | null, now = Date.now()): Promise<void> {
    await getPool().query(
      `UPDATE push_broadcasts SET status = $2, riders = $3, devices = $4, delivered = $5, finished_at = $6 WHERE id = $1`,
      [id, result ? 'sent' : 'failed', result?.riders ?? 0, result?.devices ?? 0, result?.delivered ?? 0, now],
    );
  }

  /** When the last send to all riders started, for the cooldown. */
  async lastFullSendAt(): Promise<number | null> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ at: string | null }>('SELECT max(created_at) AS at FROM push_broadcasts WHERE NOT test');
    return rows[0]?.at ? Number(rows[0].at) : null;
  }

  async list(limit = 20): Promise<Broadcast[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<Row>('SELECT * FROM push_broadcasts ORDER BY created_at DESC LIMIT $1', [limit]);
    return rows.map(toBroadcast);
  }

  /** How many riders and devices a send to all riders would reach now. */
  async audience(): Promise<{ riders: number; devices: number }> {
    await ensureMigrated();
    const { rows } = await getPool().query<{ riders: string; devices: string }>(
      `SELECT count(DISTINCT s.rider_id) AS riders, count(*) AS devices
       FROM push_subscriptions s
       JOIN users u ON u.id = s.rider_id AND u.suspended_at IS NULL
       LEFT JOIN rider_profiles p ON p.rider_id = s.rider_id
       WHERE COALESCE(p.notify_updates, TRUE)`,
    );
    return { riders: Number(rows[0]?.riders ?? 0), devices: Number(rows[0]?.devices ?? 0) };
  }
}

export const broadcastStore = new BroadcastStore();
