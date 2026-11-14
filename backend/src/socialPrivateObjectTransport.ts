import { createHash, createHmac, randomUUID } from 'node:crypto';

/**
 * Server-only transport for private processed media. This is intentionally
 * NOT an upload API or a media sanitiser. Never return signed requests, object
 * URLs, S3 credentials or object keys to the Social client.
 */
export interface SocialS3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  urlStyle: 'virtual-host' | 'path';
}
const OBJECT_KEY = /^social\/processed\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|png|webp|mp4)$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const MAX_PROCESSED_BYTES = 80 * 1024 * 1024;
const SHA256_EMPTY = createHash('sha256').update('').digest('hex');
const MIME_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4',
});

export function createProcessedObjectKey(extension: string, id = randomUUID()): string {
  const key = 'social/processed/' + id + '.' + extension;
  if (!OBJECT_KEY.test(key)) throw new Error('invalid_processed_media_key');
  return key;
}

/** No configuration = disabled. Partial/unsafe configuration = fail closed. */
export function readSocialS3Config(env: Record<string, string | undefined> = process.env): SocialS3Config | null {
  const endpoint = env.SOCIAL_MEDIA_S3_ENDPOINT?.trim();
  const bucket = env.SOCIAL_MEDIA_S3_BUCKET?.trim();
  const region = env.SOCIAL_MEDIA_S3_REGION?.trim();
  const accessKeyId = env.SOCIAL_MEDIA_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.SOCIAL_MEDIA_S3_SECRET_ACCESS_KEY?.trim();
  if (![endpoint, bucket, region, accessKeyId, secretAccessKey].some(Boolean)) return null;
  if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error('social_media_storage_configuration_incomplete');
  }
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('social_media_storage_endpoint_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.port || !url.hostname.includes('.')) {
    throw new Error('social_media_storage_endpoint_invalid');
  }
  if (!BUCKET_NAME.test(bucket) || !/^[a-z0-9-]{1,64}$/.test(region)) {
    throw new Error('social_media_storage_configuration_invalid');
  }
  const rawStyle = env.SOCIAL_MEDIA_S3_URL_STYLE?.trim();
  if (rawStyle && rawStyle !== 'virtual-host' && rawStyle !== 'path') {
    throw new Error('social_media_storage_url_style_invalid');
  }
  return {
    endpoint: url.origin, bucket, region, accessKeyId, secretAccessKey,
    urlStyle: rawStyle === 'path' ? 'path' : 'virtual-host',
  };
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export interface SignedSocialObjectRequest {
  /** Internal-only; never return in HTTP response bodies or logs. */
  url: string;
  headers: Record<string, string>;
}

/** Signed single-chunk requests use actual payload SHA-256 (not UNSIGNED-PAYLOAD). */
export function signSocialObjectRequest(
  config: SocialS3Config,
  method: 'PUT' | 'DELETE',
  key: string,
  data: Uint8Array = new Uint8Array(),
  contentType?: string,
  now = new Date(),
): SignedSocialObjectRequest {
  if (!OBJECT_KEY.test(key)) throw new Error('invalid_processed_media_key');
  if (method !== 'PUT' && method !== 'DELETE') throw new Error('invalid_storage_method');
  if (method === 'DELETE' && (data.byteLength !== 0 || contentType)) {
    throw new Error('invalid_storage_delete');
  }
  if (method === 'PUT' &&
    (!data.byteLength || data.byteLength > MAX_PROCESSED_BYTES ||
      !contentType ||
      MIME_EXTENSIONS[contentType] !== key.slice(key.lastIndexOf('.') + 1))) {
    throw new Error('invalid_processed_media');
  }
  const url = new URL(config.endpoint);
  const path = config.urlStyle === 'virtual-host'
    ? '/' + key : '/' + config.bucket + '/' + key;
  if (config.urlStyle === 'virtual-host') url.hostname = config.bucket + '.' + url.hostname;
  url.pathname = path;
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = timestamp.slice(0, 8);
  const payloadHash = method === 'PUT' ? sha256(data) : SHA256_EMPTY;
  const canonicalHeaders = [
    ...(contentType ? [['content-type', contentType]] : []),
    ['host', url.host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', timestamp],
  ];
  const signedHeaderNames = canonicalHeaders.map(([name]) => name).join(';');
  const canonicalRequest = [
    method, path, '',
    canonicalHeaders.map(([name, value]) => name + ':' + value + '\n').join(''),
    signedHeaderNames, payloadHash,
  ].join('\n');
  const scope = date + '/' + config.region + '/s3/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + config.secretAccessKey, date), config.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return {
    url: url.toString(),
    headers: {
      'x-amz-date': timestamp,
      'x-amz-content-sha256': payloadHash,
      ...(contentType ? { 'Content-Type': contentType } : {}),
      Authorization: 'AWS4-HMAC-SHA256 Credential=' + config.accessKeyId + '/' +
        scope + ',SignedHeaders=' + signedHeaderNames + ',Signature=' + signature,
    },
  };
}

type StorageFetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * For internal trusted workers only. The caller must *first* fully decode,
 * validate, strip metadata and re-encode all bytes. A matching magic header
 * is not sufficient. No public route calls these methods.
 */
export class SocialPrivateObjectTransport {
  private readonly config: SocialS3Config;
  private readonly fetcher: StorageFetcher;

  constructor(config: SocialS3Config, fetcher: StorageFetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  async putProcessed(key: string, processedBytes: Uint8Array, mime: string): Promise<void> {
    const req = signSocialObjectRequest(this.config, 'PUT', key, processedBytes, mime);
    await this.execute(req, 'PUT', Buffer.from(processedBytes));
  }

  async deleteProcessed(key: string): Promise<void> {
    const req = signSocialObjectRequest(this.config, 'DELETE', key);
    await this.execute(req, 'DELETE');
  }

  private async execute(request: SignedSocialObjectRequest, method: 'PUT' | 'DELETE', body?: Buffer): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(request.url, {
        method, headers: request.headers,
        ...(body ? { body } : {}),
        redirect: 'error', credentials: 'omit',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Never expose raw response text, S3 URLs or credentials to an app client.
      throw new Error('social_media_storage_unavailable');
    }
    if (response.ok || (method === 'DELETE' && response.status === 404)) return;
    throw new Error('social_media_storage_unavailable');
  }
}
