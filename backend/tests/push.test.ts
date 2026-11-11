import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, verify, createPublicKey } from 'node:crypto';
import { isExpoPushToken, sendExpoPush, EXPO_PUSH_URL } from '../src/expoPush.ts';
import { PushNotifier, previewText } from '../src/pushNotifier.ts';
import type { PushSubscriptionRecord } from '../src/pushStore.ts';
import {
  encryptWebPushPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  vapidAuthorization,
  type FetchLike,
} from '../src/webPush.ts';

// RFC 8291 Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** Decrypts as a browser would (RFC 8291), to round-trip fresh messages. */
function decrypt(body: Buffer, uaPrivate: string, uaPublic: string, auth: string): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + idLength);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(uaPrivate, 'base64url'));
  const shared = ecdh.computeSecret(senderPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(uaPublic, 'base64url'), senderPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, Buffer.from(auth, 'base64url'), info, 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const record = body.subarray(21 + idLength);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 0x02, 'last-record delimiter');
  return plain.subarray(0, -1).toString();
}

test('web push encryption reproduces the RFC 8291 example exactly', () => {
  const body = encryptWebPushPayload(Buffer.from(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, {
    salt: Buffer.from(RFC.salt, 'base64url'),
    senderPrivateKey: Buffer.from(RFC.asPrivate, 'base64url'),
  });
  assert.equal(body.toString('base64url'), RFC.body);
});

test('fresh messages use a new key and salt and decrypt for the browser', () => {
  const a = encryptWebPushPayload(Buffer.from('{"title":"Hi"}'), { p256dh: RFC.uaPublic, auth: RFC.auth });
  const b = encryptWebPushPayload(Buffer.from('{"title":"Hi"}'), { p256dh: RFC.uaPublic, auth: RFC.auth });
  assert.notEqual(a.toString('hex'), b.toString('hex'));
  assert.equal(decrypt(a, RFC.uaPrivate, RFC.uaPublic, RFC.auth), '{"title":"Hi"}');
  assert.throws(() => encryptWebPushPayload(Buffer.from('x'), { p256dh: 'AAAA', auth: RFC.auth }), /invalid p256dh/);
});

test('VAPID header is a valid ES256 token for the push service origin', () => {
  const keys = generateVapidKeys();
  assert.equal(Buffer.from(keys.publicKey, 'base64url').length, 65);
  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, 'https://ridercomms.app', 1_000_000);
  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(match);
  const claims = JSON.parse(Buffer.from(match[2]!, 'base64url').toString());
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 12 * 3600, sub: 'https://ridercomms.app' });
  assert.equal(match[4], keys.publicKey);
  const point = Buffer.from(keys.publicKey, 'base64url');
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${match[1]}.${match[2]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(match[3]!, 'base64url')));
});

test('only real push services are accepted as endpoints', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QGx',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
  ]) assert.ok(isAllowedPushEndpoint(ok), ok);
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/x',
    'https://evil.example/fcm.googleapis.com',
    'https://push.apple.com.evil.example/x',
    'https://169.254.169.254/latest',
    'not a url',
  ]) assert.ok(!isAllowedPushEndpoint(bad), bad);
});

test('Expo tokens are recognised and dead devices are reported', async () => {
  assert.ok(isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'));
  assert.ok(isExpoPushToken('ExpoPushToken[abcdefgh12345678]'));
  assert.ok(!isExpoPushToken('https://exp.host/x'));
  let sent: unknown;
  const fetchImpl: FetchLike = async (url, init) => {
    assert.equal(url, EXPO_PUSH_URL);
    sent = JSON.parse(String(init.body));
    return { status: 200, text: async () => JSON.stringify({ data: [{ status: 'ok' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] }) };
  };
  const result = await sendExpoPush([
    { to: 'ExponentPushToken[aaaaaaaaaa]', title: 'T', body: 'B', data: { route: '#friends' } },
    { to: 'ExponentPushToken[bbbbbbbbbb]', title: 'T', body: 'B', data: { route: '#friends' } },
  ], fetchImpl);
  assert.deepEqual(result.goneTokens, ['ExponentPushToken[bbbbbbbbbb]']);
  assert.equal((sent as Array<{ sound: string }>)[0]!.sound, 'default');
});

function fakeStore(devices: PushSubscriptionRecord[]) {
  const removed: string[][] = [];
  return {
    removed,
    store: {
      listForRider: async () => devices,
      removeAddresses: async (addresses: readonly string[]) => { removed.push([...addresses]); },
      getVapidKeys: async () => generateVapidKeys(),
    },
  };
}

test('the notifier honours each preference and removes devices that are gone', async () => {
  const web: PushSubscriptionRecord = { riderId: 'r', kind: 'web', address: 'https://fcm.googleapis.com/fcm/send/dead', p256dh: RFC.uaPublic, auth: RFC.auth };
  const expo: PushSubscriptionRecord = { riderId: 'r', kind: 'expo', address: 'ExponentPushToken[cccccccccc]', p256dh: null, auth: null };
  const { store, removed } = fakeStore([web, expo]);
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push(url);
    if (url === EXPO_PUSH_URL) {
      const messages = JSON.parse(String(init.body)) as Array<{ data: { route: string } }>;
      assert.equal(messages[0]!.data.route, '#chat:sam');
      return { status: 200, text: async () => JSON.stringify({ data: [{ status: 'ok' }] }) };
    }
    // The browser's subscription has expired.
    const body = init.body as Buffer;
    assert.deepEqual(JSON.parse(decrypt(body, RFC.uaPrivate, RFC.uaPublic, RFC.auth)), { title: 'Sam', body: 'Hi', route: '#chat:sam', tag: 'chat-sam', type: 'message' });
    assert.match(init.headers.Authorization!, /^vapid t=/);
    return { status: 410, text: async () => '' };
  };
  let prefs = { notifyInvites: false, notifyChat: true };
  const notifier = new PushNotifier({ store: store as never, getProfile: async () => prefs, fetchImpl });

  await notifier.notify('r', 'message', { title: 'Sam', body: 'Hi', route: '#chat:sam', tag: 'chat-sam' });
  assert.deepEqual(calls.sort(), [EXPO_PUSH_URL, web.address].sort());
  assert.deepEqual(removed, [[web.address]]);

  // Friend requests are off for this rider: nothing is sent.
  calls.length = 0;
  await notifier.notify('r', 'friend_request', { title: 'New friend request', body: 'x', route: '#friends', tag: 't' });
  assert.equal(calls.length, 0);

  // A failure never escapes into the request that triggered it.
  prefs = { notifyInvites: true, notifyChat: true };
  const broken = new PushNotifier({ store: store as never, getProfile: async () => prefs, fetchImpl: async () => { throw new Error('offline'); } });
  const errors = console.error;
  console.error = () => {};
  try {
    await broken.notify('r', 'friend_request', { title: 'T', body: 'B', route: '#friends', tag: 't' });
  } finally {
    console.error = errors;
  }
});

test('message previews are short and on one line', () => {
  assert.equal(previewText('  hello\n\nthere  '), 'hello there');
  const long = previewText('a'.repeat(300));
  assert.equal(long.length, 140);
  assert.ok(long.endsWith('…'));
});
