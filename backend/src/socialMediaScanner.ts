import sharp from 'sharp';
import { log } from './log.ts';

/**
 * Rider Social's unsafe-content check: every photo, and a Reel's poster plus
 * frames from through it, goes to Google Cloud Vision SafeSearch before it is
 * stored. It fails closed: if Google can't answer, the upload is refused, never
 * let through unchecked.
 *
 * The key is GOOGLE_VISION_API_KEY, else the Places/Directions key. It goes in
 * a header, never the URL, so it can't end up in a log line.
 */
export type MediaScanVerdict = 'allowed' | 'rejected';
export type MediaScanner = (images: readonly Buffer[]) => Promise<MediaScanVerdict>;

export class MediaScanUnavailableError extends Error {
  constructor() {
    super('media_scan_unavailable');
    this.name = 'MediaScanUnavailableError';
  }
}

export const VISION_ANNOTATE_URL = 'https://vision.googleapis.com/v1/images:annotate';
/** Small enough to send quickly, big enough for SafeSearch. */
const SCAN_EDGE = 640;
const LIKELIHOOD = ['UNKNOWN', 'VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'] as const;

export interface SafeSearchAnnotation {
  adult?: string;
  violence?: string;
  racy?: string;
  medical?: string;
  spoof?: string;
}

function level(value: string | undefined): number {
  const index = LIKELIHOOD.indexOf((value ?? 'UNKNOWN') as typeof LIKELIHOOD[number]);
  return index < 0 ? 0 : index;
}

/**
 * Nudity or graphic violence that Google rates likely or very likely is
 * refused; racy content only when very likely (a rider in leathers on a beach
 * shouldn't be). Medical and spoof ratings don't block.
 */
export function safeSearchBlocks(annotation: SafeSearchAnnotation): boolean {
  return level(annotation.adult) >= level('LIKELY')
    || level(annotation.violence) >= level('LIKELY')
    || level(annotation.racy) >= level('VERY_LIKELY');
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;

export function googleSafeSearchScanner(apiKey: string, fetchImpl: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })): MediaScanner {
  return async (images) => {
    if (images.length === 0) throw new MediaScanUnavailableError();
    let requests;
    try {
      requests = await Promise.all(images.map(async (image) => ({
        image: {
          content: (await sharp(image).resize({ width: SCAN_EDGE, height: SCAN_EDGE, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 }).toBuffer()).toString('base64'),
        },
        features: [{ type: 'SAFE_SEARCH_DETECTION' }],
      })));
    } catch {
      throw new MediaScanUnavailableError();
    }
    let response: Response;
    try {
      response = await fetchImpl(VISION_ANNOTATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
        body: JSON.stringify({ requests }),
      });
    } catch (error) {
      log('warn', 'media_scan_failed', { message: error instanceof Error ? error.message : String(error) });
      throw new MediaScanUnavailableError();
    }
    let body: { responses?: Array<{ safeSearchAnnotation?: SafeSearchAnnotation; error?: { message?: string } }>; error?: { status?: string; message?: string } };
    try {
      body = await response.json() as typeof body;
    } catch {
      body = {};
    }
    if (!response.ok) {
      log('warn', 'media_scan_refused', {
        httpStatus: response.status,
        googleStatus: typeof body.error?.status === 'string' ? body.error.status : undefined,
        googleMessage: typeof body.error?.message === 'string' ? body.error.message.slice(0, 400) : undefined,
      });
      throw new MediaScanUnavailableError();
    }
    const results = body.responses ?? [];
    if (results.length !== images.length || results.some((result) => result.error || !result.safeSearchAnnotation)) {
      log('warn', 'media_scan_incomplete', { images: images.length, answered: results.length });
      throw new MediaScanUnavailableError();
    }
    return results.some((result) => safeSearchBlocks(result.safeSearchAnnotation!)) ? 'rejected' : 'allowed';
  };
}

export function mediaScannerFromEnv(env: Record<string, string | undefined> = process.env): MediaScanner | null {
  const key = (env.GOOGLE_VISION_API_KEY || env.GOOGLE_PLACES_API_KEY || env.GOOGLE_DIRECTIONS_API_KEY || '').trim();
  return key ? googleSafeSearchScanner(key) : null;
}
