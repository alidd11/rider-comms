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
const NOW = Date.UTC(2026, 10, 15, 10, 20);

const SESSION = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER_SESSION = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const MINUTE = 60_000;

function parts(path: string) {
  const url = new URL(path, 'https://api.test');
  return { v: url.searchParams.get('v')!, s: url.searchParams.get('s')!, exp: Number(url.searchParams.get('exp')), sig: url.searchParams.get('sig')!, path: url.pathname };
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

  it('signs a link for one rider session and one file, lasting 20 to 30 minutes', () => {
    const secret = Buffer.alloc(32, 7);
    const viewer = { riderId: 'rider_a', sessionId: SESSION };
    const link = parts(signedMediaPath(secret, viewer, MEDIA, 'file', NOW));
    assert.equal(link.path, `/social/media/${MEDIA}/file`);
    assert.deepEqual([link.v, link.s], ['rider_a', SESSION]);
    assert.equal(link.exp, Date.UTC(2026, 10, 15, 10, 50));
    // The same link for the rest of its 10-minute step, so a refreshed feed reuses it.
    assert.equal(signedMediaPath(secret, viewer, MEDIA, 'file', NOW + 9 * MINUTE), signedMediaPath(secret, viewer, MEDIA, 'file', NOW));
    assert.notEqual(signedMediaPath(secret, viewer, MEDIA, 'file', NOW + 10 * MINUTE), signedMediaPath(secret, viewer, MEDIA, 'file', NOW));
    const check = (who: { riderId: string; sessionId: string }, variant: 'file' | 'poster', exp: number, sig: string, now = NOW, key = secret) =>
      verifyMediaSignature(key, who, MEDIA, variant, exp, sig, now);
    assert.equal(check(viewer, 'file', link.exp, link.sig), true);
    assert.equal(check({ riderId: 'rider_b', sessionId: SESSION }, 'file', link.exp, link.sig), false, 'another rider');
    assert.equal(check({ riderId: 'rider_a', sessionId: OTHER_SESSION }, 'file', link.exp, link.sig), false, 'another session');
    assert.equal(check({ riderId: 'rider_a', sessionId: 'not-a-session' }, 'file', link.exp, link.sig), false);
    // Signed links must not accept UUID-looking tokens with misplaced hyphens.
    for (const malformed of [
      'aaaaaaaa1111-4111-8111-aaaaaaaaaaaa',
      'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa-',
      'aaaaaaaa--1111-4111-8111-aaaaaaaaaaa',
    ]) {
      const forged = parts(signedMediaPath(secret, { riderId: 'rider_a', sessionId: malformed }, MEDIA, 'file', NOW));
      assert.equal(check({ riderId: 'rider_a', sessionId: malformed }, 'file', forged.exp, forged.sig), false);
    }
    const compactSession = 'a'.repeat(32);
    const compactLink = parts(signedMediaPath(secret, { riderId: 'rider_a', sessionId: compactSession }, MEDIA, 'file', NOW));
    assert.equal(check({ riderId: 'rider_a', sessionId: compactSession }, 'file', compactLink.exp, compactLink.sig), true);
    assert.equal(check(viewer, 'poster', link.exp, link.sig), false);
    assert.equal(check(viewer, 'file', link.exp + 10 * MINUTE, link.sig), false);
    assert.equal(check(viewer, 'file', link.exp, link.sig, NOW, Buffer.alloc(32, 8)), false);
    assert.equal(check(viewer, 'file', link.exp, 'short'), false);
    // Expired, or claiming to last longer than any link we issue.
    assert.equal(check(viewer, 'file', link.exp, link.sig, link.exp + 1), false);
    assert.equal(check(viewer, 'file', NOW + 31 * MINUTE, link.sig), false);
    assert.equal(check(viewer, 'file', Number.NaN, link.sig), false);
    // Fuzz-style boundary cases: invalid expiries and malformed signatures
    // must be rejected without throwing or granting access.
    for (const invalidExpiry of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(check(viewer, 'file', invalidExpiry, link.sig), false);
    }
    for (const invalidSignature of ['', 'x'.repeat(1000), link.sig.slice(1), link.sig + '=']) {
      assert.equal(check(viewer, 'file', link.exp, invalidSignature), false);
    }
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
