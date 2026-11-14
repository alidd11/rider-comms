import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createProcessedObjectKey, readSocialS3Config, signSocialObjectRequest,
  SocialPrivateObjectTransport,
} from '../src/socialPrivateObjectTransport.ts';

const ENV = {
  SOCIAL_MEDIA_S3_ENDPOINT: 'https://t3.storageapi.dev',
  SOCIAL_MEDIA_S3_BUCKET: 'social-private-media-abc123',
  SOCIAL_MEDIA_S3_REGION: 'auto',
  SOCIAL_MEDIA_S3_ACCESS_KEY_ID: 'EXAMPLEKEY',
  SOCIAL_MEDIA_S3_SECRET_ACCESS_KEY: 'example-secret-test-only',
};
const UUID = '12345678-1234-4234-8234-123456789abc';
const KEY = 'social/processed/' + UUID + '.jpg';
const NOW = new Date('2026-11-14T17:00:00.000Z');
const JPEG = Uint8Array.from([255, 216, 255, 225, 0, 0, 0, 3]);

describe('Private Social object store (server only)', () => {
  it('is disabled if no credentials exist, and fails closed if configuration is partial', () => {
    assert.equal(readSocialS3Config({}), null);
    for (const invalid of [
      { ...ENV, SOCIAL_MEDIA_S3_ACCESS_KEY_ID: '' },
      { ...ENV, SOCIAL_MEDIA_S3_SECRET_ACCESS_KEY: undefined },
    ]) {
      assert.throws(() => readSocialS3Config(invalid),
        /social_media_storage_configuration_incomplete/);
    }
  });

  it('refuses insecure endpoint URLs, malformed bucket names, regions and styles', () => {
    for (const endpoint of [
      'http://t3.storageapi.dev',
      'https://test:password@t3.storageapi.dev',
      'https://t3.storageapi.dev/path',
      'https://t3.storageapi.dev/?q=1',
      'https://t3.storageapi.dev/#fragment',
      'https://localhost',
      'not a URL',
    ]) {
      assert.throws(() => readSocialS3Config({
        ...ENV, SOCIAL_MEDIA_S3_ENDPOINT: endpoint,
      }), /social_media_storage_endpoint_invalid/);
    }
    assert.throws(() => readSocialS3Config({
      ...ENV, SOCIAL_MEDIA_S3_BUCKET: 'UNSAFE_BUCKET',
    }), /social_media_storage_configuration_invalid/);
    assert.throws(() => readSocialS3Config({
      ...ENV, SOCIAL_MEDIA_S3_REGION: 'eu/../../',
    }), /social_media_storage_configuration_invalid/);
    assert.throws(() => readSocialS3Config({
      ...ENV, SOCIAL_MEDIA_S3_URL_STYLE: 'bucket-in-path',
    }), /social_media_storage_url_style_invalid/);
    assert.equal(readSocialS3Config(ENV)?.urlStyle, 'virtual-host');
    assert.equal(readSocialS3Config({
      ...ENV, SOCIAL_MEDIA_S3_URL_STYLE: 'path',
    })?.urlStyle, 'path');
  });

  it('creates unpredictable, processed-only object keys and rejects path traversal', () => {
    assert.match(createProcessedObjectKey('webp'),
      /^social\/processed\/[0-9a-f-]{36}\.webp$/);
    for (const ext of ['jpg', 'png', 'webp', 'mp4']) {
      assert.equal(createProcessedObjectKey(ext, UUID),
        'social/processed/' + UUID + '.' + ext);
    }
    for (const ext of ['jpeg', 'SVG', '../../secret', 'exe', '']) {
      assert.throws(() => createProcessedObjectKey(ext, UUID),
        /invalid_processed_media_key/);
    }
    assert.throws(() => createProcessedObjectKey('jpg', '../other-user'),
      /invalid_processed_media_key/);
  });

  it('signs virtual-host PUT requests with actual payload hashes and deterministic timestamp', () => {
    const config = readSocialS3Config(ENV)!;
    const request = signSocialObjectRequest(config, 'PUT', KEY, JPEG, 'image/jpeg', NOW);
    assert.equal(request.url, 'https://social-private-media-abc123.t3.storageapi.dev/' + KEY);
    assert.equal(request.headers['x-amz-date'], '20261114T170000Z');
    assert.equal(request.headers['x-amz-content-sha256'],
      createHash('sha256').update(JPEG).digest('hex'));
    assert.equal(request.headers['Content-Type'], 'image/jpeg');
    assert.match(request.headers.Authorization,
      /^AWS4-HMAC-SHA256 Credential=EXAMPLEKEY\/20261114\/auto\/s3\/aws4_request,SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/);
    assert.equal(request.headers.Authorization.includes(config.secretAccessKey), false);
    assert.deepEqual(signSocialObjectRequest(config, 'PUT', KEY, JPEG, 'image/jpeg', NOW), request);
    assert.notEqual(
      signSocialObjectRequest(config, 'PUT', KEY, JPEG, 'image/jpeg',
        new Date('2026-11-14T17:00:01.000Z')).headers.Authorization,
      request.headers.Authorization,
    );
    assert.notEqual(
      signSocialObjectRequest(config, 'PUT', KEY,
        Uint8Array.from([255, 216, 255, 226]), 'image/jpeg', NOW).headers.Authorization,
      request.headers.Authorization,
    );
  });

  it('supports legacy path-style S3 while keeping the signed URL private', () => {
    const config = readSocialS3Config({
      ...ENV, SOCIAL_MEDIA_S3_URL_STYLE: 'path',
    })!;
    const signed = signSocialObjectRequest(config, 'DELETE', KEY,
      new Uint8Array(), undefined, NOW);
    assert.equal(signed.url,
      'https://t3.storageapi.dev/social-private-media-abc123/' + KEY);
    assert.equal(signed.headers['x-amz-content-sha256'],
      createHash('sha256').update('').digest('hex'));
    assert.match(signed.headers.Authorization,
      /SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}/);
  });

  it('rejects unsafe keys and invalid PUT/DELETE shapes before signing', () => {
    const config = readSocialS3Config(ENV)!;
    for (const key of ['../../private',
      'social/processed/xyz.jpg', '/social/processed/' + UUID + '.jpg',
      'social/processed/' + UUID + '.svg']) {
      assert.throws(() => signSocialObjectRequest(config, 'DELETE', key),
        /invalid_processed_media_key/);
    }
    assert.throws(() => signSocialObjectRequest(config, 'PATCH' as 'PUT', KEY),
      /invalid_storage_method/);
    assert.throws(() => signSocialObjectRequest(config, 'DELETE', KEY, JPEG),
      /invalid_storage_delete/);
    assert.throws(() => signSocialObjectRequest(config, 'DELETE', KEY, new Uint8Array(), 'image/jpeg'),
      /invalid_storage_delete/);
    assert.throws(() => signSocialObjectRequest(config, 'PUT', KEY),
      /invalid_processed_media/);
    assert.throws(() => signSocialObjectRequest(config, 'PUT', KEY, JPEG, 'application/pdf'),
      /invalid_processed_media/);
    assert.throws(() => signSocialObjectRequest(config, 'PUT', KEY,
      new Uint8Array(80 * 1024 * 1024 + 1), 'video/mp4'), /invalid_processed_media/);
  });

  it('uploads already processed bytes only via private backend fetch', async () => {
    const config = readSocialS3Config(ENV)!;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    };
    const store = new SocialPrivateObjectTransport(config, fake);
    await store.putProcessed(KEY, JPEG, 'image/jpeg');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://social-private-media-abc123.t3.storageapi.dev/' + KEY);
    assert.equal(calls[0]?.init.method, 'PUT');
    assert.equal(calls[0]?.init.credentials, 'omit');
    assert.equal(calls[0]?.init.redirect, 'error');
    assert.deepEqual(calls[0]?.init.body, Buffer.from(JPEG));
    assert.equal((calls[0]?.init.headers as Record<string, string>).Authorization.includes('example-secret'), false);
  });

  it('allows idempotent DELETE 404 but rejects PUT 404 and storage failures', async () => {
    const config = readSocialS3Config(ENV)!;
    const methods: string[] = [];
    const notFound = new SocialPrivateObjectTransport(config, async (_url, init) => {
      methods.push(init.method ?? '');
      return new Response(null, { status: 404 });
    });
    await notFound.deleteProcessed(KEY);
    assert.deepEqual(methods, ['DELETE']);
    await assert.rejects(() => notFound.putProcessed(KEY, JPEG, 'image/jpeg'),
      /social_media_storage_unavailable/);
    const unavailable = new SocialPrivateObjectTransport(config,
      async () => new Response(null, { status: 503 }));
    await assert.rejects(() => unavailable.deleteProcessed(KEY),
      /social_media_storage_unavailable/);
    const networkDown = new SocialPrivateObjectTransport(config,
      async () => { throw new Error('do-not-leak-network-details'); });
    await assert.rejects(() => networkDown.deleteProcessed(KEY),
      (err: Error) => err.message === 'social_media_storage_unavailable');
    // Instantiating the default transport must not trigger any network requests.
    assert.ok(new SocialPrivateObjectTransport(config));
  });
});
