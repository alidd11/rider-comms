import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  googleSafeSearchScanner, MediaScanUnavailableError, mediaScannerFromEnv, safeSearchBlocks, VISION_ANNOTATE_URL,
} from '../src/socialMediaScanner.ts';

const image = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#4a7' } }).jpeg().toBuffer();

function vision(status: number, body: unknown, calls: Array<{ url: string; headers: Record<string, string>; body: string }> = []) {
  return async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
}

const safe = { adult: 'VERY_UNLIKELY', violence: 'UNLIKELY', racy: 'POSSIBLE', medical: 'UNLIKELY', spoof: 'UNLIKELY' };

describe('Rider Social content check', () => {
  it('blocks likely nudity or violence, and racy content only when very likely', () => {
    assert.equal(safeSearchBlocks(safe), false);
    assert.equal(safeSearchBlocks({ ...safe, adult: 'LIKELY' }), true);
    assert.equal(safeSearchBlocks({ ...safe, violence: 'VERY_LIKELY' }), true);
    assert.equal(safeSearchBlocks({ ...safe, racy: 'LIKELY' }), false);
    assert.equal(safeSearchBlocks({ ...safe, racy: 'VERY_LIKELY' }), true);
    assert.equal(safeSearchBlocks({ ...safe, medical: 'VERY_LIKELY', spoof: 'VERY_LIKELY' }), false);
    assert.equal(safeSearchBlocks({}), false);
    assert.equal(safeSearchBlocks({ adult: 'NONSENSE' }), false);
  });

  it('sends small copies of every image with the key in a header, and rejects if any is unsafe', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const scan = googleSafeSearchScanner('test-key', vision(200, { responses: [{ safeSearchAnnotation: safe }, { safeSearchAnnotation: { ...safe, adult: 'VERY_LIKELY' } }] }, calls) as never);
    assert.equal(await scan([image, image]), 'rejected');
    assert.equal(calls[0]!.url, VISION_ANNOTATE_URL);
    assert.equal(calls[0]!.headers['X-Goog-Api-Key'], 'test-key');
    assert.equal(calls[0]!.url.includes('test-key'), false);
    const sent = JSON.parse(calls[0]!.body) as { requests: Array<{ image: { content: string }; features: Array<{ type: string }> }> };
    assert.equal(sent.requests.length, 2);
    assert.equal(sent.requests[0]!.features[0]!.type, 'SAFE_SEARCH_DETECTION');
    const { width } = await sharp(Buffer.from(sent.requests[0]!.image.content, 'base64')).metadata();
    assert.equal(width, 640);

    const allowed = googleSafeSearchScanner('k', vision(200, { responses: [{ safeSearchAnnotation: safe }] }) as never);
    assert.equal(await allowed([image]), 'allowed');
  });

  it('fails closed whenever it can’t get a full answer', async () => {
    const refusals = [
      vision(403, { error: { status: 'PERMISSION_DENIED', message: 'Cloud Vision API has not been used' } }),
      vision(500, 'not json'),
      vision(200, { responses: [] }),
      vision(200, { responses: [{ error: { message: 'bad image' } }] }),
      vision(200, { responses: [{}] }),
      async () => { throw new Error('offline'); },
    ];
    for (const fetchImpl of refusals) {
      await assert.rejects(googleSafeSearchScanner('k', fetchImpl as never)([image]), MediaScanUnavailableError);
    }
    await assert.rejects(googleSafeSearchScanner('k', vision(200, {}) as never)([]), MediaScanUnavailableError);
    await assert.rejects(googleSafeSearchScanner('k', vision(200, {}) as never)([Buffer.from('not an image')]), MediaScanUnavailableError);
  });

  it('uses the Vision key, else the Places or Directions key, and is off without one', () => {
    assert.equal(mediaScannerFromEnv({}), null);
    assert.equal(mediaScannerFromEnv({ GOOGLE_VISION_API_KEY: '  ' }), null);
    assert.equal(typeof mediaScannerFromEnv({ GOOGLE_PLACES_API_KEY: 'p' }), 'function');
    assert.equal(typeof mediaScannerFromEnv({ GOOGLE_DIRECTIONS_API_KEY: 'd' }), 'function');
    assert.equal(typeof mediaScannerFromEnv({ GOOGLE_VISION_API_KEY: 'v' }), 'function');
  });
});
