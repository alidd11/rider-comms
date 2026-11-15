import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseByteRange, signedMediaPath, socialMediaServiceFromEnv, verifyMediaSignature } from '../src/socialMediaService.ts';
import { SocialPrivateObjectTransport } from '../src/socialPrivateObjectTransport.ts';

const ENV = {
  SOCIAL_MEDIA_S3_ENDPOINT: 'https://t3.storageapi.dev',
  SOCIAL_MEDIA_S3_BUCKET: 'social-private-media-abc123',
  SOCIAL_MEDIA_S3_REGION: 'auto',
  SOCIAL_MEDIA_S3_ACCESS_KEY_ID: 'EXAMPLEKEY',
  SOCIAL_MEDIA_S3_SECRET_ACCESS_KEY: 'example-secret-test-only',
};
const MEDIA = '12345678-1234-4234-8234-123456789abc';
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 15, 10, 20);

function parts(path: string) {
  const url = new URL(path, 'https://api.test');
  return { v: url.searchParams.get('v')!, exp: Number(url.searchParams.get('exp')), sig: url.searchParams.get('sig')!, path: url.pathname };
}

describe('Rider Social media service', () => {
  it('is off without storage, and derives its link key from the storage secret unless one is given', async () => {
    assert.equal(socialMediaServiceFromEnv({}), null);
    const service = socialMediaServiceFromEnv(ENV)!;
    assert.ok(service.storage instanceof SocialPrivateObjectTransport);
    assert.equal(service.urlSecret.length, 32);
    assert.equal(service.urlSecret.toString().includes('example-secret'), false);
    const short = socialMediaServiceFromEnv({ ...ENV, SOCIAL_MEDIA_URL_SECRET: 'too-short' })!;
    assert.deepEqual(short.urlSecret, service.urlSecret);
    const given = 'x'.repeat(40);
    assert.equal(socialMediaServiceFromEnv({ ...ENV, SOCIAL_MEDIA_URL_SECRET: given })!.urlSecret.toString(), given);
    assert.equal(typeof service.processImage, 'function');
    await assert.rejects(service.processVideo('/nonexistent', 'mov'), /invalid_media/);
  });

  it('signs a link for one viewer and one file, expiring on the hour', () => {
    const secret = Buffer.alloc(32, 7);
    const link = parts(signedMediaPath(secret, 'rider_a', MEDIA, 'file', NOW));
    assert.equal(link.path, `/social/media/${MEDIA}/file`);
    assert.equal(link.v, 'rider_a');
    assert.equal(link.exp, Date.UTC(2026, 10, 15, 12, 0));
    // The same link for the rest of the hour, so the phone can cache it.
    assert.equal(signedMediaPath(secret, 'rider_a', MEDIA, 'file', NOW + 30 * 60_000), signedMediaPath(secret, 'rider_a', MEDIA, 'file', NOW));
    assert.equal(verifyMediaSignature(secret, 'rider_a', MEDIA, 'file', link.exp, link.sig, NOW), true);
    assert.equal(verifyMediaSignature(secret, 'rider_b', MEDIA, 'file', link.exp, link.sig, NOW), false);
    assert.equal(verifyMediaSignature(secret, 'rider_a', MEDIA, 'poster', link.exp, link.sig, NOW), false);
    assert.equal(verifyMediaSignature(secret, 'rider_a', MEDIA, 'file', link.exp + HOUR, link.sig, NOW), false);
    assert.equal(verifyMediaSignature(Buffer.alloc(32, 8), 'rider_a', MEDIA, 'file', link.exp, link.sig, NOW), false);
    assert.equal(verifyMediaSignature(secret, 'rider_a', MEDIA, 'file', link.exp, 'short', NOW), false);
    // Expired, or claiming to last longer than any link we issue.
    assert.equal(verifyMediaSignature(secret, 'rider_a', MEDIA, 'file', link.exp, link.sig, link.exp + 1), false);
    assert.equal(verifyMediaSignature(secret, 'rider_a', MEDIA, 'file', NOW + 4 * HOUR, link.sig, NOW), false);
    assert.equal(verifyMediaSignature(secret, 'rider_a', MEDIA, 'file', Number.NaN, link.sig, NOW), false);
  });

  it('accepts only a single byte range', () => {
    assert.equal(parseByteRange(undefined), null);
    assert.equal(parseByteRange('bytes=0-'), 'bytes=0-');
    assert.equal(parseByteRange('bytes=100-199'), 'bytes=100-199');
    assert.equal(parseByteRange('bytes=-500'), 'bytes=-500');
    assert.equal(parseByteRange('bytes=0-1,5-9'), null);
    assert.equal(parseByteRange('items=0-1'), null);
    assert.equal(parseByteRange('bytes=-'), null);
  });
});
