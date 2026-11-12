/**
 * Offline composer validation. It never grants publishing permission.
 * Server-side upload authorization, type sniffing, malware checks, transcoding,
 * consent, age policy and moderation remain required before real publication.
 */
export type ComposerMode = 'Post' | 'Story' | 'Reel';
export type Audience = 'private' | 'followers' | 'public';
export type MediaKind = 'image' | 'video';
export type ComposerMedia = {
  id: string;
  uri: string;
  kind: MediaKind;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
};

export type ComposerDraft = {
  mode: ComposerMode;
  caption: string;
  title?: string;
  audience: Audience;
  category: 'cars' | 'motorcycles' | 'cycling';
  media: ComposerMedia[];
};

export const MAX_PHOTOS = 6;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_CAPTION = 2200;
export const MAX_TITLE = 100;

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function limitsFor(mode: ComposerMode) {
  return {
    maxCount: mode === 'Post' ? MAX_PHOTOS : 1,
    requireVideo: mode === 'Reel',
    allowsImages: mode !== 'Reel',
    allowsVideo: true,
  };
}

export function validateMedia(mode: ComposerMode, items: readonly ComposerMedia[]): Validated<ComposerMedia[]> {
  const limits = limitsFor(mode);
  if (!items.length) return { ok: false, error: 'Choose a photo or video to continue.' };
  if (items.length > limits.maxCount) return { ok: false, error: 'Too many files for this format.' };
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id) || !item.uri) return { ok: false, error: 'Media selection is invalid.' };
    ids.add(item.id);
    if (item.kind !== 'image' && item.kind !== 'video') return { ok: false, error: 'Unsupported media format.' };
    if (mode === 'Reel' && item.kind !== 'video') return { ok: false, error: 'Reels require a video.' };
    if (typeof item.fileSize === 'number') {
      if (!Number.isFinite(item.fileSize) || item.fileSize < 0) return { ok: false, error: 'Invalid file size.' };
      if (item.fileSize > (item.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES))
        return { ok: false, error: 'A selected file is too large for this preview.' };
    }
    if (item.mimeType && !/^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm|x-m4v))$/i.test(item.mimeType))
      return { ok: false, error: 'Unsupported file type.' };
  }
  return { ok: true, value: [...items] };
}

export function validateDraft(draft: ComposerDraft): Validated<ComposerDraft> {
  const validated = validateMedia(draft.mode, draft.media);
  if (!validated.ok) return validated;
  if (draft.caption.length > MAX_CAPTION) return { ok: false, error: 'Caption is too long.' };
  if (typeof draft.title === 'string' && draft.title.length > MAX_TITLE)
    return { ok: false, error: 'Title is too long.' };
  if (!['private', 'followers', 'public'].includes(draft.audience))
    return { ok: false, error: 'Choose who can see this post.' };
  if (!['cars', 'motorcycles', 'cycling'].includes(draft.category))
    return { ok: false, error: 'Choose a community category.' };
  return { ok: true, value: { ...draft, caption: draft.caption.trim(),
    title: draft.title?.trim(), media: validated.value } };
}

export function moveMedia(items: readonly ComposerMedia[], id: string, direction: -1 | 1): ComposerMedia[] {
  const arr = [...items];
  const from = arr.findIndex((item) => item.id === id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= arr.length) return arr;
  [arr[from], arr[to]] = [arr[to], arr[from]];
  return arr;
}

export type TextDraft = Pick<ComposerDraft, 'mode' | 'title' | 'caption' | 'audience' | 'category'>;
export function parseTextDraft(value: unknown): TextDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Partial<TextDraft>;
  if (!['Post', 'Story', 'Reel'].includes(draft.mode ?? '')
    || (draft.title !== undefined && (typeof draft.title !== 'string' || draft.title.length > MAX_TITLE))
    || typeof draft.caption !== 'string' || draft.caption.length > MAX_CAPTION
    || !['private', 'followers', 'public'].includes(draft.audience ?? '')
    || !['cars', 'motorcycles', 'cycling'].includes(draft.category ?? '')) return null;
  return { mode: draft.mode as ComposerMode, title: draft.title ?? '',
    caption: draft.caption, audience: draft.audience as Audience,
    category: draft.category as TextDraft['category'] };
}
