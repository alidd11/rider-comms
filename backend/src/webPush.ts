import { createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, createCipheriv, sign } from 'node:crypto';

/**
 * Web Push without a third-party library: VAPID (RFC 8292) to identify this
 * server to the browser's push service, and aes128gcm payload encryption
 * (RFC 8188 + RFC 8291) so only the subscribed browser can read the message.
 * Everything uses Node's built-in crypto.
 */

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (65 bytes). Browsers need this. */
  publicKey: string;
  /** P-256 private scalar, base64url (32 bytes). Never leaves the server. */
  privateKey: string;
}

export interface WebPushSubscription {
  endpoint: string;
  /** The browser's P-256 public key, base64url. */
  p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  auth: string;
}

const b64u = (buffer: Buffer): string => buffer.toString('base64url');
const fromB64u = (value: string): Buffer => Buffer.from(value, 'base64url');

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([0x04]), fromB64u(jwk.x!), fromB64u(jwk.y!)]);
  return { publicKey: b64u(point), privateKey: privateJwk.d! };
}

/** The `Authorization` header value for one push service request. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    // Push services reject tokens valid for more than 24 hours.
    exp: nowSeconds + 12 * 60 * 60,
    sub: subject,
  })));
  const point = fromB64u(keys.publicKey);
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33, 65)) },
    format: 'jwk',
  });
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/**
 * Encrypts a payload for one subscription (a single aes128gcm record).
 * `salt` and `senderPrivateKey` are only passed by tests, to reproduce the
 * RFC 8291 example; in use both are fresh for every message.
 */
export function encryptWebPushPayload(
  payload: Buffer,
  subscription: Pick<WebPushSubscription, 'p256dh' | 'auth'>,
  options: { salt?: Buffer; senderPrivateKey?: Buffer } = {},
): Buffer {
  const receiverPublic = fromB64u(subscription.p256dh);
  const authSecret = fromB64u(subscription.auth);
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 0x04) throw new Error('invalid p256dh key');
  if (authSecret.length !== 16) throw new Error('invalid auth secret');

  const sender = createECDH('prime256v1');
  if (options.senderPrivateKey) sender.setPrivateKey(options.senderPrivateKey);
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const sharedSecret = sender.computeSecret(receiverPublic);

  // RFC 8291 §3.4: mix the auth secret and both public keys into the key.
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));
  const salt = options.salt ?? randomBytes(16);
  const contentKey = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  // One record: the payload, then the 0x02 "last record" delimiter.
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);

  // RFC 8188 header: salt, record size, key id length, key id (our public key).
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, encrypted]);
}

/**
 * Push services this server will deliver to. Subscriptions come from
 * browsers, but the endpoint is client-supplied, so only real push services
 * are accepted (otherwise the server could be pointed at any URL).
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.port && !url.username && PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer | string }) => Promise<{ status: number; text(): Promise<string> }>;

/** Sends one encrypted message. `gone` means the subscription should be deleted. */
export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: unknown,
  vapid: VapidKeys,
  subject: string,
  fetchImpl: FetchLike,
): Promise<{ ok: boolean; gone: boolean; status: number }> {
  if (!isAllowedPushEndpoint(subscription.endpoint)) return { ok: false, gone: true, status: 0 };
  const body = encryptWebPushPayload(Buffer.from(JSON.stringify(payload)), subscription);
  const response = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, vapid, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(24 * 60 * 60),
      Urgency: 'high',
    },
    body,
  });
  return { ok: response.status >= 200 && response.status < 300, gone: response.status === 404 || response.status === 410, status: response.status };
}
