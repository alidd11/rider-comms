import { randomUUID } from 'node:crypto';
import { ensureMigrated, getPool, withTransaction } from './db.ts';

/**
 * In-app announcements: a short notice staff schedule in the Staff Hub that
 * riders see on the map (never while they are moving). One shows at a time:
 * the newest that has started and not ended. Publishing and ending each need
 * a note and are written to the audit log.
 */
export const ANNOUNCEMENT_TITLE_MAX = 60;
export const ANNOUNCEMENT_BODY_MAX = 240;
export const ANNOUNCEMENT_TONES = ['info', 'warning'] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];
/** The longest an announcement may run, so a forgotten one can't stay up for ever. */
export const ANNOUNCEMENT_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
/** How long a replica trusts what it last read for riders. */
export const ANNOUNCEMENT_CACHE_MS = 30_000;

export interface AnnouncementInput {
  title: string;
  body: string;
  tone: AnnouncementTone;
  startsAt: number;
  endsAt: number;
}

export interface Announcement extends AnnouncementInput {
  id: string;
  createdBy: string;
  createdAt: number;
  note: string;
  endedBy: string | null;
  endedAt: number | null;
}

/** What riders get: nothing about who wrote it. */
export type PublicAnnouncement = Pick<Announcement, 'id' | 'title' | 'body' | 'tone' | 'endsAt'>;

type Row = {
  id: string; title: string; body: string; tone: AnnouncementTone; starts_at: string; ends_at: string;
  created_by: string; created_at: string; note: string; ended_by: string | null; ended_at: string | null;
};

const toAnnouncement = (row: Row): Announcement => ({
  id: row.id, title: row.title, body: row.body, tone: row.tone,
  startsAt: Number(row.starts_at), endsAt: Number(row.ends_at),
  createdBy: row.created_by, createdAt: Number(row.created_at), note: row.note,
  endedBy: row.ended_by, endedAt: row.ended_at === null ? null : Number(row.ended_at),
});

const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

/** The announcement, or why it can't be published. Times are milliseconds. */
export function parseAnnouncement(body: Record<string, unknown>, now = Date.now()): AnnouncementInput | { error: string } {
  const title = clean(body.title);
  const text = clean(body.body);
  if (!title || title.length > ANNOUNCEMENT_TITLE_MAX) return { error: `title must be 1-${ANNOUNCEMENT_TITLE_MAX} characters` };
  if (!text || text.length > ANNOUNCEMENT_BODY_MAX) return { error: `body must be 1-${ANNOUNCEMENT_BODY_MAX} characters` };
  const tone = body.tone ?? 'info';
  if (!(ANNOUNCEMENT_TONES as readonly unknown[]).includes(tone)) return { error: 'tone must be info or warning' };
  const startsAt = body.startsAt === undefined || body.startsAt === null ? now : body.startsAt;
  const endsAt = body.endsAt;
  if (typeof startsAt !== 'number' || !Number.isSafeInteger(startsAt)) return { error: 'startsAt must be a time in milliseconds' };
  if (typeof endsAt !== 'number' || !Number.isSafeInteger(endsAt)) return { error: 'endsAt must be a time in milliseconds' };
  if (endsAt <= Math.max(startsAt, now)) return { error: 'endsAt must be after the start and in the future' };
  if (endsAt - startsAt > ANNOUNCEMENT_MAX_DURATION_MS) return { error: 'an announcement can run for at most 30 days' };
  return { title, body: text, tone: tone as AnnouncementTone, startsAt, endsAt };
}

export class AnnouncementStore {
  private cache: { at: number; current: PublicAnnouncement | null } | null = null;

  /** The announcement riders should see now, if any. */
  async current(now = Date.now()): Promise<PublicAnnouncement | null> {
    if (!process.env.DATABASE_URL) return null;
    if (this.cache && now - this.cache.at < ANNOUNCEMENT_CACHE_MS) {
      // A cached one that has since ended is not shown.
      return this.cache.current && this.cache.current.endsAt > now ? this.cache.current : null;
    }
    await ensureMigrated();
    const { rows } = await getPool().query<Row>(
      `SELECT * FROM announcements WHERE ended_at IS NULL AND starts_at <= $1 AND ends_at > $1
       ORDER BY starts_at DESC, created_at DESC LIMIT 1`,
      [now],
    );
    const row = rows[0];
    const current = row ? { id: row.id, title: row.title, body: row.body, tone: row.tone, endsAt: Number(row.ends_at) } : null;
    this.cache = { at: now, current };
    return current;
  }

  /** The newest 50, for the Staff Hub. */
  async list(): Promise<Announcement[]> {
    await ensureMigrated();
    const { rows } = await getPool().query<Row>('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50');
    return rows.map(toAnnouncement);
  }

  async publish(input: AnnouncementInput, staffId: string, note: string, now = Date.now()): Promise<Announcement> {
    await ensureMigrated();
    const id = randomUUID();
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query<Row>(
        `INSERT INTO announcements (id, title, body, tone, starts_at, ends_at, created_by, created_at, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [id, input.title, input.body, input.tone, input.startsAt, input.endsAt, staffId, now, note],
      );
      await client.query(
        `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at, content_ref)
         VALUES ($1, $2, $2, NULL, 'announcement_publish', $3, $4, $5)`,
        [randomUUID(), staffId, note, now, input.title],
      );
      return rows[0]!;
    });
    this.cache = null;
    return toAnnouncement(row);
  }

  /** Takes an announcement down early. Unknown or already ended: null. */
  async end(id: string, staffId: string, note: string, now = Date.now()): Promise<Announcement | null> {
    await ensureMigrated();
    const row = await withTransaction(async (client) => {
      const { rows } = await client.query<Row>(
        `UPDATE announcements SET ended_by = $2, ended_at = $3
         WHERE id = $1 AND ended_at IS NULL AND ends_at > $3 RETURNING *`,
        [id, staffId, now],
      );
      if (!rows[0]) return null;
      await client.query(
        `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at, content_ref)
         VALUES ($1, $2, $2, NULL, 'announcement_end', $3, $4, $5)`,
        [randomUUID(), staffId, note, now, rows[0].title],
      );
      return rows[0];
    });
    this.cache = null;
    return row ? toAnnouncement(row) : null;
  }

  /** Tests only: forget what was read. */
  clearCache(): void { this.cache = null; }
}

export const announcementStore = new AnnouncementStore();
