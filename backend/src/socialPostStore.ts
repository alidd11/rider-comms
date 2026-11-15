import { randomUUID } from 'node:crypto';
import { ensureMigrated, getPool, withTransaction } from './db.ts';
import { assertSocialObjectKey, enqueueSocialMediaDelete } from './socialMediaDeletionOutbox.ts';
import type { Queryable } from './socialMediaDeletionOutbox.ts';

/**
 * Rider Social posts: a photo post (1–6 photos) or a Reel (one video).
 * Media rows are created when an upload has been processed and stored, and
 * are attached to a post when the rider publishes. Deleting a post, an
 * unused upload or an account queues its stored files for deletion in the
 * same transaction (socialMediaDeletionOutbox).
 */
export type SocialPostKind = 'photo' | 'reel';
export type SocialFeedScope = 'for-you' | 'following' | 'reels' | 'author';

export const MAX_POST_PHOTOS = 6;
export const MAX_POST_CAPTION = 2200;
/** Distinct reporters that hide a post until a moderator looks at it. */
export const REPORTS_TO_HIDE = 3;
/** An upload not used in a post within this long is deleted. */
export const UNATTACHED_MEDIA_TTL_MS = 6 * 60 * 60 * 1000;
export const FEED_PAGE_MAX = 30;

export interface NewSocialMedia {
  kind: 'image' | 'video';
  objectKey: string;
  posterKey: string | null;
  width: number;
  height: number;
  durationMs: number | null;
  bytes: number;
}

export interface SocialPostMedia {
  id: string;
  kind: 'image' | 'video';
  width: number;
  height: number;
  durationMs: number | null;
}

export interface SocialPost {
  id: string;
  authorId: string;
  kind: SocialPostKind;
  caption: string;
  createdAt: number;
  media: SocialPostMedia[];
  /** Only ever true on the author's own post. */
  hidden: boolean;
}

export interface SocialFeedPage {
  posts: SocialPost[];
  nextCursor: string | null;
  /** How many posts the rider has; only on the first page of one rider's posts. */
  total?: number;
}

export interface ServableMedia {
  objectKey: string;
  posterKey: string | null;
  kind: 'image' | 'video';
}

export type CreatePostResult =
  | { ok: true; post: SocialPost }
  | { ok: false; error: 'media_not_found' | 'invalid_media_for_post' };

export class InvalidSocialCursorError extends Error {
  constructor() { super('invalid_cursor'); this.name = 'InvalidSocialCursorError'; }
}

interface Cursor { createdAt: number; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isSocialId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function encodeSocialCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}:${cursor.id}`).toString('base64url');
}

export function decodeSocialCursor(value: string): Cursor {
  // Reject oversized or noncanonical encodings before decoding untrusted input.
  // Buffer.from(base64url) otherwise accepts malformed characters and padding.
  if (typeof value !== 'string' || value.length > 80 ||
      !/^[A-Za-z0-9_-]+$/.test(value)) throw new InvalidSocialCursorError();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new InvalidSocialCursorError();
  const text = decoded.toString('utf8');
  const match = /^(0|[1-9]\d{0,15}):([0-9a-f-]{36})$/.exec(text);
  if (!match || !UUID.test(match[2])) throw new InvalidSocialCursorError();
  const createdAt = Number(match[1]);
  if (!Number.isSafeInteger(createdAt)) throw new InvalidSocialCursorError();
  return { createdAt, id: match[2] };
}

type Row = Record<string, unknown>;

function toPost(row: Row, viewerId: string): SocialPost {
  const media = (row.media as Row[] | null ?? []).map((item) => ({
    id: String(item.id),
    kind: item.kind as 'image' | 'video',
    width: Number(item.width),
    height: Number(item.height),
    durationMs: item.duration_ms == null ? null : Number(item.duration_ms),
  }));
  const authorId = String(row.author_id);
  return {
    id: String(row.id),
    authorId,
    kind: row.kind as SocialPostKind,
    caption: String(row.caption),
    createdAt: Number(row.created_at),
    media,
    hidden: authorId === viewerId && row.hidden_at != null,
  };
}

// Posts a viewer may see: not hidden (unless their own), not from or to a
// rider either side has blocked, not one they reported, not from a
// suspended account. $1 is always the viewer.
const VISIBLE = `
  (p.hidden_at IS NULL OR p.author_id = $1)
  AND NOT EXISTS (SELECT 1 FROM rider_blocks b
    WHERE (b.rider_id = $1 AND b.blocked_rider_id = p.author_id)
       OR (b.rider_id = p.author_id AND b.blocked_rider_id = $1))
  AND NOT EXISTS (SELECT 1 FROM social_post_reports r WHERE r.post_id = p.id AND r.reporter_id = $1)
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = p.author_id AND u.suspended_at IS NOT NULL)`;

const SELECT_POST = `
  SELECT p.id, p.author_id, p.kind, p.caption, p.created_at, p.hidden_at,
    (SELECT json_agg(json_build_object('id', m.id, 'kind', m.kind, 'width', m.width,
        'height', m.height, 'duration_ms', m.duration_ms) ORDER BY pm.position)
       FROM social_post_media pm JOIN social_media m ON m.id = pm.media_id
      WHERE pm.post_id = p.id) AS media
  FROM social_posts p`;

async function enqueueMediaRows(client: Queryable, rows: Row[]): Promise<void> {
  for (const row of rows) {
    await enqueueSocialMediaDelete(client, String(row.object_key));
    if (row.poster_key) await enqueueSocialMediaDelete(client, String(row.poster_key));
  }
}

export class SocialPostStore {
  /**
   * Queues an upload's storage keys for deletion an hour from now, before
   * anything is written. addMedia releases them with the record, so a file
   * whose record never lands (a storage or database failure, a crash) is
   * still deleted.
   */
  async reserveMediaKeys(keys: readonly string[]): Promise<void> {
    await ensureMigrated();
    await withTransaction(async (client) => {
      for (const key of keys) {
        assertSocialObjectKey(key);
        await client.query(
          `INSERT INTO social_media_delete_outbox (object_key, next_attempt_at)
           VALUES ($1, now() + interval '1 hour') ON CONFLICT (object_key) DO NOTHING`,
          [key],
        );
      }
    });
  }

  /** Records an upload whose files are stored, and releases their reserved keys. */
  async addMedia(ownerId: string, media: NewSocialMedia, now = Date.now()): Promise<string> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO social_media (owner_id, kind, object_key, poster_key, width, height, duration_ms, bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [ownerId, media.kind, media.objectKey, media.posterKey, media.width, media.height, media.durationMs, media.bytes, now],
      );
      await client.query(
        'DELETE FROM social_media_delete_outbox WHERE object_key = ANY($1::text[]) AND completed_at IS NULL',
        [[media.objectKey, ...(media.posterKey ? [media.posterKey] : [])]],
      );
      return String(result.rows[0].id);
    });
  }

  async createPost(
    authorId: string,
    input: { kind: SocialPostKind; caption: string; mediaIds: string[] },
    now = Date.now(),
  ): Promise<CreatePostResult> {
    await ensureMigrated();
    const ids = [...new Set(input.mediaIds)];
    if (ids.length !== input.mediaIds.length || ids.length === 0) return { ok: false, error: 'invalid_media_for_post' };
    return withTransaction(async (client) => {
      const media = await client.query(
        `SELECT id, kind FROM social_media
          WHERE id = ANY($1::uuid[]) AND owner_id = $2 AND post_id IS NULL FOR UPDATE`,
        [ids, authorId],
      );
      if (media.rows.length !== ids.length) return { ok: false, error: 'media_not_found' } as const;
      const kinds = new Map(media.rows.map((row) => [String(row.id), String(row.kind)]));
      const fits = input.kind === 'reel'
        ? ids.length === 1 && kinds.get(ids[0]) === 'video'
        : ids.length <= MAX_POST_PHOTOS && ids.every((id) => kinds.get(id) === 'image');
      if (!fits) return { ok: false, error: 'invalid_media_for_post' } as const;
      const post = await client.query(
        'INSERT INTO social_posts (author_id, kind, caption, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
        [authorId, input.kind, input.caption, now],
      );
      const postId = String(post.rows[0].id);
      await client.query('UPDATE social_media SET post_id = $1 WHERE id = ANY($2::uuid[])', [postId, ids]);
      for (const [position, mediaId] of ids.entries()) {
        await client.query('INSERT INTO social_post_media (post_id, position, media_id) VALUES ($1, $2, $3)', [postId, position, mediaId]);
      }
      const created = await client.query(`${SELECT_POST} WHERE p.id = $1`, [postId]);
      return { ok: true, post: toPost(created.rows[0], authorId) } as const;
    });
  }

  async getPost(viewerId: string, postId: string): Promise<SocialPost | null> {
    await ensureMigrated();
    const result = await getPool().query(`${SELECT_POST} WHERE p.id = $2 AND ${VISIBLE}`, [viewerId, postId]);
    return result.rows[0] ? toPost(result.rows[0], viewerId) : null;
  }

  /**
   * Newest first. "following" is the viewer's Rider Comms friends plus the
   * viewer; "reels" is every Reel; "author" is one rider's posts.
   */
  async feed(
    viewerId: string,
    scope: SocialFeedScope,
    options: { authorId?: string; cursor?: string; limit?: number } = {},
  ): Promise<SocialFeedPage> {
    await ensureMigrated();
    const limit = Math.min(Math.max(options.limit ?? 20, 1), FEED_PAGE_MAX);
    const values: unknown[] = [viewerId];
    const where = [VISIBLE];
    if (scope === 'following') {
      where.push('(p.author_id = $1 OR EXISTS (SELECT 1 FROM friendships f WHERE f.rider_id = $1 AND f.friend_id = p.author_id))');
    } else if (scope === 'reels') {
      where.push(`p.kind = 'reel'`);
    } else if (scope === 'author') {
      values.push(options.authorId ?? '');
      where.push(`p.author_id = $${values.length}`);
    }
    if (options.cursor) {
      const cursor = decodeSocialCursor(options.cursor);
      values.push(cursor.createdAt, cursor.id);
      where.push(`(p.created_at, p.id) < ($${values.length - 1}, $${values.length}::uuid)`);
    }
    values.push(limit + 1);
    const result = await getPool().query(
      `${SELECT_POST} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC, p.id DESC LIMIT $${values.length}`,
      values,
    );
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    const page: SocialFeedPage = {
      posts: rows.map((row) => toPost(row, viewerId)),
      nextCursor: result.rows.length > limit && last
        ? encodeSocialCursor({ createdAt: Number(last.created_at), id: String(last.id) })
        : null,
    };
    if (scope === 'author' && !options.cursor) {
      page.total = page.nextCursor === null ? rows.length : Number((await getPool().query(
        `SELECT count(*)::int AS n FROM social_posts p WHERE ${where.join(' AND ')}`,
        values.slice(0, -1),
      )).rows[0].n);
    }
    return page;
  }

  /** The author deletes a post: its files are queued for deletion. */
  async deletePost(authorId: string, postId: string): Promise<boolean> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const post = await client.query('SELECT id FROM social_posts WHERE id = $1 AND author_id = $2 FOR UPDATE', [postId, authorId]);
      if (!post.rows[0]) return false;
      const media = await client.query('DELETE FROM social_media WHERE post_id = $1 RETURNING object_key, poster_key', [postId]);
      await enqueueMediaRows(client, media.rows);
      await client.query('DELETE FROM social_posts WHERE id = $1', [postId]);
      return true;
    });
  }

  /**
   * One report per rider per post. The reporter stops seeing it at once,
   * and enough distinct reports hide it for everyone but its author until a
   * moderator looks. Returns null when the post isn't visible to the reporter.
   */
  async report(reporterId: string, postId: string, reason: string, now = Date.now()): Promise<{ authorId: string; hidden: boolean } | null> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const post = await client.query(
        `SELECT p.author_id FROM social_posts p WHERE p.id = $2 AND p.author_id <> $1 AND ${VISIBLE} FOR UPDATE OF p`,
        [reporterId, postId],
      );
      if (!post.rows[0]) return null;
      await client.query(
        `INSERT INTO social_post_reports (post_id, reporter_id, reason, created_at)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [postId, reporterId, reason, now],
      );
      const count = await client.query('SELECT count(*)::int AS n FROM social_post_reports WHERE post_id = $1', [postId]);
      const hidden = Number(count.rows[0].n) >= REPORTS_TO_HIDE;
      if (hidden) await client.query('UPDATE social_posts SET hidden_at = COALESCE(hidden_at, $2) WHERE id = $1', [postId, now]);
      return { authorId: String(post.rows[0].author_id), hidden };
    });
  }

  /**
   * A moderator's decision on a hidden post: show it again, or remove it
   * (its files are queued for deletion). Recorded in the moderation audit
   * log against the post's author, with the moderator's note.
   */
  async moderate(postId: string, action: 'restore' | 'remove', moderatorId: string, note: string, now = Date.now()): Promise<boolean> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const post = await client.query('SELECT author_id FROM social_posts WHERE id = $1 FOR UPDATE', [postId]);
      if (!post.rows[0]) return false;
      if (action === 'restore') {
        await client.query('UPDATE social_posts SET hidden_at = NULL WHERE id = $1', [postId]);
        await client.query('DELETE FROM social_post_reports WHERE post_id = $1', [postId]);
      } else {
        const media = await client.query('DELETE FROM social_media WHERE post_id = $1 RETURNING object_key, poster_key', [postId]);
        await enqueueMediaRows(client, media.rows);
        await client.query('DELETE FROM social_posts WHERE id = $1', [postId]);
      }
      await client.query(
        `INSERT INTO moderation_actions (id, moderator_id, target_rider_id, report_id, action, note, created_at)
         VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
        [randomUUID(), moderatorId, String(post.rows[0].author_id), `social_post_${action}`, `Rider Social post ${postId}: ${note}`, now],
      );
      return true;
    });
  }

  /** Hidden posts waiting for a moderator, most reported first. */
  async listHidden(limit = 50): Promise<Array<{ post: SocialPost; reports: number; reasons: string[] }>> {
    await ensureMigrated();
    const result = await getPool().query(
      `SELECT q.*, (SELECT count(*)::int FROM social_post_reports r WHERE r.post_id = q.id) AS reports,
          (SELECT array_agg(DISTINCT r.reason) FROM social_post_reports r WHERE r.post_id = q.id) AS reasons
         FROM (${SELECT_POST} WHERE p.hidden_at IS NOT NULL) q
        ORDER BY reports DESC, q.hidden_at ASC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map((row) => ({
      post: toPost(row, ''),
      reports: Number(row.reports),
      reasons: (row.reasons as string[] | null) ?? [],
    }));
  }

  /**
   * A stored file the viewer may see right now: its post exists, is visible
   * to them, and the file belongs to it. Checked on every media request.
   */
  async servableMedia(viewerId: string, mediaId: string): Promise<ServableMedia | null> {
    await ensureMigrated();
    const result = await getPool().query(
      `SELECT m.object_key, m.poster_key, m.kind FROM social_media m
         JOIN social_posts p ON p.id = m.post_id
        WHERE m.id = $2 AND ${VISIBLE}`,
      [viewerId, mediaId],
    );
    const row = result.rows[0];
    return row ? { objectKey: String(row.object_key), posterKey: row.poster_key ? String(row.poster_key) : null, kind: row.kind as 'image' | 'video' } : null;
  }

  /** A moderator reviewing a hidden post can still open its files. */
  async mediaForStaff(mediaId: string): Promise<ServableMedia | null> {
    await ensureMigrated();
    const result = await getPool().query(
      'SELECT m.object_key, m.poster_key, m.kind FROM social_media m WHERE m.id = $1 AND m.post_id IS NOT NULL',
      [mediaId],
    );
    const row = result.rows[0];
    return row ? { objectKey: String(row.object_key), posterKey: row.poster_key ? String(row.poster_key) : null, kind: row.kind as 'image' | 'video' } : null;
  }

  /** Uploads never used in a post: queue their files and forget them. */
  async sweepUnattachedMedia(now = Date.now()): Promise<number> {
    await ensureMigrated();
    return withTransaction(async (client) => {
      const media = await client.query(
        `DELETE FROM social_media WHERE id IN (
           SELECT id FROM social_media WHERE post_id IS NULL AND created_at < $1
            ORDER BY created_at LIMIT 200 FOR UPDATE SKIP LOCKED)
         RETURNING object_key, poster_key`,
        [now - UNATTACHED_MEDIA_TTL_MS],
      );
      await enqueueMediaRows(client, media.rows);
      return media.rows.length;
    });
  }
}

/**
 * Account deletion: every post, upload and report by the rider, inside the
 * account deletion transaction, with the files queued for deletion.
 */
export async function deleteRiderSocialContent(client: Queryable, riderId: string): Promise<void> {
  const media = await client.query('DELETE FROM social_media WHERE owner_id = $1 RETURNING object_key, poster_key', [riderId]);
  await enqueueMediaRows(client, media.rows);
  await client.query('DELETE FROM social_posts WHERE author_id = $1', [riderId]);
  await client.query('DELETE FROM social_post_reports WHERE reporter_id = $1', [riderId]);
}
