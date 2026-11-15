import { createHmac, timingSafeEqual } from 'node:crypto';
import { processSocialImage, processSocialVideo } from './socialMediaProcessor.ts';
import type { ProcessedImage, ProcessedVideo, VideoContainer } from './socialMediaProcessor.ts';
import { readSocialS3Config, SocialPrivateObjectTransport } from './socialPrivateObjectTransport.ts';

/**
 * Rider Social media plumbing: the private store, the processors and
 * short-lived signed links. With no storage configured, Social stays
 * read-only (the bootstrap reports uploads and posting as off).
 */
export interface SocialMediaStorage {
  putProcessed(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  getProcessed(key: string, range?: string): Promise<Response>;
  deleteProcessed(key: string): Promise<void>;
}

export interface SocialMediaService {
  storage: SocialMediaStorage;
  urlSecret: Buffer;
  processImage(bytes: Buffer): Promise<ProcessedImage>;
  processVideo(path: string, container: VideoContainer): Promise<ProcessedVideo>;
}

export type MediaVariant = 'file' | 'poster';

const HOUR_MS = 60 * 60 * 1000;

export function socialMediaServiceFromEnv(env: Record<string, string | undefined> = process.env): SocialMediaService | null {
  const config = readSocialS3Config(env);
  if (!config) return null;
  const override = env.SOCIAL_MEDIA_URL_SECRET?.trim();
  return {
    storage: new SocialPrivateObjectTransport(config),
    // A separate key from the storage secret, derived from it unless given.
    urlSecret: override && override.length >= 32
      ? Buffer.from(override)
      : createHmac('sha256', config.secretAccessKey).update('rider-social-media-url-v1').digest(),
    processImage: processSocialImage,
    processVideo: (path, container) => processSocialVideo(path, container),
  };
}

function signature(secret: Buffer, viewerId: string, mediaId: string, variant: MediaVariant, expiresAt: number): string {
  return createHmac('sha256', secret).update(`${viewerId}\n${mediaId}\n${variant}\n${expiresAt}`).digest('base64url');
}

/**
 * A link for one viewer to one stored file, valid for one to two hours. The
 * expiry is rounded to the hour so a refreshed feed reuses the same URL and
 * the phone's cache still works. The media route re-checks that the viewer
 * may still see the post on every request.
 */
export function signedMediaPath(secret: Buffer, viewerId: string, mediaId: string, variant: MediaVariant, now = Date.now()): string {
  const expiresAt = Math.floor(now / HOUR_MS) * HOUR_MS + 2 * HOUR_MS;
  const sig = signature(secret, viewerId, mediaId, variant, expiresAt);
  return `/social/media/${mediaId}/${variant}?v=${encodeURIComponent(viewerId)}&exp=${expiresAt}&sig=${sig}`;
}

export function verifyMediaSignature(
  secret: Buffer, viewerId: string, mediaId: string, variant: MediaVariant,
  expiresAt: number, sig: string, now = Date.now(),
): boolean {
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + 3 * HOUR_MS) return false;
  const expected = Buffer.from(signature(secret, viewerId, mediaId, variant, expiresAt));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A single "bytes=a-b" range a video player sends, or null if anything else. */
export function parseByteRange(value: string | undefined): string | null {
  if (!value) return null;
  return /^bytes=(\d{1,15})-(\d{0,15})$/.test(value) || /^bytes=-(\d{1,15})$/.test(value) ? value : null;
}
