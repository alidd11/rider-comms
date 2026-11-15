import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import {
  IMAGE_MAX_EDGE, parseFfmpegDuration, processSocialImage, processSocialVideo, SocialMediaProcessingError,
  stageUpload, UploadTooLargeError, VIDEO_MAX_EDGE, VIDEO_QUEUE_LIMIT,
} from '../src/socialMediaProcessor.ts';

const ffmpeg = ffmpegStatic as unknown as string;
let dir: string;

before(async () => { dir = await mkdtemp(join(tmpdir(), 'social-media-test-')); });
after(async () => { await rm(dir, { recursive: true, force: true }); });

function makeVideo(name: string, seconds: number, size = '1920x1080', format = 'mov'): string {
  const path = join(dir, name);
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=15:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-metadata', 'location=+51.5074-000.1278/', '-metadata', 'title=secret ride',
    '-c:v', format === 'matroska' ? 'libvpx' : 'libx264', '-c:a', format === 'matroska' ? 'libopus' : 'aac',
    '-shortest', '-f', format, '-y', path,
  ]);
  return path;
}

/** A shell script standing in for ffmpeg, to reach the failure paths. */
async function fakeFfmpeg(name: string, script: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${script}\n`);
  await chmod(path, 0o755);
  return path;
}

describe('Rider Social photo processing', () => {
  it('re-encodes as JPEG, applies orientation and removes GPS and camera metadata', async () => {
    const original = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#336699' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'RiderCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const before = await sharp(original).metadata();
    assert.ok(before.exif, 'the test photo carries EXIF');
    assert.equal(before.orientation, 6);
    const processed = await processSocialImage(original);
    const meta = await sharp(processed.bytes).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.exif, undefined);
    assert.equal(meta.orientation, undefined);
    assert.equal(processed.bytes.includes(Buffer.from('RiderCam')), false);
    // Orientation 6 means rotate 90°: the long side becomes the height.
    assert.equal(processed.height, IMAGE_MAX_EDGE);
    assert.equal(processed.width, IMAGE_MAX_EDGE / 2);
    assert.deepEqual([meta.width, meta.height], [processed.width, processed.height]);
  });

  it('never enlarges a small photo, and turns a PNG into a JPEG', async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 4, background: '#ff000080' } }).png().toBuffer();
    const processed = await processSocialImage(png);
    assert.deepEqual([processed.width, processed.height], [40, 30]);
    assert.equal((await sharp(processed.bytes).metadata()).format, 'jpeg');
  });

  it('rejects bytes that are not an image', async () => {
    await assert.rejects(processSocialImage(Buffer.from('\xff\xd8\xffnot really a jpeg')),
      (error: unknown) => error instanceof SocialMediaProcessingError && error.code === 'invalid_media');
  });
});

describe('Rider Social video processing', () => {
  it('re-encodes a phone video to H.264 MP4 at most 1280 px, without metadata, with a poster', async () => {
    const input = makeVideo('landscape.mov', 2);
    const video = await processSocialVideo(input, 'mov');
    assert.deepEqual([video.width, video.height], [VIDEO_MAX_EDGE, 720]);
    assert.ok(video.durationMs >= 1900 && video.durationMs <= 2100, String(video.durationMs));
    assert.equal(video.bytes.subarray(4, 8).toString(), 'ftyp');
    assert.equal(video.bytes.includes(Buffer.from('secret ride')), false);
    assert.equal(video.bytes.includes(Buffer.from('+51.5074')), false);
    assert.equal((await sharp(video.poster).metadata()).format, 'jpeg');
    const out = join(dir, 'check.mp4');
    await writeFile(out, video.bytes);
    let probe = '';
    try { execFileSync(ffmpeg, ['-hide_banner', '-i', out], { stdio: 'pipe' }); } catch (error) { probe = String((error as { stderr: Buffer }).stderr); }
    assert.match(probe, /Video: h264/);
    assert.match(probe, /Audio: aac/);
    assert.doesNotMatch(probe, /location|secret ride/);
  });

  it('keeps a portrait video upright and reads WebM', async () => {
    const video = await processSocialVideo(makeVideo('portrait.webm', 1, '720x1600', 'matroska'), 'matroska');
    assert.deepEqual([video.width, video.height], [576, VIDEO_MAX_EDGE]);
  });

  it('refuses videos longer than the limit, files that are not video, and a wrong container', async () => {
    const isCode = (code: string) => (error: unknown) => error instanceof SocialMediaProcessingError && error.code === code;
    await assert.rejects(processSocialVideo(makeVideo('long.mov', 3, '320x240'), 'mov', { maxSeconds: 1 }), isCode('media_too_long'));
    const junk = join(dir, 'junk.mov');
    await writeFile(junk, Buffer.from('\x00\x00\x00\x18ftypqt  not a real movie'));
    await assert.rejects(processSocialVideo(junk, 'mov'), isCode('invalid_media'));
    // A WebM file can't be opened with the MOV demuxer: no other format is tried.
    await assert.rejects(processSocialVideo(makeVideo('other.webm', 1, '320x240', 'matroska'), 'mov'), isCode('invalid_media'));
    await assert.rejects(processSocialVideo(junk, 'mov', { ffmpegPath: '' }), isCode('media_processing_failed'));
  });

  it('reports a failed encode or poster frame', async () => {
    const isCode = (code: string) => (error: unknown) => error instanceof SocialMediaProcessingError && error.code === code;
    const probeOk = 'echo "  Duration: 00:00:02.00, start: 0" >&2; echo "  Stream #0:0: Video: h264" >&2';
    const failsEncode = await fakeFfmpeg('fails-encode', `${probeOk}\ncase "$*" in *libx264*) exit 1;; esac\nexit 1`);
    await assert.rejects(processSocialVideo(join(dir, 'landscape.mov'), 'mov', { ffmpegPath: failsEncode }), isCode('invalid_media'));
    const failsPoster = await fakeFfmpeg('fails-poster', `${probeOk}\ncase "$*" in *libx264*) for last; do :; done; : > "$last"; exit 0;; *frames*) exit 1;; esac\nexit 1`);
    await assert.rejects(processSocialVideo(join(dir, 'landscape.mov'), 'mov', { ffmpegPath: failsPoster }), isCode('media_processing_failed'));
  });

  it('transcodes one video at a time and turns away more than the queue holds', async () => {
    const probeOk = 'echo "  Duration: 00:00:01.00, start: 0" >&2; echo "  Stream #0:0: Video: h264" >&2';
    const slow = await fakeFfmpeg('slow', `${probeOk}\ncase "$*" in *libx264*) sleep 0.4; exit 1;; esac\nexit 1`);
    const jobs = Array.from({ length: VIDEO_QUEUE_LIMIT + 2 }, () =>
      processSocialVideo(join(dir, 'landscape.mov'), 'mov', { ffmpegPath: slow }).then(() => 'ok', (error: SocialMediaProcessingError) => error.code));
    const results = await Promise.all(jobs);
    assert.equal(results.filter((code) => code === 'media_busy').length, 1);
    assert.equal(results.filter((code) => code === 'invalid_media').length, VIDEO_QUEUE_LIMIT + 1);
  });

  it('reads the duration ffmpeg prints', () => {
    assert.equal(parseFfmpegDuration('  Duration: 00:01:02.50, start: 0.0'), 62.5);
    assert.equal(parseFfmpegDuration('  Duration: 01:00:00.00'), 3600);
    assert.equal(parseFfmpegDuration('  Duration: N/A'), null);
    assert.equal(parseFfmpegDuration('  Duration: 00:00:00.00'), null);
  });
});

describe('Rider Social upload staging', () => {
  async function* chunks(...parts: Array<string | Buffer>) { for (const part of parts) yield part; }

  it('streams the body to a private file and keeps the first bytes', async () => {
    const staged = await stageUpload(chunks(Buffer.from([1, 2, 3]), 'abcdefghijklmnopqrstuvwxyz'), 100);
    assert.equal(staged.bytes, 29);
    assert.deepEqual([...staged.header], [1, 2, 3, ...Buffer.from('abcdefghijklm')]);
    assert.equal((await readFile(staged.path)).length, 29);
    await staged.cleanup();
    await assert.rejects(readFile(staged.path));
  });

  it('rejects invalid upload size limits without leaving a staged file', async () => {
    for (const limit of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(stageUpload(chunks('abc'), limit), /invalid_upload_limit/);
    }
  });

  it('preserves every byte across multiple large chunks', async () => {
    const first = Buffer.alloc(128 * 1024, 0xa5);
    const second = Buffer.alloc(129 * 1024, 0x5a);
    const staged = await stageUpload(chunks(first, second), first.length + second.length);
    try {
      assert.equal(staged.bytes, first.length + second.length);
      assert.deepEqual(await readFile(staged.path), Buffer.concat([first, second]));
    } finally {
      await staged.cleanup();
    }
  });

  it('stops as soon as the upload passes its limit, leaving nothing behind', async () => {
    await assert.rejects(stageUpload(chunks('12345', '67890'), 8), UploadTooLargeError);
  });
});
