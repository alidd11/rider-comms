import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';

/**
 * Rider Social media processing. Every upload is fully decoded and re-encoded
 * here before it is stored, which strips location, camera and other metadata
 * and means the stored file is one we produced, not the rider's original bytes.
 */
export type SocialMediaProcessingErrorCode =
  | 'invalid_media' | 'media_too_long' | 'media_busy' | 'media_processing_failed';

export class SocialMediaProcessingError extends Error {
  readonly code: SocialMediaProcessingErrorCode;
  constructor(code: SocialMediaProcessingErrorCode) {
    super(code);
    this.name = 'SocialMediaProcessingError';
    this.code = code;
  }
}

export interface ProcessedImage { bytes: Buffer; width: number; height: number }
export interface ProcessedVideo extends ProcessedImage {
  poster: Buffer;
  durationMs: number;
  /** Frames from through the video, for the unsafe-content check. */
  frames: Buffer[];
}

/** Where, through a Reel, frames are taken for the content check. */
export const VIDEO_SCAN_POINTS = [0.25, 0.5, 0.75] as const;

/** Longest side of a stored photo, and of a Reel's frame. */
export const IMAGE_MAX_EDGE = 2048;
export const VIDEO_MAX_EDGE = 1280;
export const VIDEO_MAX_SECONDS = 60;
// A 50-megapixel ceiling stops a small file that decodes to a huge image.
const IMAGE_MAX_INPUT_PIXELS = 50_000_000;
const VIDEO_TIMEOUT_MS = 240_000;
const PROBE_TIMEOUT_MS = 20_000;

export async function processSocialImage(input: Buffer): Promise<ProcessedImage> {
  try {
    const { data, info } = await sharp(input, { limitInputPixels: IMAGE_MAX_INPUT_PIXELS, failOn: 'error' })
      // Apply the camera's orientation before the metadata is dropped.
      .rotate()
      .resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    throw new SocialMediaProcessingError('invalid_media');
  }
}

export type VideoContainer = 'mov' | 'matroska';

export interface VideoProcessorOptions {
  ffmpegPath?: string;
  maxSeconds?: number;
  timeoutMs?: number;
}

type Run = (args: string[], timeoutMs: number) => Promise<{ code: number; stderr: string }>;

function runner(ffmpegPath: string): Run {
  return (args, timeoutMs) => new Promise((resolve) => {
    execFile(ffmpegPath, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' }, (error, _stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
      resolve({ code, stderr: String(stderr) });
    });
  });
}

/** Seconds from ffmpeg's "Duration: 00:00:12.34" line, or null. */
export function parseFfmpegDuration(stderr: string): number | null {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// One video at a time per server, with a short queue: transcoding is heavy,
// and the same server carries live rides and voice.
let videoJobsRunning = 0;
let videoJobsWaiting = 0;
const videoQueue: Array<() => void> = [];
export const VIDEO_QUEUE_LIMIT = 2;

async function withVideoSlot<T>(work: () => Promise<T>): Promise<T> {
  if (videoJobsRunning > 0) {
    if (videoJobsWaiting >= VIDEO_QUEUE_LIMIT) throw new SocialMediaProcessingError('media_busy');
    videoJobsWaiting += 1;
    await new Promise<void>((resolve) => videoQueue.push(resolve));
    videoJobsWaiting -= 1;
  }
  videoJobsRunning += 1;
  try {
    return await work();
  } finally {
    videoJobsRunning -= 1;
    videoQueue.shift()?.();
  }
}

/**
 * Re-encodes a rider's video as H.264/AAC MP4 (plays everywhere), at most
 * 1280 px on its long side and 60 s long, with all metadata removed, plus a
 * poster frame. The input must already have passed the signature check, and
 * `container` names the only demuxer ffmpeg may use: with file-only protocols
 * this stops a crafted playlist from making the server fetch other URLs.
 */
export async function processSocialVideo(
  inputPath: string,
  container: VideoContainer,
  options: VideoProcessorOptions = {},
): Promise<ProcessedVideo> {
  const ffmpegPath = options.ffmpegPath ?? (ffmpegStatic as unknown as string | null);
  if (!ffmpegPath) throw new SocialMediaProcessingError('media_processing_failed');
  const maxSeconds = options.maxSeconds ?? VIDEO_MAX_SECONDS;
  const timeoutMs = options.timeoutMs ?? VIDEO_TIMEOUT_MS;
  const run = runner(ffmpegPath);
  const safeInput = ['-hide_banner', '-nostdin', '-protocol_whitelist', 'file', '-f', container, '-i', inputPath];

  // Acquire the bounded slot before invoking ffmpeg at all: even a probe
  // spawns a subprocess and must not bypass the server's video concurrency cap.
  return withVideoSlot(async () => {
    // Probe: ffmpeg with no output exits non-zero, but prints the streams.
    const probe = await run(safeInput, PROBE_TIMEOUT_MS);
    const duration = parseFfmpegDuration(probe.stderr);
    if (!duration || !/Stream #\d+:\d+.*: Video:/.test(probe.stderr)) {
      throw new SocialMediaProcessingError('invalid_media');
    }
    // Half a second of grace for containers that round up.
    if (duration > maxSeconds + 0.5) throw new SocialMediaProcessingError('media_too_long');

    const work = await mkdtemp(join(tmpdir(), 'social-video-'));
    try {
      const output = join(work, 'out.mp4');
      const poster = join(work, 'poster.jpg');
      const edge = VIDEO_MAX_EDGE;
      const scale = `scale=w='if(gte(iw,ih),min(${edge},iw),-2)':h='if(gte(iw,ih),-2,min(${edge},ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2`;
      const encode = await run([
        ...safeInput,
        '-map', '0:v:0', '-map', '0:a:0?', '-t', String(maxSeconds),
        '-vf', scale, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-map_metadata', '-1', '-map_chapters', '-1', '-metadata:s', 'handler_name=',
        '-movflags', '+faststart', '-threads', '2', '-y', output,
      ], timeoutMs);
      if (encode.code !== 0) throw new SocialMediaProcessingError('invalid_media');
      const frame = await run([
        '-hide_banner', '-nostdin', '-protocol_whitelist', 'file', '-f', 'mp4', '-i', output,
        '-frames:v', '1', '-q:v', '3', '-y', poster,
      ], PROBE_TIMEOUT_MS);
      if (frame.code !== 0) throw new SocialMediaProcessingError('media_processing_failed');
      const posterBytes = await sharp(await readFile(poster)).jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true });
      const seconds = Math.min(duration, maxSeconds);
      const frames: Buffer[] = [];
      for (const [index, point] of VIDEO_SCAN_POINTS.entries()) {
        const framePath = join(work, `scan-${index}.jpg`);
        const sample = await run([
          '-hide_banner', '-nostdin', '-protocol_whitelist', 'file', '-ss', (seconds * point).toFixed(2),
          '-f', 'mp4', '-i', output, '-frames:v', '1', '-q:v', '4', '-y', framePath,
        ], PROBE_TIMEOUT_MS);
        // A very short clip can end before a seek point; the poster still covers it.
        if (sample.code === 0) frames.push(await readFile(framePath).catch(() => Buffer.alloc(0)));
      }
      return {
        frames: frames.filter((frame) => frame.length > 0),
        bytes: await readFile(output),
        poster: posterBytes.data,
        width: posterBytes.info.width,
        height: posterBytes.info.height,
        durationMs: Math.round(Math.min(duration, maxSeconds) * 1000),
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}

export interface StagedUpload {
  path: string;
  bytes: number;
  /** The first bytes, for the signature check. */
  header: Buffer;
  cleanup: () => Promise<void>;
}

export class UploadTooLargeError extends Error {
  constructor() { super('upload_too_large'); this.name = 'UploadTooLargeError'; }
}

/**
 * Streams an upload into a private temporary file, stopping as soon as it
 * passes `maxBytes`, so a large video never sits in memory.
 */
export async function stageUpload(body: AsyncIterable<Buffer | string>, maxBytes: number): Promise<StagedUpload> {
  const dir = await mkdtemp(join(tmpdir(), 'social-upload-'));
  const path = join(dir, 'input');
  const cleanup = () => rm(dir, { recursive: true, force: true });
  let file;
  try {
    file = await open(path, 'wx', 0o600);
  } catch (error) {
    await cleanup();
    throw error;
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    await file.close();
    await cleanup();
    throw new RangeError('invalid_upload_limit');
  }
  let bytes = 0;
  const headerParts: Buffer[] = [];
  let headerBytes = 0;
  try {
    for await (const chunk of body) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += buffer.length;
      if (bytes > maxBytes) throw new UploadTooLargeError();
      if (headerBytes < 16) {
        headerParts.push(buffer.subarray(0, 16 - headerBytes));
        headerBytes += Math.min(buffer.length, 16 - headerBytes);
      }
      // FileHandle.write may write fewer bytes than requested; never accept a
      // truncated upload as a successfully staged media object.
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset);
        if (bytesWritten <= 0) throw new Error('social_upload_write_failed');
        offset += bytesWritten;
      }
    }
  } catch (error) {
    await file.close();
    await cleanup();
    throw error;
  }
  await file.close();
  return { path, bytes, header: Buffer.concat(headerParts), cleanup };
}
