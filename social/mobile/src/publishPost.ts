import type { RiderAccountClient, SocialPost } from './authClient';
import type { ComposerDraft, ComposerMedia } from './upload';

/** A file ready to send: its bytes and the type the server checks them against. */
export interface Uploadable { body: Blob; type: string }

export type PrepareMedia = (item: ComposerMedia) => Promise<Uploadable>;

export class PublishError extends Error {
  constructor(message: string) { super(message); this.name = 'PublishError'; }
}

const VIDEO_TYPES: Record<string, string> = { mov: 'video/quicktime', qt: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm' };

/** The type to declare for a video: what the picker said, the file's own, or its extension. */
export function videoTypeFor(item: Pick<ComposerMedia, 'mimeType' | 'fileName' | 'uri'>, blobType = ''): string {
  for (const candidate of [item.mimeType, blobType]) {
    const type = candidate?.toLowerCase().split(';')[0].trim();
    if (type && Object.values(VIDEO_TYPES).includes(type)) return type;
    if (type === 'video/x-m4v') return 'video/mp4';
  }
  const extension = /\.([a-z0-9]+)(?:$|[?#])/i.exec(item.fileName || item.uri)?.[1]?.toLowerCase() ?? '';
  return VIDEO_TYPES[extension] ?? 'video/mp4';
}

/** Which of a draft's formats can be posted, and why not otherwise. */
export function publishableKind(draft: Pick<ComposerDraft, 'mode' | 'media'>): { kind: 'photo' | 'reel' } | { error: string } {
  if (draft.mode === 'Story') return { error: 'Stories aren’t live yet. Post it as a photo post or a Reel.' };
  if (draft.mode === 'Reel') {
    return draft.media.length === 1 && draft.media[0]?.kind === 'video'
      ? { kind: 'reel' } : { error: 'A Reel is one video.' };
  }
  if (draft.media.some((item) => item.kind === 'video')) return { error: 'Posts are photos. Share a video as a Reel.' };
  return draft.media.length >= 1 && draft.media.length <= 6 ? { kind: 'photo' } : { error: 'A post is 1 to 6 photos.' };
}

export function postCaption(draft: Pick<ComposerDraft, 'title' | 'caption'>): string {
  return [draft.title?.trim(), draft.caption.trim()].filter(Boolean).join('\n\n');
}

/**
 * Uploads each photo or the video in turn (the server re-encodes them and
 * removes location data), then creates the post. Progress is reported in
 * words for the composer's status line.
 */
export async function publishDraft(
  client: Pick<RiderAccountClient, 'uploadSocialMedia' | 'createSocialPost'>,
  draft: ComposerDraft,
  prepare: PrepareMedia,
  onProgress: (message: string) => void = () => {},
): Promise<SocialPost> {
  const target = publishableKind(draft);
  if ('error' in target) throw new PublishError(target.error);
  const ids: string[] = [];
  for (const [index, item] of draft.media.entries()) {
    onProgress(item.kind === 'video'
      ? 'Uploading your video. Longer videos take a minute to process…'
      : draft.media.length > 1 ? `Uploading photo ${index + 1} of ${draft.media.length}…` : 'Uploading your photo…');
    const file = await prepare(item);
    const uploaded = await client.uploadSocialMedia(file.body, file.type);
    ids.push(uploaded.id);
  }
  onProgress('Posting…');
  return client.createSocialPost(target.kind, postCaption(draft), ids);
}
