import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedFetch, clearSharedTestState, postJson, startTestServer } from './httpTestUtils.ts';
import type { TestServer } from './httpTestUtils.ts';
import { ensureMigrated, getPool, resetDbForTests } from '../src/db.ts';
import { PushStore } from '../src/pushStore.ts';
import type { PushContent, PushEvent } from '../src/pushNotifier.ts';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const P256DH = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';

before({ skip: !hasDatabase && 'DATABASE_URL not set' }, async () => {
  await ensureMigrated();
  await getPool().query('TRUNCATE push_subscriptions');
});
after({ skip: !hasDatabase }, async () => { await resetDbForTests(); });

describe('push notification devices and triggers', { skip: !hasDatabase && 'DATABASE_URL not set; skipping Postgres-backed push tests' }, () => {
  const sent: Array<{ riderId: string; event: PushEvent; content: PushContent }> = [];
  let ctx: TestServer;
  before(async () => {
    await clearSharedTestState();
    ctx = startTestServer({ pushNotifier: { notify: async (riderId, event, content) => { sent.push({ riderId, event, content }); } } });
    await ctx.ready;
  });
  after(() => ctx.close());

  it('serves one stable VAPID public key', async () => {
    ctx.authStore.createTestSession('push-a');
    const first = await (await authenticatedFetch(ctx, 'push-a', '/push/web-key')).json() as { publicKey: string };
    assert.equal(Buffer.from(first.publicKey, 'base64url').length, 65);
    const again = await new PushStore().getVapidKeys();
    assert.equal(again.publicKey, first.publicKey);
  });

  it('registers browser and phone devices, rejecting anything that is not a push service', async () => {
    ctx.authStore.createTestSession('push-a');
    const put = (body: unknown) => authenticatedFetch(ctx, 'push-a', '/push/subscriptions', { method: 'PUT', body: JSON.stringify(body) });
    assert.equal((await put({ kind: 'web', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: P256DH, auth: AUTH } })).status, 200);
    assert.equal((await put({ kind: 'expo', token: 'ExponentPushToken[abcdefghijkl]' })).status, 200);
    assert.equal((await put({ kind: 'web', endpoint: 'https://169.254.169.254/latest', keys: { p256dh: P256DH, auth: AUTH } })).status, 400);
    assert.equal((await put({ kind: 'web', endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'short', auth: AUTH } })).status, 400);
    assert.equal((await put({ kind: 'expo', token: 'not-a-token' })).status, 400);
    const devices = await new PushStore().listForRider('push-a');
    assert.deepEqual(devices.map((device) => device.kind).sort(), ['expo', 'web']);

    // A device moves with the account signed in on it.
    ctx.authStore.createTestSession('push-b');
    assert.equal((await authenticatedFetch(ctx, 'push-b', '/push/subscriptions', { method: 'PUT', body: JSON.stringify({ kind: 'expo', token: 'ExponentPushToken[abcdefghijkl]' }) })).status, 200);
    assert.equal((await new PushStore().listForRider('push-a')).length, 1);

    // Removing only works on your own devices.
    await authenticatedFetch(ctx, 'push-b', '/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ address: 'https://fcm.googleapis.com/fcm/send/abc' }) });
    assert.equal((await new PushStore().listForRider('push-a')).length, 1);
    await authenticatedFetch(ctx, 'push-a', '/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ address: 'https://fcm.googleapis.com/fcm/send/abc' }) });
    assert.equal((await new PushStore().listForRider('push-a')).length, 0);
  });

  it('notifies on a friend request, its acceptance and each message', async () => {
    ctx.authStore.createTestSession('push-sam');
    ctx.authStore.createTestSession('push-jo');
    await ctx.profileStore.update('push-sam', { displayName: 'Sam' });
    sent.length = 0;
    const request = await (await postJson(ctx, 'push-sam', '/friends/requests', { toRiderId: 'push-jo' })).json() as { id: string };
    assert.equal(sent[0]?.riderId, 'push-jo');
    assert.equal(sent[0]?.event, 'friend_request');
    assert.equal(sent[0]?.content.route, '#friends');
    assert.match(sent[0]!.content.body, /^Sam \(/);

    assert.equal((await postJson(ctx, 'push-jo', `/friends/requests/${request.id}/accept`, {})).status, 200);
    assert.equal(sent[1]?.riderId, 'push-sam');
    assert.equal(sent[1]?.event, 'friend_accepted');
    assert.equal(sent[1]?.content.route, '#chat:push-jo');

    assert.equal((await postJson(ctx, 'push-sam', '/messages', { toRiderId: 'push-jo', text: 'See you at the café?' })).status, 201);
    assert.deepEqual(sent[2], {
      riderId: 'push-jo',
      event: 'message',
      content: { title: 'Sam', body: 'See you at the café?', route: '#chat:push-sam', tag: 'chat-push-sam' },
    });
  });
});
