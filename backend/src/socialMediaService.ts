import { createHmac, timingSafeEqual } from 'node:crypto';
import { processSocialImage, processSocialVideo } from './socialMediaProcessor.ts';
import type { ProcessedImage, ProcessedVideo, VideoContainer } from './socialMediaProcessor.ts';
import { readSocialS3Config, SocialPrivateObjectTransport } from './socialPrivateObjectTransport.ts';
import { mediaScannerFromEnv, type MediaScanner } from './socialMediaScanner.ts';

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
  /** The unsafe-content check. Without it, posting stays off. */
  scan?: MediaScanner;
}

export type MediaVariant = 'file' | 'poster';

const MINUTE_MS = 60_000;
/** Links are issued in 10-minute steps, so a refreshed feed reuses the same URL. */
const LINK_STEP_MS = 10 * MINUTE_MS;
/** The longest a link lasts; with the step, a link lives 20 to 30 minutes. */
export const MEDIA_LINK_LIFETIME_MS = 30 * MINUTE_MS;
// Accept the legacy 32-character hex session token or a canonical UUID, not
// arbitrary hyphen placement that merely happens to be 32–36 characters.
const SESSION_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/;

/** Who a link is for: the rider and the signed-in session that asked for it. */
export interface MediaLinkViewer {
  riderId: string;
  sessionId: string;
}

export function isMediaSessionId(value: string): boolean {
  return SESSION_ID.test(value);
}

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
    scan: mediaScannerFromEnv(env) ?? undefined,
  };
}

function signature(secret: Buffer, viewer: MediaLinkViewer, mediaId: string, variant: MediaVariant, expiresAt: number): string {
  return createHmac('sha256', secret)
    .update(`${viewer.riderId}\n${viewer.sessionId}\n${mediaId}\n${variant}\n${expiresAt}`).digest('base64url');
}

/**
 * A link to one file for one rider's session. It stops working when it
 * expires or that session signs out; the server also re-checks, on every
 * request, that the rider may still see the post.
 */
export function signedMediaPath(secret: Buffer, viewer: MediaLinkViewer, mediaId: string, variant: MediaVariant, now = Date.now()): string {
  const expiresAt = Math.floor(now / LINK_STEP_MS) * LINK_STEP_MS + MEDIA_LINK_LIFETIME_MS;
  const sig = signature(secret, viewer, mediaId, variant, expiresAt);
  return `/social/media/${mediaId}/${variant}?v=${encodeURIComponent(viewer.riderId)}` +
    `&s=${encodeURIComponent(viewer.sessionId)}&exp=${expiresAt}&sig=${sig}`;
}

export function verifyMediaSignature(
  secret: Buffer, viewer: MediaLinkViewer, mediaId: string, variant: MediaVariant,
  expiresAt: number, sig: string, now = Date.now(),
): boolean {
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + MEDIA_LINK_LIFETIME_MS) return false;
  if (!isMediaSessionId(viewer.sessionId)) return false;
  // HMAC-SHA256 encoded as unpadded base64url is exactly 43 characters.
  // Reject malformed/oversized attacker-controlled signatures before allocation.
  if (!/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  const expected = Buffer.from(signature(secret, viewer, mediaId, variant, expiresAt));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export { parseByteRange } from './socialPrivateObjectTransport.ts';
