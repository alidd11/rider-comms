import { Readable } from 'node:stream';
import { roleCan } from '../staffRoles.ts';
import { containsSevereText } from '../contentFilter.ts';
import { MAX_MODERATION_NOTE_LENGTH, REPORT_REASONS } from '../moderationStore.ts';
import type { ReportReason } from '../moderationStore.ts';
import { bearerToken, consumeSocialWrite, readJsonBody, sendEmpty, sendJson } from '../serverHttp.ts';
import { matchesSocialMediaSignature, validateSocialMediaIntent } from '../socialMediaPolicy.ts';
import type { SocialMediaMime } from '../socialMediaPolicy.ts';
import { SocialMediaProcessingError, stageUpload, UploadTooLargeError } from '../socialMediaProcessor.ts';
import type { VideoContainer } from '../socialMediaProcessor.ts';
import { parseByteRange, signedMediaPath, verifyMediaSignature } from '../socialMediaService.ts';
import type { MediaLinkViewer, MediaVariant, SocialMediaService } from '../socialMediaService.ts';
import { createProcessedObjectKey } from '../socialPrivateObjectTransport.ts';
import { InvalidSocialCursorError, isSocialId, MAX_POST_CAPTION } from '../socialPostStore.ts';
import type { SocialFeedPage, SocialPost, SocialPostStore } from '../socialPostStore.ts';
import { NOT_HANDLED } from './context.ts';
import type { PublicRouteContext, RouteContext } from './context.ts';

/** A post as the app gets it: each file with a short-lived link for this session. */
function withLinks(service: SocialMediaService, viewer: MediaLinkViewer, post: SocialPost) {
  return {
    ...post,
    media: post.media.map((item) => ({
      ...item,
      url: signedMediaPath(service.urlSecret, viewer, item.id, 'file'),
      posterUrl: item.kind === 'video' ? signedMediaPath(service.urlSecret, viewer, item.id, 'poster') : null,
    })),
  };
}

function pageWithLinks(service: SocialMediaService, viewer: MediaLinkViewer, page: SocialFeedPage) {
  return {
    posts: page.posts.map((post) => withLinks(service, viewer, post)),
    nextCursor: page.nextCursor,
    ...(page.total === undefined ? {} : { total: page.total }),
  };
}

const VIDEO_CONTAINERS: Partial<Record<SocialMediaMime, VideoContainer>> = {
  'video/mp4': 'mov', 'video/quicktime': 'mov', 'video/webm': 'matroska',
};

/**
 * GET /social/media/:mediaId/(file|poster) — before sign-in, because an
 * <img> or <video> can't send the Authorization header. The signature binds
 * the link to one viewer and one file for at most 30 minutes, and the post's
 * visibility to that viewer is checked again on every request.
 */
export async function handleSocialMediaRoute(
  ctx: PublicRouteContext & { socialPostStore: SocialPostStore; socialMedia: SocialMediaService | null },
): Promise<unknown> {
  const { req, res, url, socialPostStore, socialMedia } = ctx;
  const s = url.pathname.split('/').filter(Boolean);
  if (s[0] !== 'social' || s[1] !== 'media' || s.length !== 4 || (req.method !== 'GET' && req.method !== 'HEAD')) return NOT_HANDLED;
  const [, , mediaId, variant] = s;
  if (!socialMedia || !isSocialId(mediaId) || (variant !== 'file' && variant !== 'poster')) {
    return sendJson(res, 404, { error: 'not_found' });
  }
  const viewer = { riderId: url.searchParams.get('v') ?? '', sessionId: url.searchParams.get('s') ?? '' };
  const expiresAt = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') ?? '';
  // The link names a rider and the session it was issued to; it works only
  // while that session is still signed in, and only for what the rider may
  // see right now (staff included: admin rights are checked each time).
  if (!viewer.riderId || !verifyMediaSignature(socialMedia.urlSecret, viewer, mediaId, variant as MediaVariant, expiresAt, sig) ||
    !(await ctx.authStore.isSessionActive(viewer.riderId, viewer.sessionId))) {
    return sendJson(res, 403, { error: 'invalid_media_link' });
  }
  const media = await socialPostStore.servableMedia(viewer.riderId, mediaId) ??
    (await ctx.authStore.can(viewer.riderId, 'moderate') ? await socialPostStore.mediaForStaff(mediaId) : null);
  const key = variant === 'poster' ? media?.posterKey : media?.objectKey;
  if (!media || !key) return sendJson(res, 404, { error: 'not_found' });
  const range = parseByteRange(typeof req.headers.range === 'string' ? req.headers.range : undefined);
  if (req.headers.range !== undefined && !range) {
    return sendJson(res, 416, { error: 'invalid_media_range' });
  }
  let stored: Response;
  try {
    stored = await socialMedia.storage.getProcessed(key, range ?? undefined);
  } catch (error) {
    if (error instanceof Error && error.message === 'social_media_not_found') return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 502, { error: 'media_unavailable' });
  }
  const isVideo = media.kind === 'video' && variant === 'file';
  const headers: Record<string, string> = {
    'Content-Type': isVideo ? 'video/mp4' : 'image/jpeg',
    // Access can be revoked at any time by a block, moderation action or deletion.
    // Never let a browser reuse bytes without re-checking server-side visibility.
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  };
  for (const name of ['content-length', 'content-range']) {
    const value = stored.headers.get(name);
    if (value) headers[name === 'content-length' ? 'Content-Length' : 'Content-Range'] = value;
  }
  res.writeHead(stored.status, headers);
  if (req.method === 'HEAD' || !stored.body) {
    await stored.body?.cancel().catch(() => undefined);
    res.end();
    return;
  }
  const body = Readable.fromWeb(stored.body as import('node:stream/web').ReadableStream);
  res.once('close', () => body.destroy());
  body.on('error', () => res.destroy());
  body.pipe(res);
}

type SocialPostContext = RouteContext & { socialPostStore: SocialPostStore; socialMedia: SocialMediaService | null };

/** Rider Social posting, feeds and reports. Only reached by an entitled rider. */
export async function handleSocialPostRoutes(ctx: SocialPostContext): Promise<unknown> {
  const { req, res, url, s, actorId, socialPostStore, socialMedia, socialRateLimitStore, moderationStore } = ctx;
  if (s[0] !== 'social') return NOT_HANDLED;
  const route = s.slice(1);
  const viewer = async (): Promise<MediaLinkViewer> =>
    ({ riderId: actorId, sessionId: (await ctx.authStore.sessionIdForToken(bearerToken(req))) ?? '' });

  if (!socialMedia) {
    const known = ['media', 'posts', 'feed', 'riders'].includes(route[0] ?? '');
    return known ? sendJson(res, 503, { error: 'social_media_not_configured' }) : NOT_HANDLED;
  }

  // Posting has its own switch, off unless SOCIAL_POSTING_ENABLED=true.
  if (req.method === 'POST' && route.length === 1 && (route[0] === 'media' || route[0] === 'posts') && !ctx.socialPostingEnabled) {
    return sendJson(res, 503, { error: 'social_posting_disabled' });
  }

  if (req.method === 'POST' && route.length === 1 && route[0] === 'media') {
    const declared = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const length = Number(req.headers['content-length']);
    const intent = validateSocialMediaIntent(declared, length);
    if (!intent.ok) return sendJson(res, intent.error === 'invalid_media_type' ? 415 : 413, { error: intent.error });
    if (!(await consumeSocialWrite(res, socialRateLimitStore, actorId, 'social_upload'))) return;
    let staged;
    try {
      staged = await stageUpload(req, intent.maxBytes);
    } catch (error) {
      if (error instanceof UploadTooLargeError) return sendJson(res, 413, { error: 'invalid_media_size' });
      throw error;
    }
    try {
      if (staged.bytes !== length || !matchesSocialMediaSignature(intent.mime, staged.header)) {
        return sendJson(res, 415, { error: 'invalid_media_type' });
      }
      const fileKey = createProcessedObjectKey(intent.kind === 'video' ? 'mp4' : 'jpg');
      if (intent.kind === 'image') {
        const { readFile } = await import('node:fs/promises');
        const image = await socialMedia.processImage(await readFile(staged.path));
        await socialPostStore.reserveMediaKeys([fileKey]);
        await socialMedia.storage.putProcessed(fileKey, image.bytes, 'image/jpeg');
        const id = await socialPostStore.addMedia(actorId, {
          kind: 'image', objectKey: fileKey, posterKey: null, width: image.width, height: image.height, durationMs: null, bytes: image.bytes.length,
        });
        return sendJson(res, 201, { media: { id, kind: 'image', width: image.width, height: image.height, durationMs: null } });
      }
      const video = await socialMedia.processVideo(staged.path, VIDEO_CONTAINERS[intent.mime] ?? 'mov');
      const posterKey = createProcessedObjectKey('jpg');
      await socialPostStore.reserveMediaKeys([fileKey, posterKey]);
      await socialMedia.storage.putProcessed(fileKey, video.bytes, 'video/mp4');
      await socialMedia.storage.putProcessed(posterKey, video.poster, 'image/jpeg');
      const id = await socialPostStore.addMedia(actorId, {
        kind: 'video', objectKey: fileKey, posterKey, width: video.width, height: video.height, durationMs: video.durationMs, bytes: video.bytes.length,
      });
      return sendJson(res, 201, { media: { id, kind: 'video', width: video.width, height: video.height, durationMs: video.durationMs } });
    } catch (error) {
      if (error instanceof SocialMediaProcessingError) {
        const status = error.code === 'media_busy' ? 503 : error.code === 'media_processing_failed' ? 500 : 422;
        return sendJson(res, status, { error: error.code });
      }
      if (error instanceof Error && error.message === 'social_media_storage_unavailable') {
        return sendJson(res, 502, { error: 'media_storage_unavailable' });
      }
      throw error;
    } finally {
      await staged.cleanup();
    }
  }

  if (req.method === 'POST' && route.length === 1 && route[0] === 'posts') {
    const body = await readJsonBody(req);
    const kind = body.kind;
    const caption = typeof body.caption === 'string' ? body.caption.trim() : '';
    const mediaIds = body.mediaIds;
    if (kind !== 'photo' && kind !== 'reel') return sendJson(res, 400, { error: 'invalid_post_kind' });
    if (caption.length > MAX_POST_CAPTION) return sendJson(res, 400, { error: 'caption_too_long' });
    if (!Array.isArray(mediaIds) || mediaIds.length === 0 || mediaIds.length > 6 || !mediaIds.every(isSocialId)) {
      return sendJson(res, 400, { error: 'invalid_media_for_post' });
    }
    if (containsSevereText(caption)) return sendJson(res, 400, { error: 'objectionable_content' });
    if (!(await consumeSocialWrite(res, socialRateLimitStore, actorId, 'social_post'))) return;
    const result = await socialPostStore.createPost(actorId, { kind, caption, mediaIds });
    if (!result.ok) return sendJson(res, result.error === 'media_not_found' ? 404 : 400, { error: result.error });
    return sendJson(res, 201, { post: withLinks(socialMedia, await viewer(), result.post) });
  }

  if (req.method === 'GET' && (
    (route.length === 1 && route[0] === 'feed') ||
    (route.length === 3 && route[0] === 'riders' && route[2] === 'posts')
  )) {
    const scopeParam = url.searchParams.get('scope') ?? 'for-you';
    const scope = route[0] === 'riders' ? 'author' : scopeParam;
    if (!['for-you', 'following', 'reels', 'author'].includes(scope) || (route[0] === 'feed' && scope === 'author')) {
      return sendJson(res, 400, { error: 'invalid_scope' });
    }
    const limit = Number(url.searchParams.get('limit') ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) return sendJson(res, 400, { error: 'limit must be an integer from 1 to 30' });
    try {
      const page = await socialPostStore.feed(actorId, scope as 'for-you', {
        authorId: route[0] === 'riders' ? decodeURIComponent(route[1]) : undefined,
        cursor: url.searchParams.get('cursor') ?? undefined,
        limit,
      });
      return sendJson(res, 200, pageWithLinks(socialMedia, await viewer(), page));
    } catch (error) {
      if (error instanceof InvalidSocialCursorError) return sendJson(res, 400, { error: 'invalid_cursor' });
      throw error;
    }
  }

  if (route[0] === 'posts' && route.length >= 2) {
    const postId = route[1];
    if (!isSocialId(postId)) return sendJson(res, 404, { error: 'not_found' });
    if (req.method === 'GET' && route.length === 2) {
      const post = await socialPostStore.getPost(actorId, postId);
      return post ? sendJson(res, 200, { post: withLinks(socialMedia, await viewer(), post) }) : sendJson(res, 404, { error: 'not_found' });
    }
    if (req.method === 'DELETE' && route.length === 2) {
      return (await socialPostStore.deletePost(actorId, postId)) ? sendEmpty(res, 204) : sendJson(res, 404, { error: 'not_found' });
    }
    if (req.method === 'POST' && route.length === 3 && route[2] === 'report') {
      const body = await readJsonBody(req);
      const reason = body.reason;
      const details = typeof body.details === 'string' ? body.details.trim().slice(0, 500) : '';
      if (typeof reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(reason)) {
        return sendJson(res, 400, { error: 'invalid_reason' });
      }
      if (!(await consumeSocialWrite(res, socialRateLimitStore, actorId, 'safety_report'))) return;
      const reported = await socialPostStore.report(actorId, postId, reason);
      if (!reported) return sendJson(res, 404, { error: 'not_found' });
      // The rider-level queue moderators already work from.
      await moderationStore.report(actorId, reported.authorId, reason as ReportReason,
        `Rider Social post ${postId}${details ? `: ${details}` : ''}`);
      return sendJson(res, 202, { reported: true });
    }
  }
  return NOT_HANDLED;
}

/** Staff: hidden posts waiting for a decision, and the decision. */
export async function handleSocialModerationRoutes(ctx: SocialPostContext): Promise<unknown> {
  const { req, res, url, s, actorId, authStore, socialPostStore } = ctx;
  if (s[0] !== 'moderation' || s[1] !== 'social-posts') return NOT_HANDLED;
  const role = await authStore.staffRole(actorId);
  if (!role) return sendJson(res, 403, { error: 'admin_required' });
  if (!roleCan(role, 'moderate')) return sendJson(res, 403, { error: 'permission_required', permission: 'moderate' });
  if (req.method === 'GET' && s.length === 2) {
    const limit = Number(url.searchParams.get('limit') ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return sendJson(res, 400, { error: 'limit must be an integer from 1 to 100' });
    const hidden = await socialPostStore.listHidden(limit);
    const viewer = { riderId: actorId, sessionId: (await authStore.sessionIdForToken(bearerToken(req))) ?? '' };
    return sendJson(res, 200, {
      posts: hidden.map((entry) => ({
        ...entry,
        post: ctx.socialMedia ? withLinks(ctx.socialMedia, viewer, entry.post) : entry.post,
      })),
    });
  }
  if (req.method === 'POST' && s.length === 4 && isSocialId(s[2]) && (s[3] === 'restore' || s[3] === 'remove')) {
    // Like every other moderation decision, it needs a note for the audit log.
    const body = await readJsonBody(req);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note || note.length > MAX_MODERATION_NOTE_LENGTH) {
      return sendJson(res, 400, { error: `note must be 1 to ${MAX_MODERATION_NOTE_LENGTH} characters` });
    }
    return (await socialPostStore.moderate(s[2], s[3], actorId, note)) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'not_found' });
  }
  return sendJson(res, 404, { error: 'not_found' });
}
