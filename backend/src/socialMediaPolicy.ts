/**
 * First-stage checks for Rider Social media intake. These deliberately do not
 * authorize uploads. A signed, author-scoped upload transaction and a trusted
 * processor that strips GPS/EXIF, probes and transcodes media must exist before
 * any object is stored or served.
 */
export const SOCIAL_MEDIA_TYPES = Object.freeze({
  'image/jpeg': { kind: 'image', extension: 'jpg', maxBytes: 12 * 1024 * 1024 },
  'image/png': { kind: 'image', extension: 'png', maxBytes: 12 * 1024 * 1024 },
  'image/webp': { kind: 'image', extension: 'webp', maxBytes: 12 * 1024 * 1024 },
  'video/mp4': { kind: 'video', extension: 'mp4', maxBytes: 80 * 1024 * 1024 },
} as const);

export type SocialMediaMime = keyof typeof SOCIAL_MEDIA_TYPES;
export type SocialMediaIntent =
  | { ok: true; mime: SocialMediaMime; kind: 'image' | 'video'; extension: 'jpg' | 'png' | 'webp' | 'mp4'; maxBytes: number; bytes: number }
  | { ok: false; error: 'invalid_media_type' | 'invalid_media_size' };

export function validateSocialMediaIntent(mime: unknown, byteLength: unknown): SocialMediaIntent {
  if (typeof mime !== 'string' ||
      !Object.prototype.hasOwnProperty.call(SOCIAL_MEDIA_TYPES, mime)) {
    return { ok: false, error: 'invalid_media_type' };
  }
  const format = SOCIAL_MEDIA_TYPES[mime as SocialMediaMime];
  if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) ||
      byteLength < 1 || byteLength > format.maxBytes) {
    return { ok: false, error: 'invalid_media_size' };
  }
  return {
    ok: true, mime: mime as SocialMediaMime, kind: format.kind,
    extension: format.extension, maxBytes: format.maxBytes, bytes: byteLength,
  };
}

/**
 * Shallow format signature check on the first bytes received from a bounded
 * streaming upload. MIME headers and filename extensions alone are untrusted.
 * A passing signature is NOT proof that bytes decode safely: the private
 * processor must validate the complete file and re-encode before publication.
 */
export function matchesSocialMediaSignature(mime: SocialMediaMime, header: Uint8Array): boolean {
  if (mime === 'image/jpeg') {
    return header.length >= 3 && header[0] === 0xff &&
      header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mime === 'image/png') {
    return header.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => header[i] === n);
  }
  if (mime === 'image/webp') {
    return header.length >= 12 &&
      String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  }
  if (mime === 'video/mp4') {
    // ftyp is the initial ISO Base Media File Format box. Only process these
    // as MP4 after a trusted ffprobe/decoder checks all following boxes.
    return header.length >= 12 &&
      String.fromCharCode(...header.slice(4, 8)) === 'ftyp' &&
      ['isom', 'iso2', 'mp41', 'mp42', 'avc1'].includes(
        String.fromCharCode(...header.slice(8, 12)),
      );
  }
  return false;
}
